# rspack-yuku-loader

Rspack loader that uses [Yuku](https://github.com/yuku-toolchain/yuku) to parse JavaScript and TypeScript into an ESTree-compatible AST, run JavaScript plugins that mutate or replace that AST, and print the transformed module back to code.

## Install

```sh
npm install -D rspack-yuku-loader
```

Yuku is bundled as runtime dependencies through `yuku-parser` and `yuku-codegen`.

## Rspack Usage

```js
// rspack.config.mjs
export default {
  module: {
    rules: [
      {
        test: /\.[cm]?[jt]sx?$/,
        loader: "rspack-yuku-loader",
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

## Options

```ts
interface RspackYukuLoaderOptions {
  plugins?: LoaderPlugin[];
  parse?: ParseOptions;
  codegen?: CodegenOptions;
  generate?: "auto" | "print" | "strip" | "minify" | false;
  format?: "pretty" | "compact";
  ast?: boolean;
}
```

`generate` defaults to `auto`. JavaScript resources use `print`; TypeScript resources use `strip` so type syntax is removed before Rspack parses the module.

The loader also passes `{ webpackAST: program }` as loader metadata for compatibility with bundlers that consume loader-provided ASTs. The transformed code is still the source of truth.

Set `ast: false` to skip that metadata.

## Development

```sh
npm install
npm test
```

The basic example lives in `examples/basic`.
