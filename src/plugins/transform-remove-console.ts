import { walk } from "yuku-parser";
import type { Node as YukuNode, Program } from "yuku-parser";
import type { LoaderPluginApi, LoaderPluginContext, LoaderPluginObject } from "../types.js";

export interface TransformRemoveConsoleOptions {
  exclude?: string[];
}

interface Scope {
  bindings: Set<string>;
}

type Node = Record<string, any>;

export default function transformRemoveConsole(
  _api: LoaderPluginApi,
  options: TransformRemoveConsoleOptions = {}
): LoaderPluginObject {
  const exclude = new Set(options.exclude ?? []);

  return {
    name: "transform-remove-console",
    transform(program: Program, context: LoaderPluginContext) {
      const scopes: Scope[] = [];

      walk(program, {
        Program: {
          enter(node) {
            scopes.push({ bindings: collectProgramBindings(node as Node) });
          },
          leave() {
            scopes.pop();
          }
        },
        FunctionDeclaration: {
          enter(node) {
            scopes.push({ bindings: collectFunctionBindings(node as Node) });
          },
          leave() {
            scopes.pop();
          }
        },
        FunctionExpression: {
          enter(node) {
            scopes.push({ bindings: collectFunctionBindings(node as Node) });
          },
          leave() {
            scopes.pop();
          }
        },
        ArrowFunctionExpression: {
          enter(node) {
            scopes.push({ bindings: collectFunctionBindings(node as Node) });
          },
          leave() {
            scopes.pop();
          }
        },
        BlockStatement: {
          enter(node) {
            scopes.push({ bindings: collectBlockBindings(node as Node) });
          },
          leave() {
            scopes.pop();
          }
        },
        ExpressionStatement(node, ctx) {
          if (isIncludedConsoleCall((node as Node).expression, exclude, scopes)) {
            if (ctx.index == null) {
              ctx.replace(emptyStatement(node as Node) as YukuNode);
            } else {
              ctx.remove();
            }
          }
        },
        CallExpression(node, ctx) {
          const call = node as Node;
          if (isIncludedConsoleMember(call.callee, exclude, scopes)) {
            ctx.replace(voidZero(call) as YukuNode);
          } else if (isIncludedConsoleBind(call.callee, exclude, scopes)) {
            ctx.replace(noopFunction(call) as YukuNode);
          }
        },
        MemberExpression: {
          leave(node, ctx) {
            const member = node as Node;
            const parent = ctx.parent as Node | null;

            if (
              !isIncludedConsoleMember(member, exclude, scopes) ||
              parent?.type === "MemberExpression"
            ) {
              return;
            }

            if (parent?.type === "AssignmentExpression" && ctx.key === "left") {
              parent.right = noopFunction(parent.right ?? member);
              return;
            }

            ctx.replace(noopFunction(member) as YukuNode);
          }
        }
      }, context);
    }
  };
}

function isIncludedConsoleCall(
  node: Node | null | undefined,
  exclude: Set<string>,
  scopes: Scope[]
): boolean {
  return node?.type === "CallExpression" && isIncludedConsoleMember(node.callee, exclude, scopes);
}

function isIncludedConsoleMember(
  node: Node | null | undefined,
  exclude: Set<string>,
  scopes: Scope[]
): boolean {
  if (node?.type !== "MemberExpression") {
    return false;
  }

  if (isExcludedIdentifierProperty(node.property, exclude)) {
    return false;
  }

  if (isUnboundConsoleIdentifier(node.object, scopes)) {
    return true;
  }

  return (
    node.object?.type === "MemberExpression" &&
    isUnboundConsoleIdentifier(node.object.object, scopes) &&
    isIdentifierNamed(node.property, "call", "apply")
  );
}

function isIncludedConsoleBind(
  node: Node | null | undefined,
  exclude: Set<string>,
  scopes: Scope[]
): boolean {
  if (node?.type !== "MemberExpression" || !isIdentifierNamed(node.property, "bind")) {
    return false;
  }

  const object = node.object;
  return (
    object?.type === "MemberExpression" &&
    !isExcludedIdentifierProperty(object.property, exclude) &&
    isUnboundConsoleIdentifier(object.object, scopes)
  );
}

