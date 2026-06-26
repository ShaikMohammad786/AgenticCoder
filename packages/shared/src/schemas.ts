import { z } from "zod";
import { tool } from "ai";

export const Mode = {
  BUILD: "BUILD",
  PLAN: "PLAN",
} as const;

export const modeSchema = z.enum([Mode.BUILD, Mode.PLAN]);

export type ModeType = (typeof Mode)[keyof typeof Mode];

export const toolInputSchemas = {
  readFile: z.object({
    path: z.string().describe("Relative path to the file to read"),
  }),
  listDirectory: z.object({
    path: z.string().default(".").describe("Relative directory path to list"),
  }),
  glob: z.object({
    pattern: z.string().describe("Glob pattern to match files"),
    path: z.string().default(".").describe("Directory to search from"),
  }),
  grep: z.object({
    pattern: z.string().describe("Regex pattern to search for"),
    path: z.string().default(".").describe("Directory to search from"),
    include: z.string().optional().describe("Optional glob for files to include"),
  }),
  writeFile: z.object({
    path: z.string().describe("Relative path to write"),
    content: z.string().describe("File contents"),
  }),
  editFile: z.object({
    path: z.string().describe("Relative path to edit"),
    oldString: z.string().describe("Exact text to replace; must be unique"),
    newString: z.string().describe("Replacement text"),
  }),
  bash: z.object({
    command: z.string().describe("Shell command to run"),
    description: z.string().optional().describe("Short description of the command"),
    timeout: z.number().optional().describe("Timeout in milliseconds"),
  }),
  listCodeDefinitions: z.object({
    path: z.string().describe("Relative path to the source file to analyze"),
  }),
  gitStatus: z.object({}),
  gitDiff: z.object({
    ref: z.string().optional().describe("Git ref to diff against (default: working tree changes)"),
    path: z.string().optional().describe("Limit diff to a specific file path"),
  }),
  gitLog: z.object({
    count: z.number().default(10).describe("Number of commits to show"),
    path: z.string().optional().describe("Limit history to a specific file"),
  }),
  fetchUrl: z.object({
    url: z.string().url().describe("URL to fetch"),
  }),
  searchReplace: z.object({
    path: z.string().describe("Relative path to the file"),
    search: z.string().describe("Text or regex pattern to search for"),
    replace: z.string().describe("Replacement text"),
    isRegex: z.boolean().default(false).describe("Treat search as regex pattern"),
  }),
  thinkOut: z.object({
    thought: z.string().describe("Your internal reasoning or analysis"),
  }),
  fileInfo: z.object({
    path: z.string().describe("Relative path to the file"),
  }),
  gitBlame: z.object({
    path: z.string().describe("Relative path to the file"),
    startLine: z.number().optional().describe("Start line number"),
    endLine: z.number().optional().describe("End line number"),
  }),
  spawnAgent: z.object({
    agents: z.array(z.object({
      type: z.enum(["researcher", "coder", "reviewer", "planner", "debugger"]).describe("Agent specialization"),
      task: z.string().describe("Clear, specific task description for the subagent. Be precise about what to do and what to return."),
      context: z.string().optional().describe("Key context from parent conversation the subagent needs (file paths, decisions made, constraints)"),
      files: z.array(z.string()).optional().describe("Key files the subagent should focus on"),
    })).min(1).max(5).describe("Agents to spawn — executed in parallel"),
    maxConcurrent: z.number().min(1).max(5).default(3).optional().describe("Max agents running at once (default: 3)"),
  }),
} as const;

export const AgentType = {
  RESEARCHER: "researcher",
  CODER: "coder",
  REVIEWER: "reviewer",
  PLANNER: "planner",
  DEBUGGER: "debugger",
} as const;

export type AgentTypeValue = (typeof AgentType)[keyof typeof AgentType];
export const agentTypeSchema = z.enum(["researcher", "coder", "reviewer", "planner", "debugger"]);

