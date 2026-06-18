import { transformSync as babelTransformSync } from "@babel/core";
import babelRemoveConsole from "babel-plugin-transform-remove-console";
import { transformSync as swcTransformSync } from "@swc/core";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { transform as yukuTransform } from "../dist/index.js";
import yukuRemoveConsole from "../dist/plugins/transform-remove-console.js";

const require = createRequire(import.meta.url);
const swcRemoveConsolePath = require.resolve("@swc/plugin-remove-console");

const units = readPositiveInteger("BENCH_UNITS", 300);
const fixtureFilter = new Set(
  readStringList("BENCH_FIXTURES", ["synthetic", "three", "typescript"])
);
const requestedIterations = readOptionalPositiveInteger("BENCH_ITERATIONS");
const requestedWarmupIterations = readOptionalNonNegativeInteger("BENCH_WARMUP");
const options = { exclude: ["error", "warn"] };
const fixtures = createFixtures().filter((fixture) => fixtureFilter.has(fixture.name));

if (fixtures.length === 0) {
  throw new Error(`No fixtures selected. Available fixtures: synthetic, three, typescript`);
}

const runners = [
  {
    name: "babel",
    run(source, filename) {
      const result = babelTransformSync(source, {
        babelrc: false,
        comments: false,
        compact: true,
        configFile: false,
        filename,
        plugins: [[babelRemoveConsole, options]]
      });
      return result?.code ?? "";
    }
  },
  {
    name: "swc",
    run(source, filename) {
      return swcTransformSync(source, {
        filename,
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
    async run(source, filename) {
      const result = await yukuTransform(
        source,
        {
          format: "compact",
          plugins: [[yukuRemoveConsole, options]]
        },
        {
          resourcePath: `${process.cwd()}/bench/${filename}`,
          resourceQuery: "",
          rootContext: process.cwd(),
          source,
          sourceMap: false,
          parseResult: undefined,
          emitWarning() {},
          emitError() {},
          addDependency() {}
        }
      );
      return result.code;
    }
  }
];

console.log(`remove-console benchmark`);
console.log(`fixtures: ${fixtures.map((fixture) => fixture.name).join(", ")}`);
console.log("");

const allResults = [];

for (const fixture of fixtures) {
  const iterations = requestedIterations ?? fixture.iterations;
  const warmupIterations = requestedWarmupIterations ?? fixture.warmupIterations;

  console.log(`### ${fixture.name}`);
  console.log(`source: ${fixture.source.length.toLocaleString()} chars`);
  console.log(`iterations: ${iterations} measured, ${warmupIterations} warmup`);
  console.log("");

  const fixtureResults = [];
  for (const runner of runners) {
    for (let i = 0; i < warmupIterations; i++) {
      await runner.run(fixture.source, fixture.filename);
    }

    const samples = [];
    let output = "";
    for (let i = 0; i < iterations; i++) {
      const start = process.hrtime.bigint();
      output = await runner.run(fixture.source, fixture.filename);
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
      samples.push(elapsedMs);
    }

    validateOutput(fixture.name, runner.name, output);
    const stats = summarize(samples);
    fixtureResults.push({
      ...stats,
      fixture: fixture.name,
      name: runner.name,
      outputBytes: Buffer.byteLength(output)
    });
  }

  const fastest = Math.min(...fixtureResults.map((result) => result.medianMs));
  printMarkdownTable(fixtureResults, fastest);
  allResults.push(...fixtureResults);
  console.log("");
}

writeGitHubSummary(fixtures, allResults);

function createFixtures() {
  return [
    {
      name: "synthetic",
      filename: "synthetic-remove-console.js",
      source: withConsoleMarkers(createSyntheticFixture(units)),
      iterations: 20,
      warmupIterations: 5
    },
    {
      name: "three",
      filename: "three.module.js",
      source: withConsoleMarkers(readFileSync(resolveThreeModule(), "utf8")),
      iterations: 3,
      warmupIterations: 1
    },
    {
      name: "typescript",
      filename: "typescript.js",
      source: withConsoleMarkers(readFileSync(require.resolve("typescript/lib/typescript.js"), "utf8")),
      iterations: 1,
      warmupIterations: 0
    }
  ];
}

function resolveThreeModule() {
  const entrypoint = require.resolve("three");
  return join(dirname(dirname(entrypoint)), "build/three.module.js");
}

function withConsoleMarkers(source) {
  return `${source}
console.log("__YUKU_REMOVE_LOG__");
console.debug("__YUKU_REMOVE_DEBUG__");
console.info("__YUKU_REMOVE_INFO__");
console.error("__YUKU_KEEP_ERROR__");
console.warn("__YUKU_KEEP_WARN__");
`;
}

function createSyntheticFixture(count) {
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

function validateOutput(fixture, name, output) {
  for (const marker of ["__YUKU_REMOVE_LOG__", "__YUKU_REMOVE_DEBUG__", "__YUKU_REMOVE_INFO__"]) {
    if (output.includes(marker)) {
      throw new Error(`${fixture}/${name} output still contains removable marker ${marker}`);
    }
  }
  for (const marker of ["__YUKU_KEEP_ERROR__", "__YUKU_KEEP_WARN__"]) {
    if (!output.includes(marker)) {
      throw new Error(`${fixture}/${name} output removed excluded marker ${marker}`);
    }
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

function writeGitHubSummary(fixtures, results) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) {
    return;
  }

  const lines = ["## remove-console benchmark", ""];
  for (const fixture of fixtures) {
    const fixtureResults = results.filter((result) => result.fixture === fixture.name);
    const fastest = Math.min(...fixtureResults.map((result) => result.medianMs));
    lines.push(
      `### ${fixture.name}`,
      "",
      `Source: ${fixture.source.length.toLocaleString()} chars`,
      "",
      "| tool | median ms | mean ms | p95 ms | relative | output bytes |",
      "| --- | ---: | ---: | ---: | ---: | ---: |",
      ...fixtureResults.map((result) => formatRow(result, fastest)),
      ""
    );
  }

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
  return readOptionalPositiveInteger(name) ?? fallback;
}

function readOptionalPositiveInteger(name) {
  const raw = process.env[name];
  if (raw == null || raw === "") {
    return undefined;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function readOptionalNonNegativeInteger(name) {
  const raw = process.env[name];
  if (raw == null || raw === "") {
    return undefined;
  }

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

function readStringList(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === "") {
    return fallback;
  }

  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}
