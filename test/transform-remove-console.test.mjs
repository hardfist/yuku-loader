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

test("transform-remove-console removes console call statements", async () => {
  const result = await transform(
    'console.log("foo");\nconsole.error("bar");\nrun();',
    {
      format: "compact",
      plugins: ["yuku-loader/plugins/transform-remove-console"]
    },
    context()
  );

  assert.equal(result.code, "run()");
});

test("transform-remove-console preserves excluded methods", async () => {
  const result = await transform(
    'console.log("foo");\nconsole.error("bar");\nconsole.warn("baz");',
    {
      format: "compact",
      plugins: [["yuku-loader/plugins/transform-remove-console", { exclude: ["error", "warn"] }]]
    },
    context()
  );

  assert.equal(result.code, 'console.error("bar");console.warn("baz")');
});

test("transform-remove-console replaces nested console calls with void 0", async () => {
  const result = await transform(
    'const value = maybe(console.log("foo"));',
    {
      format: "compact",
      plugins: ["yuku-loader/plugins/transform-remove-console"]
    },
    context()
  );

  assert.equal(result.code, "const value=maybe(void 0)");
});

test("transform-remove-console replaces console references and bind calls with noop functions", async () => {
  const result = await transform(
    "const log = console.log;\nconst bound = console.warn.bind(console);",
    {
      format: "compact",
      plugins: ["yuku-loader/plugins/transform-remove-console"]
    },
    context()
  );

  assert.equal(result.code, "const log=function(){};const bound=function(){}");
});

test("transform-remove-console leaves locally bound console alone", async () => {
  const result = await transform(
    "function test(console) { console.log('local'); }\nconst console = createLogger();\nconsole.info('local');",
    {
      format: "compact",
      plugins: ["yuku-loader/plugins/transform-remove-console"]
    },
    context()
  );

  assert.equal(result.code, "function test(console){console.log('local')}const console=createLogger();console.info('local')");
});
