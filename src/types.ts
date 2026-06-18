import type {
  ParseOptions,
  ParseResult,
  Program,
  Visitors
} from "yuku-parser";
import type { CodegenOptions, CodegenResult, Format } from "yuku-codegen";

export type GenerateMode = "auto" | "print" | "strip" | "minify" | false;

export interface LoaderPluginContext {
  resourcePath: string;
  resourceQuery: string;
  rootContext: string;
  source: string;
  sourceMap: boolean;
  parseResult: ParseResult;
  emitWarning(warning: Error): void;
  emitError(error: Error): void;
  addDependency(file: string): void;
}

export interface LoaderPluginResult {
  program?: Program;
  code?: string;
  map?: CodegenResult["map"] | null;
}

export interface LoaderPluginObject {
  name?: string;
  visitors?: Visitors;
  transform?(
    program: Program,
    context: LoaderPluginContext
  ): void | Program | string | LoaderPluginResult | Promise<void | Program | string | LoaderPluginResult>;
}

export interface LoaderPluginApi {
  visitor(visitors: Visitors): LoaderPluginObject;
  transform(
    transform: LoaderPluginObject["transform"]
  ): LoaderPluginObject;
}

export type LoaderPluginFactory = (
  api: LoaderPluginApi,
  options?: unknown
) => LoaderPluginObject | Visitors | void | Promise<LoaderPluginObject | Visitors | void>;

export type LoaderPlugin =
  | LoaderPluginObject
  | LoaderPluginFactory
  | Visitors
  | string
  | [string | LoaderPluginFactory, unknown];

export interface YukuLoaderOptions {
  plugins?: LoaderPlugin[];
  parse?: ParseOptions;
  codegen?: CodegenOptions;
  generate?: GenerateMode;
  format?: Format;
  ast?: boolean;
}

export type {
  CodegenOptions,
  CodegenResult,
  ParseOptions,
  ParseResult,
  Program,
  Visitors
};
