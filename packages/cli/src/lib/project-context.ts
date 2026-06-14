/**
 * Smart Context Injection — reads project context files and injects them
 * into the AI system prompt for better, project-aware responses.
 * 
 * Reads from:
 * - .agenticcoder/AGENT.md (project memory file)
 * - .agenticcoder/context/*.md (additional context files)
 * - package.json (project metadata)
 * - tsconfig.json (TypeScript config)
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

interface ProjectContext {
  projectName: string;
  projectDescription: string;
  agentMemory: string | null;
  contextFiles: { name: string; content: string }[];
  techStack: string[];
  dependencies: string[];
}

/**
 * Gather all project context from the current working directory.
 */
export function gatherProjectContext(cwd?: string): ProjectContext {
  const root = cwd ?? process.cwd();

  const context: ProjectContext = {
    projectName: "",
    projectDescription: "",
    agentMemory: null,
    contextFiles: [],
    techStack: [],
    dependencies: [],
  };

  // Read package.json
  try {
    const pkgPath = join(root, "package.json");
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      context.projectName = pkg.name ?? "";
      context.projectDescription = pkg.description ?? "";
      context.dependencies = [
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
      ];
    }
  } catch {
    // ignore
  }

  // Detect tech stack from dependencies
  const depSet = new Set(context.dependencies);
  if (depSet.has("react")) context.techStack.push("React");
  if (depSet.has("next")) context.techStack.push("Next.js");
  if (depSet.has("vue")) context.techStack.push("Vue");
  if (depSet.has("express")) context.techStack.push("Express");
  if (depSet.has("hono")) context.techStack.push("Hono");
  if (depSet.has("prisma") || depSet.has("@prisma/client"))
    context.techStack.push("Prisma");
  if (depSet.has("drizzle-orm")) context.techStack.push("Drizzle");
  if (depSet.has("mongoose")) context.techStack.push("MongoDB/Mongoose");
  if (depSet.has("tailwindcss")) context.techStack.push("Tailwind CSS");
  if (depSet.has("typescript")) context.techStack.push("TypeScript");

  // Read .agenticcoder/AGENT.md
  try {
    const agentPath = join(root, ".agenticcoder", "AGENT.md");
    if (existsSync(agentPath)) {
      context.agentMemory = readFileSync(agentPath, "utf8");
    }
  } catch {
    // ignore
  }

  // Read .agenticcoder/context/*.md
  try {
    const contextDir = join(root, ".agenticcoder", "context");
    if (existsSync(contextDir)) {
      const files = readdirSync(contextDir).filter((f) =>
        f.endsWith(".md")
      );
      for (const file of files) {
        try {
          const content = readFileSync(join(contextDir, file), "utf8");
          context.contextFiles.push({ name: file, content });
        } catch {
          // skip unreadable files
        }
      }
    }
  } catch {
    // ignore
  }

  // Also check for tsconfig to add TypeScript if not detected from deps
  try {
    if (
      !context.techStack.includes("TypeScript") &&
      existsSync(join(root, "tsconfig.json"))
    ) {
      context.techStack.push("TypeScript");
    }
  } catch {
    // ignore
  }

  return context;
}

/**
 * Format the project context into a system prompt injection string.
 */
export function formatContextForPrompt(context: ProjectContext): string {
  const parts: string[] = [];

  if (context.projectName) {
    parts.push(`Project: ${context.projectName}`);
  }
  if (context.projectDescription) {
    parts.push(`Description: ${context.projectDescription}`);
  }
  if (context.techStack.length > 0) {
    parts.push(`Tech Stack: ${context.techStack.join(", ")}`);
  }
  if (context.agentMemory) {
    parts.push(`\n--- Project Memory ---\n${context.agentMemory}`);
  }
  for (const file of context.contextFiles) {
    parts.push(`\n--- ${file.name} ---\n${file.content}`);
  }

  if (parts.length === 0) return "";

  return `<project_context>\n${parts.join("\n")}\n</project_context>`;
}

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
 * Alias for getProjectContextInjection — used by use-chat.ts
 */
export const buildProjectContext = getProjectContextInjection;
