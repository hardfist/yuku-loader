import path from "node:path";
import { fileURLToPath } from "node:url";
import { rspack } from "@rspack/core";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default {
  context: dirname,
  mode: "development",
  entry: "./src/index.js",
  output: {
    path: path.join(dirname, "dist"),
    filename: "bundle.js"
  },
  module: {
    rules: [
      {
        test: /\.[cm]?[jt]sx?$/,
        loader: path.resolve(dirname, "../../dist/index.js"),
        type: "javascript/auto",
        options: {
          format: "compact",
          plugins: [
            path.resolve(dirname, "./replace-debug-plugin.mjs")
          ]
        }
      }
    ]
  },
  plugins: [
    new rspack.ProgressPlugin()
  ]
};