export const readOnlyToolContracts = {
  readFile: tool({
    description: "Read a file from the current project directory.",
    inputSchema: toolInputSchemas.readFile,
  }),
  listDirectory: tool({
    description: "List entries in a directory under the current project directory.",
    inputSchema: toolInputSchemas.listDirectory,
  }),
  glob: tool({
    description: "Find files matching a glob pattern under the current project directory.",
    inputSchema: toolInputSchemas.glob,
  }),
  grep: tool({
    description: "Search file contents with a regular expression under the current project directory.",
    inputSchema: toolInputSchemas.grep,
  }),
  listCodeDefinitions: tool({
    description: "Parse a source file and list all top-level symbols (functions, classes, types, interfaces, exports).",
    inputSchema: toolInputSchemas.listCodeDefinitions,
  }),
  gitStatus: tool({
    description: "Show the current git working tree status including staged, unstaged, and untracked files.",
    inputSchema: toolInputSchemas.gitStatus,
  }),
  gitDiff: tool({
    description: "Show git diff output for working tree changes or between refs.",
    inputSchema: toolInputSchemas.gitDiff,
  }),
  gitLog: tool({
    description: "Show recent git commit history with hashes, authors, and messages.",
    inputSchema: toolInputSchemas.gitLog,
  }),
  fetchUrl: tool({
    description: "Fetch content from a URL and return it as text. Useful for reading documentation or APIs.",
    inputSchema: toolInputSchemas.fetchUrl,
  }),
  thinkOut: tool({
    description: "Use this tool to think through complex problems step by step. Your reasoning will be recorded but no action is taken.",
    inputSchema: toolInputSchemas.thinkOut,
  }),
  fileInfo: tool({
    description: "Get file metadata including size, modification time, and type. Useful for understanding file properties without reading contents.",
    inputSchema: toolInputSchemas.fileInfo,
  }),
  gitBlame: tool({
    description: "Show git blame for a file — who last modified each line, when, and in which commit.",
    inputSchema: toolInputSchemas.gitBlame,
  }),
} as const;

export const buildToolContracts = {
  ...readOnlyToolContracts,
  writeFile: tool({
    description: "Create or overwrite a file under the current project directory.",
    inputSchema: toolInputSchemas.writeFile,
  }),
  editFile: tool({
    description: "Replace exact text in a file under the current project directory.",
    inputSchema: toolInputSchemas.editFile,
  }),
  bash: tool({
    description: "Run a shell command in the current project directory.",
    inputSchema: toolInputSchemas.bash,
  }),
  searchReplace: tool({
    description: "Search and replace text in a file, with optional regex support. Supports multiple occurrences.",
    inputSchema: toolInputSchemas.searchReplace,
  }),
  spawnAgent: tool({
    description: `Spawn specialized subagents to handle complex, multi-step tasks in parallel. Each agent runs in its own isolated context with focused tools.

Agent types:
- researcher: Read-only codebase exploration. Use for gathering context, finding patterns, understanding architecture.
- coder: Full write access. Use for implementing features, refactoring code, fixing bugs.
- reviewer: Read-only code analysis. Use for code review, finding bugs, security audit.
- planner: Read-only with reasoning. Use for breaking down complex tasks, creating implementation plans.
- debugger: Full access with focus on diagnostics. Use for reproducing bugs, tracing root causes, applying fixes.

IMPORTANT: Only use this tool when the task genuinely benefits from parallelization or specialization. Do NOT spawn agents for:
- Simple single-file edits
- Quick questions or lookups
- Tasks you can handle in 1-3 tool calls

DO spawn agents when:
- Task involves 3+ files across different components
- Task has naturally parallelizable sub-tasks (e.g., research + implement)
- Task requires both deep analysis AND code changes
- Task is a large refactor, migration, or multi-file feature`,
    inputSchema: toolInputSchemas.spawnAgent,
  }),
} as const;

export type ToolContracts = typeof buildToolContracts;

export function getToolContracts(mode: ModeType) {
  return mode === Mode.PLAN 
    ? readOnlyToolContracts 
    : buildToolContracts;
};