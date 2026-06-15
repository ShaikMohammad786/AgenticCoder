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

  return { agentMd, contextFiles, packageJson, detectedFramework };
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
