# yuku-loader

Yuku-powered AST transform loader for webpack and Rspack. It parses JavaScript and TypeScript into an ESTree-compatible AST, runs JavaScript plugins that mutate or replace that AST, and prints the transformed module back to code.

## Install

```sh
npm install -D yuku-loader
```

Yuku is bundled as runtime dependencies through `yuku-parser` and `yuku-codegen`.

## Webpack Usage

```js
// webpack.config.mjs
export default {
  module: {
    rules: [
      {
        test: /\.[cm]?[jt]sx?$/,
        loader: "yuku-loader",
        type: "javascript/auto",
        options: {
          format: "compact",
          plugins: ["./build/rename-plugin.mjs"]
        }
      }
    ]
  }
};
```

## Rspack Usage

```js
// rspack.config.mjs
export default {
  module: {
    rules: [
      {
        test: /\.[cm]?[jt]sx?$/,
        loader: "yuku-loader",
        type: "javascript/auto",
        options: {
          format: "compact",
          plugins: ["./build/rename-plugin.mjs"]
        }
      }
    ]
  }
};
```

## Plugin API

Plugins are JavaScript modules. A plugin can export a factory, a visitor object, or a plugin object.

```js
// build/rename-plugin.mjs
export default function renamePlugin(api, options = {}) {
  const from = options.from ?? "__buildTarget";
  const to = options.to ?? "target";

  return api.visitor({
    Identifier(node) {
      if (node.name === from) {
        node.name = to;
      }
    }
  });
}
```

Pass plugin options with tuple syntax:

```js
options: {
  plugins: [["./build/rename-plugin.mjs", { from: "answer", to: "total" }]]
}
```

You can also use an object plugin:

```js
export default {
  name: "replace-literal",
  visitors: {
    Literal(node) {
      if (node.value === 1) {
        node.value = 42;
        node.raw = "42";
      }
    }
  }
};
```

Or return generated code directly:

```js
export default {
  transform(program, context) {
    return "export default 42;";
  }
};
```

## Built-in Plugins

### `styled-jsx`

Provides a small static `styled-jsx` transform for the yuku-loader plugin API. It handles static `<style jsx>` and `<style jsx global>` blocks, injects `styled-jsx/style`, scopes simple selectors, and adds the generated `className` to native JSX elements in the same tree.

```js
export default {
  module: {
    rules: [
      {
        test: /\.[cm]?[jt]sx?$/,
        loader: "yuku-loader",
        options: {
          plugins: ["yuku-loader/plugins/styled-jsx"]
        }
      }
    ]
  }
};
```

The current implementation targets static CSS strings and template literals. Dynamic CSS expressions are left unchanged and reported as warnings.

### `transform-remove-console`

Ports Babel's `babel-plugin-transform-remove-console` behavior to the yuku-loader plugin API. It removes `console.*` calls and supports Babel's `exclude` option.

```js
export default {
  module: {
    rules: [
      {
        test: /\.[cm]?[jt]sx?$/,
        loader: "yuku-loader",
        options: {
          plugins: [
            [
              "yuku-loader/plugins/transform-remove-console",
              { exclude: ["error", "warn"] }
            ]
          ]
        }
      }
    ]
  }
};
```

## Options

```ts
interface YukuLoaderOptions {
  plugins?: LoaderPlugin[];
  parse?: ParseOptions;
  codegen?: CodegenOptions;
  generate?: "auto" | "print" | "strip" | "minify" | false;
  format?: "pretty" | "compact";
  ast?: boolean;
}
```

`generate` defaults to `auto`. JavaScript resources use `print`; TypeScript resources use `strip` so type syntax is removed before the bundler parses the module.

The transformed code is the source of truth for both webpack and Rspack.

Set `ast: true` to also pass `{ webpackAST: program }` as loader metadata for experiments with bundlers that consume loader-provided ASTs.

## Development

```sh
npm install
npm test
npm run benchmark:remove-console
```

The remove-console benchmark compares Babel, SWC, and Yuku across synthetic code, `three/build/three.module.js`, and `typescript/lib/typescript.js`. Use `BENCH_FIXTURES=synthetic,three,typescript`, `BENCH_ITERATIONS`, `BENCH_WARMUP`, or `BENCH_UNITS` to tune local runs.

The basic example lives in `examples/basic`.
