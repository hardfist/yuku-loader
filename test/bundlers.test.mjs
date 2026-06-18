import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rspack } from "@rspack/core";
import webpack from "webpack";
import test from "node:test";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dirname, "..");
const loaderPath = path.join(root, "dist/loader.cjs");
const pluginPath = path.join(dirname, "fixtures/rename-plugin.mjs");
const entry = path.join(dirname, "fixtures/bundler-entry.js");

function createConfig(outputPath) {
  return {
    mode: "development",
    devtool: false,
    context: dirname,
    entry,
    output: {
      path: outputPath,
      filename: "bundle.js"
    },
    optimization: {
      minimize: false
    },
    module: {
      rules: [
        {
          test: /\.[cm]?[jt]sx?$/,
          loader: loaderPath,
          type: "javascript/auto",
          options: {
            format: "compact",
            plugins: [[pluginPath, { from: "answer", to: "total" }]]
          }
        }
      ]
    }
  };
}

async function runBundler(name, compile) {
  const outputPath = await fs.mkdtemp(path.join(os.tmpdir(), `yuku-loader-${name}-`));
  await compile(createConfig(outputPath));
  const bundle = await fs.readFile(path.join(outputPath, "bundle.js"), "utf8");
  await fs.rm(outputPath, { recursive: true, force: true });
  return bundle;
}

test("works as a webpack loader", async () => {
  const bundle = await runBundler("webpack", (config) => {
    return new Promise((resolve, reject) => {
      webpack(config, (error, stats) => {
        if (error) {
          reject(error);
          return;
        }
        if (stats?.hasErrors()) {
          reject(new Error(stats.toString({ colors: false, errors: true })));
          return;
        }
        resolve();
      });
    });
  });

  assert.match(bundle, /const total=1;console\.log\(total\)/);
});

test("works as a rspack loader", async () => {
  const bundle = await runBundler("rspack", (config) => {
    return new Promise((resolve, reject) => {
      rspack(config).run((error, stats) => {
        if (error) {
          reject(error);
          return;
        }
        if (stats?.hasErrors()) {
          reject(new Error(stats.toString({ colors: false, errors: true })));
          return;
        }
        resolve();
      });
    });
  });

  assert.match(bundle, /const total=1;console\.log\(total\)/);
});
