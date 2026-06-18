import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { transform } from "../dist/index.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const rootContext = path.resolve(dirname, "..");

function context(resourcePath = path.join(rootContext, "src/component.jsx")) {
  return {
    resourcePath,
    resourceQuery: "",
    rootContext,
    source: "",
    sourceMap: false,
    parseResult: undefined,
    emitWarning() {},
    emitError() {},
    addDependency() {}
  };
}

test("styled-jsx scopes static style jsx blocks", async () => {
  const result = await transform(
    "export default () => <div><p>hi</p><style jsx>{`p{color:red}`}</style></div>;",
    {
      format: "compact",
      plugins: ["yuku-loader/plugins/styled-jsx"]
    },
    context()
  );

  const className = result.code.match(/className=\"(jsx-[a-f0-9]+)\"/)?.[1];
  assert.ok(className, result.code);
  assert.match(result.code, /import _JSXStyle from\s*"styled-jsx\/style"/);
  assert.match(result.code, new RegExp(`<p className="${className}">hi</p>`));
  assert.match(result.code, new RegExp(`<_JSXStyle id="${className}">\\{"p\\.${className.replace("-", "\\-")}\\{color:red\\}"\\}</_JSXStyle>`));
});

test("styled-jsx appends to existing className literals", async () => {
  const result = await transform(
    "const view = <section className=\"outer\"><span>hi</span><style jsx>{`span{display:block}`}</style></section>;",
    {
      format: "compact",
      plugins: ["yuku-loader/plugins/styled-jsx"]
    },
    context()
  );

  const className = result.code.match(/outer (jsx-[a-f0-9]+)/)?.[1];
  assert.ok(className, result.code);
  assert.match(result.code, new RegExp(`<span className="${className}">hi</span>`));
});

test("styled-jsx global blocks do not add scoped class names", async () => {
  const result = await transform(
    "const view = <div><style jsx global>{`body{margin:0}`}</style></div>;",
    {
      format: "compact",
      plugins: ["yuku-loader/plugins/styled-jsx"]
    },
    context()
  );

  assert.match(result.code, /import _JSXStyle from\s*"styled-jsx\/style"/);
  assert.match(result.code, /<_JSXStyle id="jsx-[a-f0-9]+">\{"body\{margin:0\}"\}<\/_JSXStyle>/);
  assert.doesNotMatch(result.code, /<div className=/);
});
