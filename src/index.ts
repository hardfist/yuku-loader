import path from "node:path";
import { minify, print, strip } from "yuku-codegen";
import {
  langFromPath,
  parse,
  sourceTypeFromPath
} from "yuku-parser";
import { normalizePlugins } from "./plugin.js";
import type {
  GenerateMode,
  LoaderPluginContext,
  LoaderPluginResult,
  RspackYukuLoaderOptions
} from "./types.js";

export type * from "./types.js";

type LoaderCallback = (
  error: Error | null,
  content?: string | Buffer,
  sourceMap?: unknown,
  additionalData?: unknown
) => void;

interface MinimalLoaderContext {
  resourcePath: string;
  resourceQuery?: string;
  rootContext?: string;
  sourceMap?: boolean;
  async(): LoaderCallback;
  getOptions?(): RspackYukuLoaderOptions;
  emitWarning?(warning: Error): void;
  emitError?(error: Error): void;
  addDependency?(file: string): void;
}

export default async function rspackYukuLoader(
  this: MinimalLoaderContext,
  source: string | Buffer
): Promise<void> {
  const callback = this.async();
  const input = Buffer.isBuffer(source) ? source.toString("utf8") : source;
  const options = this.getOptions?.() ?? {};

  try {
    const result = await transform(input, options, createPluginContext(this, input));
    callback(
      null,
      result.code,
      result.map ?? undefined,
      options.ast === false ? undefined : { webpackAST: result.program }
    );
  } catch (error) {
    callback(error instanceof Error ? error : new Error(String(error)));
  }
}

export async function transform(
  source: string,
  options: RspackYukuLoaderOptions,
  context: LoaderPluginContext
): Promise<Required<LoaderPluginResult> & { program: NonNullable<LoaderPluginResult["program"]> }> {
  const parseResult = parse(source, {
    sourceType: sourceTypeFromPath(context.resourcePath),
    lang: langFromPath(context.resourcePath),
    ...options.parse
  });

  context.parseResult = parseResult;

  if (parseResult.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    throw new Error(formatDiagnostics(parseResult.diagnostics));
  }

  let program = parseResult.program;
  let code: string | undefined;
  let map: LoaderPluginResult["map"] | undefined;

  for (const plugin of await normalizePlugins(options.plugins, context)) {
    const result = await plugin.apply(program, context);
    if (result?.program) {
      program = result.program;
    }
    if (result?.code != null) {
      code = result.code;
    }
    if ("map" in (result ?? {})) {
      map = result?.map ?? null;
    }
  }

  if (code == null && options.generate !== false) {
    const generated = generate(program, parseResult.lineStarts, source, options, context);
    code = generated.code;
    map = generated.map;

    if (generated.errors.length > 0) {
      throw new Error(
        generated.errors
          .map((error) => `${context.resourcePath}:${error.start}-${error.end} ${error.message}`)
          .join("\n")
      );
    }
  }

  return {
    program,
    code: code ?? source,
    map: map ?? null
  };
}

function generate(
  program: NonNullable<LoaderPluginResult["program"]>,
  lineStarts: number[],
  source: string,
  options: RspackYukuLoaderOptions,
  context: LoaderPluginContext
) {
  const requestedMode = options.generate === false ? "auto" : options.generate ?? "auto";
  const mode = resolveGenerateMode(requestedMode, context.resourcePath);
  const codegenOptions = {
    format: options.format,
    ...options.codegen,
    sourceMaps: context.sourceMap
      ? {
          lineStarts,
          sourceFileName: path.basename(context.resourcePath),
          sourcesContent: source,
          ...options.codegen?.sourceMaps
        }
      : options.codegen?.sourceMaps
  };

  if (mode === "minify") {
    return minify(program, codegenOptions);
  }

  if (mode === "strip") {
    return strip(program, codegenOptions);
  }

  return print(program, codegenOptions);
}

function resolveGenerateMode(
  mode: Exclude<GenerateMode, false>,
  resourcePath: string
): Exclude<GenerateMode, "auto" | false> {
  if (mode !== "auto") {
    return mode;
  }

  return /\.(?:[cm]?tsx?|d\.ts)$/i.test(resourcePath) ? "strip" : "print";
}

function createPluginContext(loaderContext: MinimalLoaderContext, source: string): LoaderPluginContext {
  return {
    resourcePath: loaderContext.resourcePath,
    resourceQuery: loaderContext.resourceQuery ?? "",
    rootContext: loaderContext.rootContext ?? process.cwd(),
    source,
    sourceMap: Boolean(loaderContext.sourceMap),
    parseResult: undefined as never,
    emitWarning(warning) {
      loaderContext.emitWarning?.(warning);
    },
    emitError(error) {
      loaderContext.emitError?.(error);
    },
    addDependency(file) {
      loaderContext.addDependency?.(file);
    }
  };
}

function formatDiagnostics(diagnostics: Array<{ severity?: string; message: string; start?: number; end?: number }>): string {
  return diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => {
      const range =
        diagnostic.start == null || diagnostic.end == null
          ? ""
          : ` ${diagnostic.start}-${diagnostic.end}`;
      return `${diagnostic.message}${range}`;
    })
    .join("\n");
}
