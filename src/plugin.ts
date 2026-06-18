import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { Program, Visitors } from "yuku-parser";
import { walk } from "yuku-parser";
import type {
  LoaderPlugin,
  LoaderPluginApi,
  LoaderPluginContext,
  LoaderPluginFactory,
  LoaderPluginObject,
  LoaderPluginResult
} from "./types.js";

export interface NormalizedPlugin {
  name: string;
  apply(program: Program, context: LoaderPluginContext): Promise<LoaderPluginResult | void>;
}

const api: LoaderPluginApi = {
  visitor(visitors) {
    return { visitors };
  },
  transform(transform) {
    return { transform };
  }
};

export async function normalizePlugins(
  plugins: LoaderPlugin[] | undefined,
  context: LoaderPluginContext
): Promise<NormalizedPlugin[]> {
  const normalized: NormalizedPlugin[] = [];

  for (const plugin of plugins ?? []) {
    normalized.push(await normalizePlugin(plugin, context));
  }

  return normalized;
}

async function normalizePlugin(
  plugin: LoaderPlugin,
  context: LoaderPluginContext
): Promise<NormalizedPlugin> {
  if (Array.isArray(plugin)) {
    const [entry, options] = plugin;
    const loaded = typeof entry === "string" ? await loadPlugin(entry, context) : entry;
    return normalizeLoadedPlugin(loaded, options, context, entry);
  }

  const loaded = typeof plugin === "string" ? await loadPlugin(plugin, context) : plugin;
  return normalizeLoadedPlugin(loaded, undefined, context, plugin);
}

async function loadPlugin(request: string, context: LoaderPluginContext): Promise<unknown> {
  const resolved = resolvePluginRequest(request, context);
  const url = resolved.startsWith("file:")
    ? resolved
    : pathToFileURL(resolved).toString();

  context.addDependency(resolved.startsWith("file:") ? new URL(resolved).pathname : resolved);

  const mod = await import(url);
  return mod.default ?? mod.plugin ?? mod;
}

function resolvePluginRequest(request: string, context: LoaderPluginContext): string {
  if (request.startsWith("file:")) {
    return request;
  }

  if (path.isAbsolute(request)) {
    return request;
  }

  const fromRoot = createRequire(path.join(context.rootContext, "rspack.config.js"));
  return fromRoot.resolve(request, {
    paths: [context.rootContext, path.dirname(context.resourcePath)]
  });
}

async function normalizeLoadedPlugin(
  loaded: unknown,
  options: unknown,
  context: LoaderPluginContext,
  original: unknown
): Promise<NormalizedPlugin> {
  if (typeof loaded === "function") {
    const value = await (loaded as LoaderPluginFactory)(api, options);
    if (value == null) {
      throw new TypeError(pluginLabel(original) + " did not return a plugin");
    }
    return normalizeLoadedPlugin(value, options, context, original);
  }

  if (isPluginObject(loaded)) {
    const name = loaded.name ?? pluginLabel(original);
    return {
      name,
      async apply(program, pluginContext) {
        if (loaded.visitors) {
          walk(program, loaded.visitors, pluginContext);
        }

        if (loaded.transform) {
          return normalizeResult(await loaded.transform(program, pluginContext));
        }
      }
    };
  }

  if (isVisitors(loaded)) {
    const name = pluginLabel(original);
    return {
      name,
      async apply(program, pluginContext) {
        walk(program, loaded, pluginContext);
      }
    };
  }

  throw new TypeError(pluginLabel(original) + " is not a valid rspack-yuku-loader plugin");
}

function normalizeResult(result: unknown): LoaderPluginResult | void {
  if (result == null) {
    return;
  }

  if (typeof result === "string") {
    return { code: result };
  }

  if (isProgram(result)) {
    return { program: result };
  }

  if (typeof result === "object") {
    const maybeResult = result as LoaderPluginResult;
    if ("program" in maybeResult || "code" in maybeResult || "map" in maybeResult) {
      return maybeResult;
    }
  }

  throw new TypeError("Plugin transform must return void, a Program, code string, or { program, code, map }");
}

function isPluginObject(value: unknown): value is LoaderPluginObject {
  return Boolean(
    value &&
      typeof value === "object" &&
      ("transform" in value || "visitors" in value || "name" in value)
  );
}

function isVisitors(value: unknown): value is Visitors {
  return Boolean(value && typeof value === "object");
}

function isProgram(value: unknown): value is Program {
  return Boolean(value && typeof value === "object" && (value as { type?: unknown }).type === "Program");
}

function pluginLabel(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "function" && value.name) {
    return value.name;
  }
  return "anonymous plugin";
}
