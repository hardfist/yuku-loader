import { createHash } from "node:crypto";
import { walk } from "yuku-parser";
import type { Program } from "yuku-parser";
import type { LoaderPluginApi, LoaderPluginContext, LoaderPluginObject } from "../types.js";

type Node = Record<string, any>;

export interface StyledJsxOptions {
  importName?: string;
}

interface ProcessResult {
  ids: string[];
  transformed: boolean;
}

export default function styledJsx(
  _api: LoaderPluginApi,
  options: StyledJsxOptions = {}
): LoaderPluginObject {
  const importName = options.importName ?? "_JSXStyle";

  return {
    name: "styled-jsx",
    transform(program: Program, context: LoaderPluginContext) {
      let transformed = false;

      walk(program, {
        JSXElement(node, ctx) {
          if (ctx.ancestors().some((ancestor) => (ancestor as Node).type === "JSXElement")) {
            return;
          }

          const result = processJsxTree(node as Node, importName, context);
          if (result.transformed) {
            transformed = true;
            ctx.skip();
          }
        }
      }, context);

      if (transformed && !hasStyledJsxImport(program as Node)) {
        (program as Node).body.unshift(createStyledJsxImport(importName));
      }
    }
  };
}

function processJsxTree(element: Node, importName: string, context: LoaderPluginContext): ProcessResult {
  if (isStyleJsxElement(element)) {
    const css = extractStaticCss(element);
    if (css == null) {
      context.emitWarning(
        new Error("styled-jsx plugin only transforms static string or template literal <style jsx> children")
      );
      return { ids: [], transformed: false };
    }

    const isGlobal = hasJsxAttribute(element.openingElement, "global");
    const id = `jsx-${hashCss(css)}`;
    rewriteStyleElement(element, importName, id, isGlobal ? css : scopeCss(css, id));
    return { ids: isGlobal ? [] : [id], transformed: true };
  }

  const childIds = [];
  let transformed = false;
  for (const child of element.children ?? []) {
    if (child?.type === "JSXElement") {
      const result = processJsxTree(child, importName, context);
      childIds.push(...result.ids);
      transformed ||= result.transformed;
    } else if (child?.type === "JSXExpressionContainer" && child.expression?.type === "JSXElement") {
      const result = processJsxTree(child.expression, importName, context);
      childIds.push(...result.ids);
      transformed ||= result.transformed;
    }
  }

  const uniqueIds = [...new Set(childIds)];
  if (uniqueIds.length > 0) {
    addClassNameToNativeSubtree(element, uniqueIds.join(" "));
  }

  return { ids: uniqueIds, transformed };
}

function isStyleJsxElement(element: Node): boolean {
  return (
    getJsxName(element.openingElement?.name) === "style" &&
    hasJsxAttribute(element.openingElement, "jsx")
  );
}

function isNativeJsxElement(element: Node): boolean {
  const name = getJsxName(element.openingElement?.name);
  return Boolean(name && /^[a-z]/.test(name) && name !== "style");
}

function getJsxName(name: Node | null | undefined): string | null {
  if (name?.type === "JSXIdentifier") {
    return name.name;
  }
  return null;
}

function hasJsxAttribute(openingElement: Node | null | undefined, name: string): boolean {
  return getJsxAttribute(openingElement, name) != null;
}

function getJsxAttribute(openingElement: Node | null | undefined, name: string): Node | null {
  for (const attr of openingElement?.attributes ?? []) {
    if (attr.type === "JSXAttribute" && attr.name?.type === "JSXIdentifier" && attr.name.name === name) {
      return attr;
    }
  }
  return null;
}

function extractStaticCss(element: Node): string | null {
  const meaningfulChildren = (element.children ?? []).filter((child: Node) => {
    return child.type !== "JSXText" || child.value.trim() !== "";
  });

  if (meaningfulChildren.length !== 1) {
    return null;
  }

  const child = meaningfulChildren[0];
  if (child.type === "JSXText") {
    return child.value;
  }

  const expr = child.type === "JSXExpressionContainer" ? child.expression : child;
  if (expr?.type === "Literal" && typeof expr.value === "string") {
    return expr.value;
  }

  if (expr?.type === "TemplateLiteral" && expr.expressions.length === 0) {
    return expr.quasis.map((quasi: Node) => quasi.value.raw).join("");
  }

  return null;
}

