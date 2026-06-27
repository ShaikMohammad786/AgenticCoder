/**
 * Skills system — reusable prompt templates from .agenticcoder/skills/
 *
 * Skill format (markdown with YAML frontmatter):
 *   ---
 *   name: Code Review
 *   description: Review code for bugs and best practices
 *   mode: PLAN
 *   ---
 *   Review the following code for bugs, security issues...
 */

import { readdir, readFile, mkdir, writeFile } from "fs/promises";
import { join, extname } from "path";
import type { ModeType } from "@agenticcoder/shared";

export type Skill = {
  name: string;
  description: string;
  mode?: ModeType;
  prompt: string;
  filePath: string;
};

const SKILLS_DIR = ".agenticcoder/skills";

export type SkillCatalogEntry = {
  name: string;
  description: string;
  mode?: ModeType;
  fileName: string;
  prompt: string;
};

export const SKILL_CATALOG: SkillCatalogEntry[] = [
  {
    name: "Security Audit",
    description: "Find auth, injection, secret-handling, SSRF, and data exposure risks",
    mode: "PLAN" as ModeType,
    fileName: "security-audit.md",
    prompt: `Perform a focused security audit of this project. Prioritize exploitable bugs over style issues.

Check authentication and authorization boundaries, input validation, SSRF, command execution, path traversal, secret exposure, dependency risk, unsafe deserialization, database access, and logging of sensitive data.

Return findings ordered by severity with file references, impact, and concrete fixes. If there are no high-confidence issues, say that clearly and list residual risk.`,
  },
  {
    name: "Frontend Polish",
    description: "Improve UI layout, responsive behavior, states, and accessibility",
    mode: "BUILD" as ModeType,
    fileName: "frontend-polish.md",
    prompt: `Review the current frontend experience and make targeted improvements.

Focus on responsive layout, overflow, loading/empty/error states, keyboard behavior, contrast, spacing consistency, and text that may wrap badly. Match the existing design language and keep changes scoped.

After editing, run the relevant build or type check.`,
  },
  {
    name: "API Builder",
    description: "Implement or improve API routes with validation, errors, and tests",
    mode: "BUILD" as ModeType,
    fileName: "api-builder.md",
    prompt: `Implement the requested API work using the project's existing routing, validation, auth, and error-handling patterns.

Read nearby routes first. Add input validation, clear errors, typed responses, and tests or focused verification where the project supports them. Keep behavior backwards-compatible unless asked otherwise.`,
  },
  {
    name: "Performance Pass",
    description: "Find and fix slow code paths, redundant work, and large payloads",
    mode: "BUILD" as ModeType,
    fileName: "performance-pass.md",
    prompt: `Analyze this project for performance bottlenecks and fix the highest-impact safe items.

Look for repeated expensive work, large renders, N+1 queries, unbounded loops, unnecessary network calls, missing memoization, heavy bundle paths, and oversized payloads. Prefer measured or clearly reasoned changes and verify after editing.`,
  },
  {
    name: "Dependency Upgrade",
    description: "Upgrade dependencies carefully and fix resulting breakages",
    mode: "BUILD" as ModeType,
    fileName: "dependency-upgrade.md",
    prompt: `Upgrade the requested dependencies carefully.

Inspect package scripts and lockfiles first. Check release notes when needed. Make the minimal dependency changes, update code for breaking changes, and run the relevant install/build/test commands. Report anything that could not be verified.`,
  },
  {
    name: "Bug Repro",
    description: "Create a minimal reproduction before fixing a bug",
    mode: "BUILD" as ModeType,
    fileName: "bug-repro.md",
    prompt: `Debug this issue by first creating or identifying a minimal reproduction.

State the expected vs actual behavior, trace the relevant code path, reproduce with a test/script/manual command if possible, then fix the root cause. Re-run the reproduction after the fix.`,
  },
];

/**
 * Parse a skill markdown file with YAML frontmatter.
 */
export function parseSkillFile(content: string, filePath: string): Skill | null {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!fmMatch) {
    // No frontmatter — treat entire content as prompt, derive name from filename
    const name = filePath.split(/[/\\]/).pop()?.replace(/\.md$/i, "") ?? "unnamed";
    return {
      name,
      description: content.slice(0, 80).trim(),
      prompt: content.trim(),
      filePath,
    };
  }

  const frontmatter = fmMatch[1]!;
  const body = fmMatch[2]!;

  // Simple YAML parsing (no dependency needed)
  const fields: Record<string, string> = {};
  for (const line of frontmatter.split("\n")) {
    const match = line.match(/^(\w+):\s*(.+)$/);
    if (match) {
      fields[match[1]!] = match[2]!.trim();
    }
  }

  if (!fields.name) return null;

  return {
    name: fields.name,
    description: fields.description ?? "",
    mode: (fields.mode === "PLAN" || fields.mode === "BUILD") ? fields.mode as ModeType : undefined,
    prompt: body.trim(),
    filePath,
  };
}

