/**
 * Plugin system — load and execute user-defined tools from .agenticcoder/plugins/
 *
 * Plugin structure:
 *   .agenticcoder/plugins/<name>/plugin.json
 *   .agenticcoder/plugins/<name>/handler.sh (or handler.ts)
 */

import { readdir, readFile, stat } from "fs/promises";
import { join, resolve, extname } from "path";
import { readProjectEnv } from "./env-file";

export type Plugin = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  env?: Record<string, string>;
  handlerPath: string;
  handlerType: "bash" | "typescript";
  pluginDir: string;
};

type PluginManifest = {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  env?: Record<string, string>;
  handler: string;
};

const PLUGIN_DIR = ".agenticcoder/plugins";
const MAX_PLUGIN_OUTPUT = 50_000; // 50KB
const PLUGIN_TIMEOUT = 30_000; // 30s

/**
 * Load all plugins from .agenticcoder/plugins/ directory.
 * Silently skips invalid plugins.
 */
export async function loadPlugins(cwd: string = process.cwd()): Promise<Plugin[]> {
  const pluginsPath = join(cwd, PLUGIN_DIR);
  const plugins: Plugin[] = [];

  try {
    const entries = await readdir(pluginsPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      try {
        const pluginDir = join(pluginsPath, entry.name);
        const manifestPath = join(pluginDir, "plugin.json");
        const content = await readFile(manifestPath, "utf8");
        const manifest = JSON.parse(content) as PluginManifest;

        if (!manifest.name || !manifest.description || !manifest.handler) {
          console.error(`[plugin] Invalid plugin.json in ${entry.name}: missing name, description, or handler`);
          continue;
        }

        const handlerPath = resolve(pluginDir, manifest.handler);
        const ext = extname(manifest.handler).toLowerCase();
        const handlerType = ext === ".ts" || ext === ".js" ? "typescript" : "bash";

        // Verify handler exists
        try {
          await stat(handlerPath);
        } catch {
          console.error(`[plugin] Handler not found: ${handlerPath}`);
          continue;
        }

        plugins.push({
          name: manifest.name,
          description: manifest.description,
          inputSchema: manifest.inputSchema ?? { type: "object", properties: {} },
          env: manifest.env,
          handlerPath,
          handlerType,
          pluginDir,
        });
      } catch (err) {
        console.error(`[plugin] Failed to load plugin "${entry.name}":`, err instanceof Error ? err.message : String(err));
      }
    }
  } catch {
    // plugins directory doesn't exist — that's fine
  }

  return plugins;
}

/**
 * Execute a plugin's handler with the given input.
 * Returns the handler's stdout as a string.
 */
export async function executePlugin(plugin: Plugin, input: unknown): Promise<string> {
  const inputStr = JSON.stringify(input ?? {});

  try {
    if (plugin.handlerType === "typescript") {
      return await executeTypescriptPlugin(plugin, inputStr);
    } else {
      return await executeBashPlugin(plugin, inputStr);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Plugin "${plugin.name}" failed: ${message}`;
  }
}

async function executeBashPlugin(plugin: Plugin, inputJson: string): Promise<string> {
  const isWindows = process.platform === "win32";
  const shell = isWindows
    ? ["powershell", "-NoProfile", "-Command", `$env:PLUGIN_INPUT='${inputJson.replace(/'/g, "''")}'; & '${plugin.handlerPath}'`]
    : ["bash", plugin.handlerPath];

  const proc = Bun.spawn(shell, {
    cwd: plugin.pluginDir,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...readProjectEnv(),
      ...process.env,
      PLUGIN_INPUT: inputJson,
      PROJECT_DIR: process.cwd(),
    },
  });

  const timeout = setTimeout(() => proc.kill(), PLUGIN_TIMEOUT);

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  clearTimeout(timeout);

  if (exitCode !== 0) {
    return `Plugin exited with code ${exitCode}\n${stderr || stdout}`.slice(0, MAX_PLUGIN_OUTPUT);
  }

  return stdout.slice(0, MAX_PLUGIN_OUTPUT);
}

async function executeTypescriptPlugin(plugin: Plugin, inputJson: string): Promise<string> {
  const proc = Bun.spawn(["bun", "run", plugin.handlerPath], {
    cwd: plugin.pluginDir,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...readProjectEnv(),
      ...process.env,
      PLUGIN_INPUT: inputJson,
      PROJECT_DIR: process.cwd(),
    },
  });

  const timeout = setTimeout(() => proc.kill(), PLUGIN_TIMEOUT);

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  clearTimeout(timeout);

  if (exitCode !== 0) {
    return `Plugin exited with code ${exitCode}\n${stderr || stdout}`.slice(0, MAX_PLUGIN_OUTPUT);
  }

  return stdout.slice(0, MAX_PLUGIN_OUTPUT);
}

/**
 * Convert plugins to tool definitions for the AI.
 */
export function pluginsToToolDefinitions(plugins: Plugin[]) {
  return plugins.map((p) => ({
    name: `plugin_${p.name}`,
    description: `[Plugin] ${p.description}`,
    inputSchema: p.inputSchema,
  }));
}

/**
 * Check if a tool name is a plugin tool.
 */
export function isPluginTool(toolName: string): boolean {
  return toolName.startsWith("plugin_");
}

/**
 * Get the plugin name from a tool name.
 */
export function getPluginName(toolName: string): string {
  return toolName.replace(/^plugin_/, "");
}

/**
 * Check if plugins directory exists.
 */
export function hasPluginsDir(cwd: string = process.cwd()): boolean {
  try {
    const fs = require("fs");
    return fs.existsSync(join(cwd, PLUGIN_DIR));
  } catch {
    return false;
  }
}
