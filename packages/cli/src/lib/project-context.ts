/**
 * Smart project context injection.
 *
 * Gathers project metadata from:
 *   1. .agenticcoder/AGENT.md — project memory / instructions
 *   2. .agenticcoder/context/*.md — additional context files
 *   3. package.json — detects framework, dependencies, scripts
 *
 * The output string is injected into the AI system prompt so the model
 * understands the project structure without the user repeating themselves.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

// ── Types ──────────────────────────────────────────────────────────────────

type ProjectContext = {
  agentMd: string | null;
  contextFiles: { name: string; content: string }[];
  packageJson: {
    name?: string;
    description?: string;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  } | null;
  detectedFramework: string | null;
  agenticCoder: {
    plugins: { name: string; description: string; handler?: string; envVars: string[] }[];
    mcpServers: { name: string; command?: string; envVars: string[] }[];
    skills: string[];
    envKeys: string[];
  };
};

// ── Framework detection ────────────────────────────────────────────────────

const FRAMEWORK_SIGNATURES: [string, string][] = [
  ["next", "Next.js"],
  ["nuxt", "Nuxt"],
  ["@angular/core", "Angular"],
  ["vue", "Vue"],
  ["svelte", "Svelte"],
  ["react", "React"],
  ["express", "Express"],
  ["fastify", "Fastify"],
  ["hono", "Hono"],
  ["@nestjs/core", "NestJS"],
  ["django", "Django"],
  ["flask", "Flask"],
  ["prisma", "Prisma"],
  ["drizzle-orm", "Drizzle"],
];

function detectFramework(deps: Record<string, string>): string | null {
  for (const [pkg, name] of FRAMEWORK_SIGNATURES) {
    if (deps[pkg]) return name;
  }
  return null;
}

// ── Gather context ─────────────────────────────────────────────────────────

function gatherProjectContext(cwd?: string): ProjectContext {
  const root = cwd ?? process.cwd();
  const agenticDir = join(root, ".agenticcoder");

  // 1. AGENT.md
  let agentMd: string | null = null;
  const agentMdPath = join(agenticDir, "AGENT.md");
  if (existsSync(agentMdPath)) {
    try {
      agentMd = readFileSync(agentMdPath, "utf8").trim();
    } catch {}
  }

  // 2. Context files
  const contextFiles: { name: string; content: string }[] = [];
  const contextDir = join(agenticDir, "context");
  if (existsSync(contextDir)) {
    try {
      const files = readdirSync(contextDir).filter((f) => f.endsWith(".md"));
      for (const file of files) {
        try {
          const content = readFileSync(join(contextDir, file), "utf8").trim();
          if (content) {
            contextFiles.push({ name: file, content });
          }
        } catch {}
      }
    } catch {}
  }

  // 3. package.json
  let packageJson: ProjectContext["packageJson"] = null;
  const pkgPath = join(root, "package.json");
  if (existsSync(pkgPath)) {
    try {
      packageJson = JSON.parse(readFileSync(pkgPath, "utf8"));
    } catch {}
  }

  // 4. Framework detection
  const allDeps = {
    ...(packageJson?.dependencies ?? {}),
    ...(packageJson?.devDependencies ?? {}),
  };
  const detectedFramework = detectFramework(allDeps);
  const agenticCoder = gatherAgenticCoderContext(root, agenticDir);

  return { agentMd, contextFiles, packageJson, detectedFramework, agenticCoder };
}

function gatherAgenticCoderContext(root: string, agenticDir: string): ProjectContext["agenticCoder"] {
  const plugins: ProjectContext["agenticCoder"]["plugins"] = [];
  const pluginsDir = join(agenticDir, "plugins");
  if (existsSync(pluginsDir)) {
    try {
      const entries = readdirSync(pluginsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const manifestPath = join(pluginsDir, entry.name, "plugin.json");
        if (!existsSync(manifestPath)) continue;
        try {
          const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
            name?: string;
            description?: string;
            handler?: string;
            env?: Record<string, string>;
          };
          plugins.push({
            name: manifest.name || entry.name,
            description: manifest.description || "No description",
            handler: manifest.handler,
            envVars: Object.keys(manifest.env ?? {}),
          });
        } catch {}
      }
    } catch {}
  }

  const mcpServers: ProjectContext["agenticCoder"]["mcpServers"] = [];
  const mcpConfigPath = join(agenticDir, "mcp.json");
  if (existsSync(mcpConfigPath)) {
    try {
      const config = JSON.parse(readFileSync(mcpConfigPath, "utf8")) as {
        mcpServers?: Record<string, { command?: string; env?: Record<string, string> }>;
      };
      for (const [name, server] of Object.entries(config.mcpServers ?? {})) {
        mcpServers.push({
          name,
          command: server.command,
          envVars: Object.keys(server.env ?? {}),
        });
      }
    } catch {}
  }

  const skills: string[] = [];
  const skillsDir = join(agenticDir, "skills");
  if (existsSync(skillsDir)) {
    try {
      for (const file of readdirSync(skillsDir)) {
        if (file.endsWith(".md")) skills.push(file);
      }
    } catch {}
  }

  const envKeys = readEnvKeys(join(root, ".env"));
  return { plugins, mcpServers, skills, envKeys };
}

function readEnvKeys(path: string): string[] {
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1])
      .filter((key): key is string => Boolean(key))
      .sort();
  } catch {
    return [];
  }
}

// ── Format for prompt ──────────────────────────────────────────────────────

function formatContextForPrompt(ctx: ProjectContext): string {
  const parts: string[] = [];

  if (ctx.agentMd) {
    parts.push("## Project Instructions (AGENT.md)\n\n" + ctx.agentMd);
  }

  for (const file of ctx.contextFiles) {
    parts.push(`## Context: ${file.name}\n\n${file.content}`);
  }

  if (ctx.packageJson) {
    const info: string[] = [];
    if (ctx.packageJson.name) info.push(`- **Project**: ${ctx.packageJson.name}`);
    if (ctx.packageJson.description) info.push(`- **Description**: ${ctx.packageJson.description}`);
    if (ctx.detectedFramework) info.push(`- **Framework**: ${ctx.detectedFramework}`);
    if (ctx.packageJson.scripts) {
      const scripts = Object.keys(ctx.packageJson.scripts).join(", ");
      info.push(`- **Scripts**: ${scripts}`);
    }
    if (info.length > 0) {
      parts.push("## Project Info\n\n" + info.join("\n"));
    }
  }

  const agenticInfo: string[] = [];
  if (ctx.agenticCoder.plugins.length > 0) {
    agenticInfo.push("### Installed Plugins");
    for (const plugin of ctx.agenticCoder.plugins) {
      const env = plugin.envVars.length > 0 ? ` Requires env: ${plugin.envVars.join(", ")}.` : "";
      agenticInfo.push(`- \`plugin_${plugin.name}\`: ${plugin.description}${env}`);
    }
  }

  if (ctx.agenticCoder.mcpServers.length > 0) {
    agenticInfo.push("### Configured MCP Servers");
    for (const server of ctx.agenticCoder.mcpServers) {
      const env = server.envVars.length > 0 ? ` Requires env: ${server.envVars.join(", ")}.` : "";
      agenticInfo.push(`- \`${server.name}\`${server.command ? ` via \`${server.command}\`` : ""}.${env}`);
    }
  }

  if (ctx.agenticCoder.skills.length > 0) {
    agenticInfo.push("### Local Skills");
    for (const skill of ctx.agenticCoder.skills) {
      agenticInfo.push(`- \`.agenticcoder/skills/${skill}\``);
    }
  }

  if (ctx.agenticCoder.envKeys.length > 0) {
    agenticInfo.push("### Project Environment");
    agenticInfo.push(`- .env defines these keys: ${ctx.agenticCoder.envKeys.map((key) => `\`${key}\``).join(", ")}.`);
    agenticInfo.push("- Secret values are intentionally not included in prompt context.");
  }

  if (agenticInfo.length > 0) {
    parts.push("## AgenticCoder Capabilities\n\n" + agenticInfo.join("\n"));
  }

  return parts.length > 0
    ? truncateContext("# Project Context\n\n" + parts.join("\n\n---\n\n"))
    : "";
}

const MAX_CONTEXT_SIZE = 50_000; // 50KB limit
function truncateContext(text: string): string {
  if (text.length <= MAX_CONTEXT_SIZE) return text;
  return text.slice(0, MAX_CONTEXT_SIZE) + "\n\n... (project context truncated at 50KB)";
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Get the full context injection string for the current project.
 */
export function getProjectContextInjection(cwd?: string): string {
  const context = gatherProjectContext(cwd);
  return formatContextForPrompt(context);
}

/**
 * Get the absolute path to the project's .agenticcoder directory.
 */
export function getAgenticCoderDir(cwd?: string): string {
  return resolve(cwd ?? process.cwd(), ".agenticcoder");
}

/**
 * Async wrapper for getProjectContextInjection — used by use-chat.ts
 */
export async function buildProjectContext(cwd?: string): Promise<string> {
  return getProjectContextInjection(cwd);
}
