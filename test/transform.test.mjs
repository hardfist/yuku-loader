import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { transform } from "../dist/index.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const rootContext = path.resolve(dirname, "..");

function context(resourcePath = path.join(rootContext, "src/example.js")) {
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

test("runs inline visitor plugins and prints transformed code", async () => {
  const result = await transform(
    "const answer = 1;",
    {
      format: "compact",
      plugins: [
        {
          name: "replace-literal",
          visitors: {
            Literal(node) {
              if (node.value === 1) {
                node.value = 42;
                node.raw = "42";
              }
            }
          }
        }
      ]
    },
    context()
  );

  assert.equal(result.code, "const answer=42");
  assert.equal(result.program.type, "Program");
});

test("loads external JS plugins with options", async () => {
  const result = await transform(
    "const answer = 1; console.log(answer);",
    {
      format: "compact",
      plugins: [[path.join(dirname, "fixtures/rename-plugin.mjs"), { from: "answer", to: "total" }]]
    },
    context()
  );

  assert.equal(result.code, "const total=1;console.log(total)");
});

test("strips TypeScript by default for ts resources", async () => {
  const result = await transform(
    "const answer: number = 1;",
    { format: "compact" },
    context(path.join(rootContext, "src/example.ts"))
  );

  assert.equal(result.code, "const answer=1");
});

test("can return code directly from a transform plugin", async () => {
  const result = await transform(
    "const answer = 1;",
    {
      generate: false,
      plugins: [
        {
          transform() {
            return "export default 42;";
          }
        }
      ]
    },
    context()
  );

  assert.equal(result.code, "export default 42;");
});
