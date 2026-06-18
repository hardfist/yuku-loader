import { transformSync as babelTransformSync } from "@babel/core";
import babelRemoveConsole from "babel-plugin-transform-remove-console";
import { transformSync as swcTransformSync } from "@swc/core";
import { createRequire } from "node:module";
import { transform as yukuTransform } from "../dist/index.js";
import yukuRemoveConsole from "../dist/plugins/transform-remove-console.js";

const require = createRequire(import.meta.url);
const swcRemoveConsolePath = require.resolve("@swc/plugin-remove-console");

const units = readPositiveInteger("BENCH_UNITS", 300);
const iterations = readPositiveInteger("BENCH_ITERATIONS", 20);
const warmupIterations = readPositiveInteger("BENCH_WARMUP", 5);
const options = { exclude: ["error", "warn"] };
const source = createFixture(units);
const yukuContext = {
  resourcePath: `${process.cwd()}/bench/remove-console.js`,
  resourceQuery: "",
  rootContext: process.cwd(),
  source,
  sourceMap: false,
  parseResult: undefined,
  emitWarning() {},
  emitError() {},
  addDependency() {}
};

const runners = [
  {
    name: "babel",
    run() {
      const result = babelTransformSync(source, {
        babelrc: false,
        comments: false,
        compact: true,
        configFile: false,
        filename: "remove-console.js",
        plugins: [[babelRemoveConsole, options]]
      });
      return result?.code ?? "";
    }
  },
  {
    name: "swc",
    run() {
      return swcTransformSync(source, {
        filename: "remove-console.js",
        jsc: {
          parser: {
            syntax: "ecmascript"
          },
          target: "es2022",
          experimental: {
            plugins: [[swcRemoveConsolePath, options]]
          }
        }
      }).code;
    }
  },
  {
    name: "yuku",
    async run() {
      const result = await yukuTransform(
        source,
        {
          format: "compact",
          plugins: [[yukuRemoveConsole, options]]
        },
        { ...yukuContext, source }
      );
      return result.code;
    }
  }
];

console.log(`remove-console benchmark`);
console.log(`fixture: ${units} units, ${source.length.toLocaleString()} chars`);
console.log(`iterations: ${iterations} measured, ${warmupIterations} warmup`);
console.log("");

const results = [];

for (const runner of runners) {
  for (let i = 0; i < warmupIterations; i++) {
    await runner.run();
  }

  const samples = [];
  let output = "";
  for (let i = 0; i < iterations; i++) {
    const start = process.hrtime.bigint();
    output = await runner.run();
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    samples.push(elapsedMs);
  }

  validateOutput(runner.name, output);
  const stats = summarize(samples);
  results.push({
    ...stats,
    name: runner.name,
    outputBytes: Buffer.byteLength(output)
  });
}

const fastest = Math.min(...results.map((result) => result.medianMs));

printMarkdownTable(results, fastest);
writeGitHubSummary(results, fastest);

function createFixture(count) {
  const chunks = [
    "import { compute } from './runtime.js';",
    "export function runAll(input) {",
    "  let total = 0;"
  ];

  for (let i = 0; i < count; i++) {
    chunks.push(
      `  function case${i}(value) {`,
      `    console.log("case:${i}", value);`,
      `    console.debug("debug:${i}", value + ${i});`,
      `    console.error("error:${i}", value);`,
      `    console.warn("warn:${i}", value);`,
      `    total += compute(value, ${i});`,
      `    if (value % 3 === 0) console.info("info:${i}", value);`,
      `    return total;`,
      `  }`,
      `  total += case${i}(input + ${i});`
    );
  }

  chunks.push("  return total;", "}");
  return `${chunks.join("\n")}\n`;
}

function validateOutput(name, output) {
  if (/console\.(?:log|debug|info)\s*\(/.test(output)) {
    throw new Error(`${name} output still contains removable console calls`);
  }
  if (!/console\.error\s*\(/.test(output)) {
    throw new Error(`${name} output removed excluded console.error calls`);
  }
  if (!/console\.warn\s*\(/.test(output)) {
    throw new Error(`${name} output removed excluded console.warn calls`);
  }
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = samples.reduce((total, sample) => total + sample, 0);
  return {
    meanMs: sum / samples.length,
    medianMs: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    minMs: sorted[0],
    maxMs: sorted.at(-1)
  };
}

function percentile(sorted, ratio) {
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * ratio));
  return sorted[index];
}

function printMarkdownTable(results, fastest) {
  console.log("| tool | median ms | mean ms | p95 ms | relative | output bytes |");
  console.log("| --- | ---: | ---: | ---: | ---: | ---: |");
  for (const result of results) {
    console.log(formatRow(result, fastest));
  }
}

function writeGitHubSummary(results, fastest) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    return;
  }

  const lines = [
    "## remove-console benchmark",
    "",
    `Fixture: ${units} units, ${source.length.toLocaleString()} chars`,
    "",
    "| tool | median ms | mean ms | p95 ms | relative | output bytes |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...results.map((result) => formatRow(result, fastest)),
    ""
  ];

  require("node:fs").appendFileSync(summaryPath, `${lines.join("\n")}\n`);
}

function formatRow(result, fastest) {
  return [
    `| ${result.name}`,
    result.medianMs.toFixed(2),
    result.meanMs.toFixed(2),
    result.p95Ms.toFixed(2),
    `${(result.medianMs / fastest).toFixed(2)}x`,
    result.outputBytes.toLocaleString()
  ].join(" | ") + " |";
}

function readPositiveInteger(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}
