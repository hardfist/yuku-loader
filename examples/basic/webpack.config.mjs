import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default {
  context: dirname,
  mode: "development",
  devtool: false,
  entry: "./src/index.js",
  output: {
    path: path.join(dirname, "dist-webpack"),
    filename: "bundle.js"
  },
  optimization: {
    minimize: false
  },
  module: {
    rules: [
      {
        test: /\.[cm]?[jt]sx?$/,
        loader: path.resolve(dirname, "../../dist/loader.cjs"),
        type: "javascript/auto",
        options: {
          format: "compact",
          plugins: [
            path.resolve(dirname, "./replace-debug-plugin.mjs")
          ]
        }
      }
    ]
  }
};
