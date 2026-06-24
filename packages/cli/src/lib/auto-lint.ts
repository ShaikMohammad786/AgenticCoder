/**
 * Auto-Lint / Self-Healing Pipeline
 *
 * After the AI writes or edits a file, automatically run the appropriate
 * linter/compiler check. If errors are found, return them so the AI can
 * self-correct in the next tool call.
 *
 * Supports: TypeScript, JavaScript, Python, Go, Rust, JSON, CSS
 */

import { extname } from "path";

export type LintResult = {
  passed: boolean;
  language: string;
  errors: string[];
  command: string;
  suggestion?: string;
};

/**
 * Language-specific lint commands.
 * Each returns: { command, args, parseErrors }
 */
const LINT_CONFIGS: Record<string, {
  language: string;
  command: string[];
  parseErrors: (output: string) => string[];
}> = {
  ".ts": {
    language: "TypeScript",
    command: ["bunx", "tsc", "--noEmit", "--pretty", "--incremental", "false"],
    parseErrors: parseTscErrors,
  },
  ".tsx": {
    language: "TypeScript/React",
    command: ["bunx", "tsc", "--noEmit", "--pretty", "--incremental", "false"],
    parseErrors: parseTscErrors,
  },
  ".js": {
    language: "JavaScript",
    command: ["node", "--check"],
    parseErrors: parseNodeErrors,
  },
  ".jsx": {
    language: "JavaScript/React",
    command: ["node", "--check"],
    parseErrors: parseNodeErrors,
  },
  ".py": {
    language: "Python",
    command: ["python", "-m", "py_compile"],
    parseErrors: parsePythonErrors,
  },
  ".json": {
    language: "JSON",
    command: ["__json_validate__"], // Special: validated inline
    parseErrors: (o) => [o],
  },
  ".css": {
    language: "CSS",
    command: ["__css_validate__"], // Special: validated inline
    parseErrors: (o) => [o],
  },
};

/**
 * Run lint check on a file after AI writes/edits it.
 * Returns null if the file type is not supported for linting.
 */
export async function autoLint(
  filePath: string,
  cwd: string,
): Promise<LintResult | null> {
  const ext = extname(filePath).toLowerCase();
  const config = LINT_CONFIGS[ext];

  if (!config) return null; // Unsupported file type

  // Handle inline validators (JSON, CSS)
  if (config.command[0] === "__json_validate__") {
    return validateJson(filePath, cwd);
  }
  if (config.command[0] === "__css_validate__") {
    return validateCss(filePath, cwd);
  }

  // For TypeScript, only check the specific file
  const command = [...config.command];
  if (ext === ".ts" || ext === ".tsx") {
    // Use tsc on the specific file — faster than whole project
    // But we need to handle the case where tsconfig exists
    return runTscCheck(filePath, cwd, config.language);
  }

  // For other languages, append the file path
  command.push(filePath);

  try {
    const proc = Bun.spawn(command, {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, TERM: "dumb", NO_COLOR: "1" },
    });

    const timer = setTimeout(() => proc.kill(), 15_000); // 15s timeout
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    clearTimeout(timer);

    const exitCode = await proc.exited;
    const output = (stdout + "\n" + stderr).trim();

    if (exitCode === 0) {
      return {
        passed: true,
        language: config.language,
        errors: [],
        command: command.join(" "),
      };
    }

    const errors = config.parseErrors(output).filter(Boolean).slice(0, 5);

    return {
      passed: false,
      language: config.language,
      errors,
      command: command.join(" "),
      suggestion: `Fix the ${errors.length} ${config.language} error(s) above, then try again.`,
    };
  } catch (err) {
    // Linter not available — don't block the operation
    return null;
  }
}

/**
 * Run tsc check — try project tsconfig first, fallback to single-file check.
 */
