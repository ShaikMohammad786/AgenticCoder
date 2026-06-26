/**
 * Plugin Registry — install, remove, and update external plugins.
 *
 * Supported sources:
 *   github:user/repo           → GitHub tarball download
 *   npm:package-name           → npm pack + extract
 *   https://url.tar.gz         → Direct URL download
 *
 * Installed plugins are stored in .agenticcoder/plugins/<name>/
 * with a `.source` metadata file for update tracking.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "fs";
import { readdir, stat, readFile } from "fs/promises";
import { join, basename } from "path";

const PLUGIN_DIR = ".agenticcoder/plugins";
const SOURCE_FILE = ".source.json";

// ─── Types ────────────────────────────────────────────────────────

export type PluginSource = {
  type: "github" | "npm" | "url";
  raw: string; // original install string
  owner?: string; // github owner
  repo?: string; // github repo
  packageName?: string; // npm package name
  url?: string; // direct url
  installedAt: string;
  version?: string;
};

export type InstalledPlugin = {
  name: string;
  description: string;
  source: PluginSource;
  handlerType: string;
  path: string;
};

export type InstallResult = {
  success: boolean;
  name: string;
  message: string;
};

// ─── Source Parsing ──────────────────────────────────────────────

function parseSource(input: string): PluginSource {
  const trimmed = input.trim();

  // github:user/repo
  if (trimmed.startsWith("github:")) {
    const parts = trimmed.slice(7).split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(`Invalid GitHub source: "${trimmed}". Expected format: github:user/repo`);
    }
    return {
      type: "github",
      raw: trimmed,
      owner: parts[0],
      repo: parts[1],
      installedAt: new Date().toISOString(),
    };
  }

  // npm:package-name
  if (trimmed.startsWith("npm:")) {
    const packageName = trimmed.slice(4);
    if (!packageName || packageName.includes(" ")) {
      throw new Error(`Invalid npm source: "${trimmed}". Expected format: npm:package-name`);
    }
    return {
      type: "npm",
      raw: trimmed,
      packageName,
      installedAt: new Date().toISOString(),
    };
  }

  // Direct URL (https:// or http://)
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return {
      type: "url",
      raw: trimmed,
      url: trimmed,
      installedAt: new Date().toISOString(),
    };
  }

  throw new Error(
    `Unknown plugin source: "${trimmed}"\n` +
    `Supported formats:\n` +
    `  github:user/repo\n` +
    `  npm:package-name\n` +
    `  https://example.com/plugin.tar.gz`
  );
}

// ─── Install ────────────────────────────────────────────────────

export async function installPlugin(
  sourceStr: string,
  cwd: string = process.cwd(),
): Promise<InstallResult> {
  const source = parseSource(sourceStr);
  const pluginsDir = join(cwd, PLUGIN_DIR);

  // Ensure plugins directory exists
  if (!existsSync(pluginsDir)) {
    mkdirSync(pluginsDir, { recursive: true });
  }

  try {
    switch (source.type) {
      case "github":
        return await installFromGitHub(source, pluginsDir);
      case "npm":
        return await installFromNpm(source, pluginsDir);
      case "url":
        return await installFromUrl(source, pluginsDir);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, name: sourceStr, message: `Install failed: ${msg}` };
  }
}

async function installFromGitHub(
  source: PluginSource,
  pluginsDir: string,
): Promise<InstallResult> {
  const { owner, repo } = source;
  const tarballUrl = `https://api.github.com/repos/${owner}/${repo}/tarball`;
  const pluginName = repo!;
  const targetDir = join(pluginsDir, pluginName);

  // Check if already installed
  if (existsSync(targetDir)) {
    return { success: false, name: pluginName, message: `Plugin "${pluginName}" is already installed. Use update to refresh.` };
  }

  console.error(`[plugin] Downloading from GitHub: ${owner}/${repo}...`);

  // Download tarball
  const response = await fetch(tarballUrl, {
    headers: { "User-Agent": "AgenticCoder-CLI" },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status}: ${await response.text()}`);
  }

  // Extract tarball
  const buffer = await response.arrayBuffer();
  mkdirSync(targetDir, { recursive: true });

  await extractTarball(Buffer.from(buffer), targetDir);

  // Validate plugin.json exists
  if (!existsSync(join(targetDir, "plugin.json"))) {
    rmSync(targetDir, { recursive: true, force: true });
    throw new Error(`No plugin.json found in ${owner}/${repo}. Not a valid AgenticCoder plugin.`);
  }

  // Save source metadata
  saveSourceMeta(targetDir, source);

  return { success: true, name: pluginName, message: `Installed "${pluginName}" from GitHub (${owner}/${repo})` };
}

async function installFromNpm(
  source: PluginSource,
  pluginsDir: string,
): Promise<InstallResult> {
  const { packageName } = source;
  const pluginName = packageName!.replace(/^@[^/]+\//, ""); // strip scope
  const targetDir = join(pluginsDir, pluginName);

  if (existsSync(targetDir)) {
    return { success: false, name: pluginName, message: `Plugin "${pluginName}" is already installed.` };
  }

  console.error(`[plugin] Installing from npm: ${packageName}...`);

  // Use npm pack to download the tarball
  const tmpDir = join(pluginsDir, `.tmp-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  try {
    const proc = Bun.spawn(["npm", "pack", packageName!, "--pack-destination", tmpDir], {
      cwd: tmpDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      throw new Error(`npm pack failed: ${stderr || stdout}`);
    }

    // Find the .tgz file
    const tgzFile = stdout.trim().split("\n").pop()?.trim();
    if (!tgzFile) throw new Error("npm pack produced no output");

    const tgzPath = join(tmpDir, tgzFile);
    if (!existsSync(tgzPath)) throw new Error(`Tarball not found: ${tgzPath}`);

    // Extract
    mkdirSync(targetDir, { recursive: true });
    const tarBuffer = readFileSync(tgzPath);
    await extractTarball(tarBuffer, targetDir);

    // Validate
    if (!existsSync(join(targetDir, "plugin.json"))) {
      rmSync(targetDir, { recursive: true, force: true });
      throw new Error(`No plugin.json in npm package "${packageName}". Not a valid AgenticCoder plugin.`);
    }

    saveSourceMeta(targetDir, source);
    return { success: true, name: pluginName, message: `Installed "${pluginName}" from npm (${packageName})` };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function installFromUrl(
  source: PluginSource,
  pluginsDir: string,
): Promise<InstallResult> {
  const url = source.url!;
  const urlPath = new URL(url).pathname;
  const fileName = basename(urlPath).replace(/\.(tar\.gz|tgz|zip)$/, "");
  const pluginName = fileName || `plugin-${Date.now()}`;
  const targetDir = join(pluginsDir, pluginName);

  if (existsSync(targetDir)) {
    return { success: false, name: pluginName, message: `Plugin "${pluginName}" is already installed.` };
  }

  console.error(`[plugin] Downloading from URL: ${url}...`);

  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}): ${url}`);
  }

  const buffer = await response.arrayBuffer();
  mkdirSync(targetDir, { recursive: true });

  // Check if it's a tarball or needs manual extraction
  if (url.endsWith(".tar.gz") || url.endsWith(".tgz")) {
    await extractTarball(Buffer.from(buffer), targetDir);
  } else if (url.endsWith(".zip")) {
    // For zip files, save and use unzip
    const zipPath = join(targetDir, "plugin.zip");
    writeFileSync(zipPath, Buffer.from(buffer));
    const proc = Bun.spawn(["bun", "-e", `
      const AdmZip = require('adm-zip');
      const zip = new AdmZip('${zipPath.replace(/\\/g, "\\\\")}');
      zip.extractAllTo('${targetDir.replace(/\\/g, "\\\\")}', true);
    `], { cwd: targetDir, stdout: "pipe", stderr: "pipe" });
    await proc.exited;
    rmSync(zipPath, { force: true });
  } else {
    // Assume it's a single plugin.json or handler file
    writeFileSync(join(targetDir, basename(urlPath)), Buffer.from(buffer));
  }

  if (!existsSync(join(targetDir, "plugin.json"))) {
    rmSync(targetDir, { recursive: true, force: true });
    throw new Error(`No plugin.json found at URL. Not a valid AgenticCoder plugin.`);
  }

  saveSourceMeta(targetDir, source);
  return { success: true, name: pluginName, message: `Installed "${pluginName}" from URL` };
}

// ─── Tarball Extraction ──────────────────────────────────────────

async function extractTarball(buffer: Buffer, targetDir: string): Promise<void> {
  // Use bun/node's tar via shell — works cross-platform
  const tmpTar = join(targetDir, `.tmp-${Date.now()}.tar.gz`);
  writeFileSync(tmpTar, buffer);

  try {
    const isWindows = process.platform === "win32";
    const cmd = isWindows
      ? ["powershell", "-NoProfile", "-Command", `tar -xzf '${tmpTar}' -C '${targetDir}' --strip-components=1`]
      : ["tar", "-xzf", tmpTar, "-C", targetDir, "--strip-components=1"];

    const proc = Bun.spawn(cmd, {
      cwd: targetDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      // Fallback: try without --strip-components
      const fallbackCmd = isWindows
        ? ["powershell", "-NoProfile", "-Command", `tar -xzf '${tmpTar}' -C '${targetDir}'`]
        : ["tar", "-xzf", tmpTar, "-C", targetDir];

      const fallback = Bun.spawn(fallbackCmd, { cwd: targetDir, stdout: "pipe", stderr: "pipe" });
      const fbStderr = await new Response(fallback.stderr).text();
      const fbExit = await fallback.exited;
      if (fbExit !== 0) throw new Error(`tar extraction failed: ${fbStderr}`);

      // If there's a single nested directory, move its contents up
      await flattenSingleDir(targetDir);
    }
  } finally {
    rmSync(tmpTar, { force: true });
  }
}

async function flattenSingleDir(dir: string): Promise<void> {
  const entries = await readdir(dir);
  // Filter out hidden/meta files
  const meaningful = entries.filter(e => !e.startsWith(".") && !e.startsWith("tmp"));
  if (meaningful.length === 1) {
    const subDir = join(dir, meaningful[0]!);
    const subStat = await stat(subDir);
    if (subStat.isDirectory()) {
      // Check if plugin.json is inside the subdirectory
      if (existsSync(join(subDir, "plugin.json"))) {
        const subEntries = await readdir(subDir);
        for (const entry of subEntries) {
          const src = join(subDir, entry);
          const dest = join(dir, entry);
          if (!existsSync(dest)) {
            const { renameSync } = require("fs");
            renameSync(src, dest);
          }
        }
        rmSync(subDir, { recursive: true, force: true });
      }
    }
  }
}

// ─── Remove ─────────────────────────────────────────────────────

export async function removePlugin(
  pluginName: string,
  cwd: string = process.cwd(),
): Promise<InstallResult> {
  const targetDir = join(cwd, PLUGIN_DIR, pluginName);

  if (!existsSync(targetDir)) {
    return { success: false, name: pluginName, message: `Plugin "${pluginName}" is not installed.` };
  }

  try {
    rmSync(targetDir, { recursive: true, force: true });
    return { success: true, name: pluginName, message: `Removed plugin "${pluginName}"` };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, name: pluginName, message: `Failed to remove: ${msg}` };
  }
}

// ─── Update ─────────────────────────────────────────────────────

export async function updatePlugin(
  pluginName: string,
  cwd: string = process.cwd(),
): Promise<InstallResult> {
  const targetDir = join(cwd, PLUGIN_DIR, pluginName);
  const sourcePath = join(targetDir, SOURCE_FILE);

  if (!existsSync(targetDir)) {
    return { success: false, name: pluginName, message: `Plugin "${pluginName}" is not installed.` };
  }

  if (!existsSync(sourcePath)) {
    return { success: false, name: pluginName, message: `Plugin "${pluginName}" was installed manually — no source to update from.` };
  }

  try {
    const source: PluginSource = JSON.parse(readFileSync(sourcePath, "utf8"));

    // Remove old version
    rmSync(targetDir, { recursive: true, force: true });

    // Re-install from source
    return await installPlugin(source.raw, cwd);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, name: pluginName, message: `Update failed: ${msg}` };
  }
}

// ─── List Installed ─────────────────────────────────────────────

export async function listInstalledPlugins(
  cwd: string = process.cwd(),
): Promise<InstalledPlugin[]> {
  const pluginsDir = join(cwd, PLUGIN_DIR);
  const results: InstalledPlugin[] = [];

  if (!existsSync(pluginsDir)) return results;

  try {
    const entries = await readdir(pluginsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

      const pluginDir = join(pluginsDir, entry.name);
      const manifestPath = join(pluginDir, "plugin.json");
      const sourcePath = join(pluginDir, SOURCE_FILE);

      if (!existsSync(manifestPath)) continue;

      try {
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        const source: PluginSource = existsSync(sourcePath)
          ? JSON.parse(await readFile(sourcePath, "utf8"))
          : { type: "url", raw: "local", installedAt: "unknown" };

        results.push({
          name: manifest.name || entry.name,
          description: manifest.description || "",
          source,
          handlerType: manifest.handler?.endsWith(".ts") || manifest.handler?.endsWith(".js")
            ? "typescript"
            : "bash",
          path: pluginDir,
        });
      } catch {
        // skip broken plugins
      }
    }
  } catch {
    // plugins dir doesn't exist
  }

  return results;
}

// ─── Source Metadata ─────────────────────────────────────────────

function saveSourceMeta(pluginDir: string, source: PluginSource): void {
  try {
    writeFileSync(
      join(pluginDir, SOURCE_FILE),
      JSON.stringify(source, null, 2),
    );
  } catch {
    // non-critical
  }
}