/**
 * Load all skills from .agenticcoder/skills/ directory.
 */
export async function loadSkills(cwd: string = process.cwd()): Promise<Skill[]> {
  const skillsPath = join(cwd, SKILLS_DIR);
  const skills: Skill[] = [];

  try {
    const entries = await readdir(skillsPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile() || extname(entry.name).toLowerCase() !== ".md") continue;

      try {
        const filePath = join(skillsPath, entry.name);
        const content = await readFile(filePath, "utf8");
        const skill = parseSkillFile(content, filePath);
        if (skill) skills.push(skill);
      } catch (err) {
        console.error(`[skill] Failed to load "${entry.name}":`, err instanceof Error ? err.message : String(err));
      }
    }
  } catch {
    // skills directory doesn't exist — that's fine
  }

  // Sort alphabetically
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Find a skill by name (case-insensitive).
 */
export function findSkill(skills: Skill[], name: string): Skill | undefined {
  return skills.find((s) => s.name.toLowerCase() === name.toLowerCase());
}

/**
 * Check if skills directory exists.
 */
export function hasSkillsDir(cwd: string = process.cwd()): boolean {
  try {
    const fs = require("fs");
    return fs.existsSync(join(cwd, SKILLS_DIR));
  } catch {
    return false;
  }
}

export async function installCatalogSkill(entry: SkillCatalogEntry, cwd: string = process.cwd()): Promise<Skill> {
  const skillsPath = join(cwd, SKILLS_DIR);
  const filePath = join(skillsPath, entry.fileName);
  const content = `---
name: ${entry.name}
description: ${entry.description}
${entry.mode ? `mode: ${entry.mode}\n` : ""}---
${entry.prompt.trim()}
`;

  await mkdir(skillsPath, { recursive: true });
  await writeFile(filePath, content, "utf8");

  return {
    name: entry.name,
    description: entry.description,
    mode: entry.mode,
    prompt: entry.prompt.trim(),
    filePath,
  };
}

/**
 * Get the built-in default skills (always available).
 */
export function getBuiltinSkills(): Skill[] {
  return [
    {
      name: "Code Review",
      description: "Review code for bugs, security, and best practices",
      mode: "PLAN" as ModeType,
      prompt: `Review the code in this project for:
1. **Bugs** — logic errors, off-by-one errors, null/undefined checks, race conditions
2. **Security** — injection vulnerabilities, auth bypasses, data exposure, SSRF
3. **Performance** — N+1 queries, memory leaks, unnecessary iterations, large allocations
4. **Style** — naming consistency, dead code, unclear logic, missing error handling

For each issue found:
- Show the exact file and line
- Explain the impact
- Provide a concrete fix

Start by understanding the project structure, then focus on the most critical files.`,
      filePath: "__builtin__",
    },
    {
      name: "Add Tests",
      description: "Generate tests for the current codebase",
      mode: "BUILD" as ModeType,
      prompt: `Analyze the project and add comprehensive tests:
1. First understand the project structure and testing framework used
2. Identify the most critical untested functions/modules
3. Write tests covering: happy path, edge cases, error handling
4. Use the project's existing test patterns and framework
5. Run the tests to verify they pass

Prioritize business logic and utility functions over UI components.`,
      filePath: "__builtin__",
    },
    {
      name: "Refactor",
      description: "Identify and apply refactoring improvements",
      mode: "BUILD" as ModeType,
      prompt: `Analyze the codebase and suggest refactoring improvements:
1. Identify code duplication and extract shared utilities
2. Find functions that are too long and split them
3. Improve naming for unclear variables/functions
4. Simplify complex conditionals
5. Remove dead code

Make changes incrementally and verify each change builds correctly.`,
      filePath: "__builtin__",
    },
    {
      name: "Debug",
      description: "Systematic debugging of an issue",
      mode: "BUILD" as ModeType,
      prompt: `Help me debug an issue. Follow this systematic approach:
1. **Reproduce** — Understand what's expected vs actual behavior
2. **Locate** — Use grep, readFile, and listCodeDefinitions to find relevant code
3. **Analyze** — Use thinkOut to reason through the code path
4. **Hypothesize** — Form theories about the root cause
5. **Fix** — Apply the fix and verify it works
6. **Verify** — Run tests or demonstrate the fix

Ask me to describe the issue if I haven't already.`,
      filePath: "__builtin__",
    },
    {
      name: "Document",
      description: "Generate or improve documentation",
      mode: "BUILD" as ModeType,
      prompt: `Improve the project documentation:
1. Read the codebase structure and key files
2. Generate/update README.md with: project overview, setup instructions, usage guide
3. Add JSDoc comments to exported functions that lack them
4. Document any undocumented configuration options
5. Add inline comments for complex logic

Keep documentation concise and developer-focused.`,
      filePath: "__builtin__",
    },
  ];
}