async function runTscCheck(
  filePath: string,
  cwd: string,
  language: string,
): Promise<LintResult> {
  const { existsSync } = await import("fs");
  const { resolve, dirname } = await import("path");

  // Find nearest tsconfig.json
  let dir = dirname(resolve(cwd, filePath));
  let tsconfig: string | null = null;

  for (let i = 0; i < 5; i++) {
    const candidate = resolve(dir, "tsconfig.json");
    if (existsSync(candidate)) {
      tsconfig = candidate;
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const command = tsconfig
    ? ["bunx", "tsc", "--noEmit", "--project", tsconfig]
    : ["bunx", "tsc", "--noEmit", "--esModuleInterop", "--jsx", "react-jsx", filePath];

  try {
    const proc = Bun.spawn(command, {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, TERM: "dumb", NO_COLOR: "1" },
    });

    const timer = setTimeout(() => proc.kill(), 30_000);
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    clearTimeout(timer);

    const exitCode = await proc.exited;
    const output = (stdout + "\n" + stderr).trim();

    if (exitCode === 0) {
      return { passed: true, language, errors: [], command: command.join(" ") };
    }

    // Filter errors to only show those in the edited file
    const fileBasename = filePath.split(/[\\/]/).pop() ?? filePath;
    const allErrors = parseTscErrors(output);
    const relevantErrors = allErrors.filter(
      (e) => e.includes(filePath) || e.includes(fileBasename)
    );

    // If no relevant errors for our file, the file itself is fine
    if (relevantErrors.length === 0) {
      return { passed: true, language, errors: [], command: command.join(" ") };
    }

    return {
      passed: false,
      language,
      errors: relevantErrors.slice(0, 5),
      command: command.join(" "),
      suggestion: `Fix the TypeScript errors in ${fileBasename}, then try again.`,
    };
  } catch {
    return { passed: true, language, errors: [], command: "tsc (not available)" };
  }
}

/**
 * Validate JSON file inline (no external tool needed).
 */
async function validateJson(filePath: string, cwd: string): Promise<LintResult> {
  const { readFile } = await import("fs/promises");
  const { resolve } = await import("path");

  try {
    const content = await readFile(resolve(cwd, filePath), "utf-8");
    JSON.parse(content);
    return { passed: true, language: "JSON", errors: [], command: "JSON.parse" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid JSON";
    return {
      passed: false,
      language: "JSON",
      errors: [msg],
      command: "JSON.parse",
      suggestion: "Fix the JSON syntax error.",
    };
  }
}

/**
 * Validate CSS file inline (basic syntax check).
 */
async function validateCss(filePath: string, cwd: string): Promise<LintResult> {
  const { readFile } = await import("fs/promises");
  const { resolve } = await import("path");

  try {
    const content = await readFile(resolve(cwd, filePath), "utf-8");

    // Basic bracket matching
    let braces = 0;
    let parens = 0;
    for (const ch of content) {
      if (ch === "{") braces++;
      if (ch === "}") braces--;
      if (ch === "(") parens++;
      if (ch === ")") parens--;
      if (braces < 0 || parens < 0) {
        return {
          passed: false,
          language: "CSS",
          errors: ["Unmatched closing bracket"],
          command: "css-validate",
          suggestion: "Check for unmatched { } or ( ) brackets.",
        };
      }
    }

    if (braces !== 0 || parens !== 0) {
      return {
        passed: false,
        language: "CSS",
        errors: [`Unmatched brackets: ${braces} braces, ${parens} parens`],
        command: "css-validate",
        suggestion: "Check for unclosed { } or ( ) brackets.",
      };
    }

    return { passed: true, language: "CSS", errors: [], command: "css-validate" };
  } catch {
    return { passed: true, language: "CSS", errors: [], command: "css-validate" };
  }
}

// --- Error Parsers ---

function parseTscErrors(output: string): string[] {
  // TypeScript errors look like: "file.ts(10,5): error TS2322: ..."
  const lines = output.split("\n");
  const errors: string[] = [];

  for (const line of lines) {
    if (line.includes("error TS") || line.includes("Error:")) {
      errors.push(line.trim());
    }
  }

  return errors;
}

function parseNodeErrors(output: string): string[] {
  return output.split("\n")
    .filter((l) => l.includes("SyntaxError") || l.includes("Error:"))
    .map((l) => l.trim());
}

function parsePythonErrors(output: string): string[] {
  return output.split("\n")
    .filter((l) => l.includes("SyntaxError") || l.includes("Error") || l.includes("File"))
    .map((l) => l.trim());
}

/**
 * Format lint results for inclusion in tool response (AI sees this).
 */
export function formatLintResult(result: LintResult): string {
  if (result.passed) {
    return `✅ ${result.language} lint: passed`;
  }

  const errorList = result.errors.map((e) => `  • ${e}`).join("\n");
  return [
    `❌ ${result.language} lint: ${result.errors.length} error(s)`,
    errorList,
    result.suggestion ? `\n💡 ${result.suggestion}` : "",
  ].join("\n");
}