function rewriteStyleElement(element: Node, importName: string, id: string, css: string): void {
  element.openingElement.name = jsxIdentifier(importName);
  if (element.closingElement) {
    element.closingElement.name = jsxIdentifier(importName);
  }

  element.openingElement.attributes = (element.openingElement.attributes ?? []).filter((attr: Node) => {
    return !(
      attr.type === "JSXAttribute" &&
      attr.name?.type === "JSXIdentifier" &&
      (attr.name.name === "jsx" || attr.name.name === "global")
    );
  });

  element.openingElement.attributes.unshift(jsxAttribute("id", literal(id)));
  element.children = [jsxExpressionContainer(literal(css))];
}

function addClassName(openingElement: Node, className: string): void {
  const attr = getJsxAttribute(openingElement, "className");
  if (!attr) {
    openingElement.attributes.push(jsxAttribute("className", literal(className)));
    return;
  }

  if (attr.value?.type === "Literal" && typeof attr.value.value === "string") {
    if (!attr.value.value.split(/\s+/).includes(className)) {
      attr.value.value = `${attr.value.value} ${className}`;
      attr.value.raw = JSON.stringify(attr.value.value);
    }
    return;
  }

  const expression = attr.value?.type === "JSXExpressionContainer" ? attr.value.expression : attr.value;
  if (expression) {
    attr.value = jsxExpressionContainer({
      type: "BinaryExpression",
      operator: "+",
      left: literal(`${className} `),
      right: expression,
      start: expression.start ?? 0,
      end: expression.end ?? 0
    });
  }
}

function addClassNameToNativeSubtree(element: Node, className: string): void {
  if (isNativeJsxElement(element)) {
    addClassName(element.openingElement, className);
  }

  for (const child of element.children ?? []) {
    if (child?.type === "JSXElement") {
      addClassNameToNativeSubtree(child, className);
    } else if (child?.type === "JSXExpressionContainer" && child.expression?.type === "JSXElement") {
      addClassNameToNativeSubtree(child.expression, className);
    }
  }
}

function scopeCss(css: string, className: string): string {
  return css.replace(/([^{}@]+)\{/g, (match, rawSelector: string) => {
    const selector = rawSelector.trim();
    if (!selector || selector.endsWith("from") || selector.endsWith("to") || /^\d+%$/.test(selector)) {
      return match;
    }
    const scoped = selector
      .split(",")
      .map((part) => scopeSelector(part.trim(), className))
      .join(",");
    return `${scoped}{`;
  });
}

function scopeSelector(selector: string, className: string): string {
  if (selector.includes(`.${className}`)) {
    return selector;
  }
  return selector.replace(/(:{1,2}[\w-]+(?:\([^)]*\))?)?$/, `.${className}$1`);
}

function hashCss(css: string): string {
  return createHash("sha1").update(css).digest("hex").slice(0, 16);
}

function hasStyledJsxImport(program: Node): boolean {
  return (program.body ?? []).some((statement: Node) => {
    return statement.type === "ImportDeclaration" && statement.source?.value === "styled-jsx/style";
  });
}

function createStyledJsxImport(importName: string): Node {
  return {
    type: "ImportDeclaration",
    specifiers: [
      {
        type: "ImportDefaultSpecifier",
        local: identifier(importName),
        start: 0,
        end: 0
      }
    ],
    source: literal("styled-jsx/style"),
    attributes: [],
    phase: null,
    start: 0,
    end: 0
  };
}

function jsxAttribute(name: string, value: Node): Node {
  return {
    type: "JSXAttribute",
    name: jsxIdentifier(name),
    value,
    start: 0,
    end: 0
  };
}

function jsxExpressionContainer(expression: Node): Node {
  return {
    type: "JSXExpressionContainer",
    expression,
    start: expression.start ?? 0,
    end: expression.end ?? 0
  };
}

function jsxIdentifier(name: string): Node {
  return {
    type: "JSXIdentifier",
    name,
    start: 0,
    end: 0
  };
}

function identifier(name: string): Node {
  return {
    type: "Identifier",
    name,
    start: 0,
    end: 0
  };
}

function literal(value: string): Node {
  return {
    type: "Literal",
    value,
    raw: JSON.stringify(value),
    start: 0,
    end: 0
  };
}