function isUnboundConsoleIdentifier(node: Node | null | undefined, scopes: Scope[]): boolean {
  return (
    isIdentifierNamed(node, "console") &&
    scopes.every((scope) => !scope.bindings.has("console"))
  );
}

function isIdentifierNamed(node: Node | null | undefined, ...names: string[]): boolean {
  return node?.type === "Identifier" && names.includes(node.name);
}

function isExcludedIdentifierProperty(node: Node | null | undefined, exclude: Set<string>): boolean {
  return node?.type === "Identifier" && exclude.has(node.name);
}

function collectProgramBindings(program: Node): Set<string> {
  const bindings = new Set<string>();

  for (const statement of program.body ?? []) {
    if (statement.type === "ImportDeclaration") {
      for (const specifier of statement.specifiers ?? []) {
        addPatternBindings(specifier.local, bindings);
      }
      continue;
    }

    collectStatementBindings(statement, bindings, true);
  }

  return bindings;
}

function collectBlockBindings(block: Node): Set<string> {
  const bindings = new Set<string>();

  for (const statement of block.body ?? []) {
    collectStatementBindings(statement, bindings, false);
  }

  return bindings;
}

function collectFunctionBindings(fn: Node): Set<string> {
  const bindings = new Set<string>();

  addPatternBindings(fn.id, bindings);
  for (const param of fn.params ?? []) {
    addPatternBindings(param, bindings);
  }
  collectVarBindings(fn.body, bindings);

  return bindings;
}

function collectStatementBindings(statement: Node, bindings: Set<string>, includeVar: boolean): void {
  if (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") {
    addPatternBindings(statement.id, bindings);
    return;
  }

  if (statement.type === "VariableDeclaration") {
    if (includeVar || statement.kind !== "var") {
      for (const declaration of statement.declarations ?? []) {
        addPatternBindings(declaration.id, bindings);
      }
    }
  }
}

function collectVarBindings(node: Node | null | undefined, bindings: Set<string>): void {
  if (!node || typeof node !== "object") {
    return;
  }

  if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") {
    addPatternBindings(node.id, bindings);
    return;
  }

  if (node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression") {
    return;
  }

  if (node.type === "VariableDeclaration" && node.kind === "var") {
    for (const declaration of node.declarations ?? []) {
      addPatternBindings(declaration.id, bindings);
    }
  }

  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        collectVarBindings(item, bindings);
      }
    } else if (value && typeof value === "object") {
      collectVarBindings(value as Node, bindings);
    }
  }
}

function addPatternBindings(pattern: Node | null | undefined, bindings: Set<string>): void {
  if (!pattern || typeof pattern !== "object") {
    return;
  }

  switch (pattern.type) {
    case "Identifier":
      bindings.add(pattern.name);
      return;
    case "RestElement":
      addPatternBindings(pattern.argument, bindings);
      return;
    case "AssignmentPattern":
      addPatternBindings(pattern.left, bindings);
      return;
    case "ArrayPattern":
      for (const element of pattern.elements ?? []) {
        addPatternBindings(element, bindings);
      }
      return;
    case "ObjectPattern":
      for (const property of pattern.properties ?? []) {
        if (property.type === "Property") {
          addPatternBindings(property.value, bindings);
        } else if (property.type === "RestElement") {
          addPatternBindings(property.argument, bindings);
        }
      }
  }
}

function emptyStatement(source: Node): Node {
  return { type: "EmptyStatement", start: source.start ?? 0, end: source.end ?? 0 };
}

function voidZero(source: Node): Node {
  return {
    type: "UnaryExpression",
    operator: "void",
    prefix: true,
    argument: { type: "Literal", value: 0, raw: "0", start: source.start ?? 0, end: source.start ?? 0 },
    start: source.start ?? 0,
    end: source.end ?? 0
  };
}

function noopFunction(source: Node): Node {
  return {
    type: "FunctionExpression",
    id: null,
    params: [],
    body: { type: "BlockStatement", body: [], start: source.start ?? 0, end: source.end ?? 0 },
    generator: false,
    async: false,
    expression: false,
    start: source.start ?? 0,
    end: source.end ?? 0
  };
}
