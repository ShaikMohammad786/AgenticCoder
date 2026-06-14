import { mkdir, readFile, readdir, stat, writeFile } from "fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve } from "path";
import { toolInputSchemas, Mode, type ModeType } from "@agenticcoder/shared";
import { createCheckpoint, cleanupCheckpoints } from "./checkpoint";
import { isMcpTool, executeMcpTool } from "./mcp-client";

const MAX_FILE_SIZE = 10_000;
const MAX_RESULTS = 200;
const MAX_MATCHES = 50;
const MAX_OUTPUT = 20_000;
const DEFAULT_TIMEOUT = 30_000;
const IS_WINDOWS = process.platform === "win32";

const PLAN_TOOLS = [
  "readFile", "listDirectory", "glob", "grep",
  "listCodeDefinitions", "gitStatus", "gitDiff", "gitLog",
  "fetchUrl", "thinkOut", "fileInfo", "gitBlame",
];

// Block internal/private IP ranges for fetchUrl
const BLOCKED_HOSTS = [
  "localhost", "127.0.0.1", "0.0.0.0", "::1",
  "metadata.google.internal", "169.254.169.254",
];

function isBlockedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (BLOCKED_HOSTS.includes(hostname)) return true;
    // Block private IP ranges
    if (/^10\./.test(hostname)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
    if (/^192\.168\./.test(hostname)) return true;
    if (/^169\.254\./.test(hostname)) return true;
    return false;
  } catch {
    return true;
  }
}

function resolveInsideCwd(path: string) {
  const cwd = process.cwd();
  const resolved = resolve(cwd, path);
  const rel = relative(cwd, resolved);

  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Path is outside the project directory");
  }

  return { cwd, resolved };
}

function truncate(value: string, limit: number) {
  return value.length > limit
    ? `${value.slice(0, limit)}\n... (truncated, ${value.length} total chars)`
    : value;
}

function getShellCommand(command: string): string[] {
  if (IS_WINDOWS) {
    return ["powershell", "-NoProfile", "-Command", command];
  }
  return ["bash", "-c", command];
}

async function runGitCommand(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const cwd = process.cwd();
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

// ── Pure JS grep fallback (works on all platforms) ──

async function jsGrep(
  pattern: string,
  searchPath: string,
  cwd: string,
  include?: string,
): Promise<{ matches: { file: string; line: number; content: string }[]; truncated: boolean; totalMatches: number }> {
  const regex = new RegExp(pattern);
  const matches: { file: string; line: number; content: string }[] = [];
  let totalMatches = 0;
  const includeGlob = include ? new Bun.Glob(include) : null;

  async function searchDir(dir: string) {
    if (matches.length >= MAX_MATCHES) return;
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (matches.length >= MAX_MATCHES) return;
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === ".git") continue;

      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        await searchDir(fullPath);
      } else if (entry.isFile()) {
        // Check include filter
        if (includeGlob && !includeGlob.match(entry.name)) continue;

        try {
          const content = await readFile(fullPath, "utf-8");
          const lines = content.split("\n");

          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i]!)) {
              totalMatches++;
              if (matches.length < MAX_MATCHES) {
                matches.push({
                  file: relative(cwd, fullPath),
                  line: i + 1,
                  content: lines[i]!.trim(),
                });
              }
            }
          }
        } catch {
          // Skip binary/unreadable files
        }
      }
    }
  }

  await searchDir(searchPath);
  return { matches, truncated: totalMatches > MAX_MATCHES, totalMatches };
}

// ── Symbol extraction patterns per language ──

type SymbolDef = { name: string; type: string; line: number; exported: boolean };

const TS_PATTERNS: Array<{ regex: RegExp; type: string }> = [
  { regex: /^(export\s+)?(default\s+)?(async\s+)?function\s+(\w+)/, type: "function" },
  { regex: /^(export\s+)?(default\s+)?(abstract\s+)?class\s+(\w+)/, type: "class" },
  { regex: /^(export\s+)?interface\s+(\w+)/, type: "interface" },
  { regex: /^(export\s+)?type\s+(\w+)\s*[=<]/, type: "type" },
  { regex: /^(export\s+)?enum\s+(\w+)/, type: "enum" },
  { regex: /^(export\s+)?(const|let|var)\s+(\w+)/, type: "variable" },
  { regex: /^export\s+default\s+/, type: "default-export" },
];

const PY_PATTERNS: Array<{ regex: RegExp; type: string }> = [
  { regex: /^(async\s+)?def\s+(\w+)/, type: "function" },
  { regex: /^class\s+(\w+)/, type: "class" },
  { regex: /^(\w+)\s*=/, type: "variable" },
];

const GO_PATTERNS: Array<{ regex: RegExp; type: string }> = [
  { regex: /^func\s+(\w+)/, type: "function" },
  { regex: /^type\s+(\w+)\s+struct/, type: "struct" },
  { regex: /^type\s+(\w+)\s+interface/, type: "interface" },
  { regex: /^type\s+(\w+)/, type: "type" },
  { regex: /^var\s+(\w+)/, type: "variable" },
  { regex: /^const\s+(\w+)/, type: "constant" },
];

const RS_PATTERNS: Array<{ regex: RegExp; type: string }> = [
  { regex: /^(pub\s+)?(async\s+)?fn\s+(\w+)/, type: "function" },
  { regex: /^(pub\s+)?struct\s+(\w+)/, type: "struct" },
  { regex: /^(pub\s+)?enum\s+(\w+)/, type: "enum" },
  { regex: /^(pub\s+)?trait\s+(\w+)/, type: "trait" },
  { regex: /^(pub\s+)?type\s+(\w+)/, type: "type" },
  { regex: /^(pub\s+)?const\s+(\w+)/, type: "constant" },
  { regex: /^(pub\s+)?static\s+(\w+)/, type: "static" },
  { regex: /^(pub\s+)?mod\s+(\w+)/, type: "module" },
  { regex: /^impl\s+(\w+)/, type: "impl" },
];

function getPatternsForExt(ext: string) {
  switch (ext) {
    case ".ts": case ".tsx": case ".js": case ".jsx": case ".mjs": case ".cjs":
      return TS_PATTERNS;
    case ".py":
      return PY_PATTERNS;
    case ".go":
      return GO_PATTERNS;
    case ".rs":
      return RS_PATTERNS;
    default:
      return TS_PATTERNS;
  }
}

function extractName(match: RegExpMatchArray, type: string): string {
  for (let i = match.length - 1; i >= 1; i--) {
    const g = match[i];
    if (g && /^\w+$/.test(g) && !["export", "default", "async", "abstract", "const", "let", "var", "pub"].includes(g)) {
      return g;
    }
  }
  return type === "default-export" ? "(default)" : "(anonymous)";
}

function parseDefinitions(content: string, ext: string): SymbolDef[] {
  const patterns = getPatternsForExt(ext);
  const lines = content.split("\n");
  const defs: SymbolDef[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trimStart();
    if (!line || line.startsWith("//") || line.startsWith("/*") || line.startsWith("*")) continue;

    for (const { regex, type } of patterns) {
      const match = line.match(regex);
      if (match) {
        const name = extractName(match, type);
        const exported = line.startsWith("export") || line.startsWith("pub ");
        defs.push({ name, type, line: i + 1, exported });
        break;
      }
    }
  }

  return defs;
}

// Track whether we've checkpointed this session
let sessionCheckpointed = false;

export type ToolCallbacks = {
  onBashOutput?: (chunk: string) => void;
};

async function ensureCheckpoint() {
  if (!sessionCheckpointed) {
    sessionCheckpointed = true;
    try {
      await createCheckpoint();
    } catch {
      // Non-fatal — continue even if checkpoint fails
    }
  }
}

export async function executeLocalTool(
  toolName: string,
  input: unknown,
  mode: ModeType,
  callbacks?: ToolCallbacks,
) {
  if (mode === Mode.PLAN && !PLAN_TOOLS.includes(toolName)) {
    throw new Error(`Tool ${toolName} is not available in PLAN mode`);
  }

  // Create checkpoint before any write operation
  const WRITE_TOOLS = ["writeFile", "editFile", "searchReplace", "bash"];
  if (WRITE_TOOLS.includes(toolName)) {
    await ensureCheckpoint();
  }

  switch (toolName) {
    case "readFile": {
      const { path } = toolInputSchemas.readFile.parse(input);
      const { resolved } = resolveInsideCwd(path);
      const content = await readFile(resolved, "utf-8");
      return content.length > MAX_FILE_SIZE
        ? { content: content.slice(0, MAX_FILE_SIZE), truncated: true, totalLength: content.length }
        : { content };
    }
    case "listDirectory": {
      const { path } = toolInputSchemas.listDirectory.parse(input);
      const { cwd, resolved } = resolveInsideCwd(path);
      const entries = await readdir(resolved);
      const results: { name: string; type: "file" | "directory" }[] = [];

      for (const entry of entries) {
        if (entry.startsWith(".") || entry === "node_modules") continue;
        const info = await stat(join(resolved, entry));
        results.push({ name: entry, type: info.isDirectory() ? "directory" : "file" });
      }

      results.sort((a, b) =>
        a.type !== b.type ? (a.type === "directory" ? -1 : 1) : a.name.localeCompare(b.name),
      );
      return { path: relative(cwd, resolved) || ".", entries: results };
    }
    case "glob": {
      const { pattern, path } = toolInputSchemas.glob.parse(input);
      const { cwd, resolved } = resolveInsideCwd(path);
      const glob = new Bun.Glob(pattern);
      const files: string[] = [];
      let truncated = false;

      for await (const match of glob.scan({ cwd: resolved, dot: false, onlyFiles: true })) {
        if (match.includes("node_modules")) continue;
        if (files.length >= MAX_RESULTS) {
          truncated = true;
          break;
        }
        files.push(relative(cwd, resolve(resolved, match)));
      }

      files.sort();
      return { files, ...(truncated ? { truncated: true } : {}) };
    }
    case "grep": {
      const { pattern, path, include } = toolInputSchemas.grep.parse(input);
      const { cwd, resolved } = resolveInsideCwd(path);

      // Use pure JS grep — works on all platforms (Windows + Unix)
      const result = await jsGrep(pattern, resolved, cwd, include);

      if (result.matches.length === 0) {
        return { matches: [], message: "No matches found" };
      }

      return {
        matches: result.matches,
        ...(result.truncated ? { truncated: true, totalMatches: result.totalMatches } : {}),
      };
    }
    case "writeFile": {
      const { path, content } = toolInputSchemas.writeFile.parse(input);
      const { cwd, resolved } = resolveInsideCwd(path);
      await mkdir(dirname(resolved), { recursive: true });
      await writeFile(resolved, content, "utf-8");
      return {
        success: true as const,
        path: relative(cwd, resolved),
        bytesWritten: Buffer.byteLength(content, "utf-8"),
      };
    }
    case "editFile": {
      const { path, oldString, newString } = toolInputSchemas.editFile.parse(input);
      const { cwd, resolved } = resolveInsideCwd(path);
      const content = await readFile(resolved, "utf-8");
      const occurrences = content.split(oldString).length - 1;

      if (occurrences === 0) throw new Error("oldString not found in file");
      if (occurrences > 1) throw new Error(`oldString is ambiguous; found ${occurrences} matches`);

      await writeFile(resolved, content.replace(oldString, newString), "utf-8");
      return { success: true as const, path: relative(cwd, resolved) };
    }
    case "bash": {
      const { command, timeout = DEFAULT_TIMEOUT } = toolInputSchemas.bash.parse(input);
      const shellArgs = getShellCommand(command);
      const proc = Bun.spawn(shellArgs, {
        cwd: resolveInsideCwd(".").resolved,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, TERM: "dumb" },
      });
      const timer = setTimeout(() => proc.kill(), timeout);

      // Stream stdout chunks via callback if provided
      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];

      if (callbacks?.onBashOutput && proc.stdout) {
        const reader = proc.stdout.getReader();
        const decoder = new TextDecoder();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value);
            stdoutChunks.push(text);
            callbacks.onBashOutput(text);
          }
        } catch {
          // Stream ended
        }
      } else {
        stdoutChunks.push(await new Response(proc.stdout).text());
      }

      stderrChunks.push(await new Response(proc.stderr).text());
      const exitCode = await proc.exited;
      clearTimeout(timer);

      const stdout = stdoutChunks.join("");
      const stderr = stderrChunks.join("");
      return {
        stdout: truncate(stdout, MAX_OUTPUT),
        stderr: truncate(stderr, MAX_OUTPUT),
        exitCode,
      };
    }

    // ── New tools ──

    case "listCodeDefinitions": {
      const { path } = toolInputSchemas.listCodeDefinitions.parse(input);
      const { cwd, resolved } = resolveInsideCwd(path);
      const content = await readFile(resolved, "utf-8");
      const ext = extname(resolved).toLowerCase();
      const definitions = parseDefinitions(content, ext);
      return { path: relative(cwd, resolved), definitions };
    }
    case "gitStatus": {
      toolInputSchemas.gitStatus.parse(input);
      const [statusResult, branchResult] = await Promise.all([
        runGitCommand(["status", "--porcelain=v1"]),
        runGitCommand(["branch", "--show-current"]),
      ]);

      if (statusResult.exitCode !== 0) throw new Error(`git status failed: ${statusResult.stderr.trim()}`);

      const branch = branchResult.stdout.trim() || "(detached)";
      const staged: { status: string; path: string }[] = [];
      const unstaged: { status: string; path: string }[] = [];
      const untracked: { status: string; path: string }[] = [];

      for (const line of statusResult.stdout.split("\n")) {
        if (!line) continue;
        const x = line[0]!;
        const y = line[1]!;
        const filePath = line.slice(3);

        if (x === "?" && y === "?") {
          untracked.push({ status: "new", path: filePath });
        } else {
          if (x !== " " && x !== "?") staged.push({ status: x, path: filePath });
          if (y !== " " && y !== "?") unstaged.push({ status: y, path: filePath });
        }
      }

      return { branch, staged, unstaged, untracked };
    }
    case "gitDiff": {
      const { ref, path } = toolInputSchemas.gitDiff.parse(input);
      const args = ["diff"];
      if (ref) args.push(ref);
      if (path) args.push("--", path);

      const statArgs = [...args, "--stat"];
      const [diffResult, statsResult] = await Promise.all([
        runGitCommand(args),
        runGitCommand(statArgs),
      ]);

      if (diffResult.exitCode !== 0) throw new Error(`git diff failed: ${diffResult.stderr.trim()}`);

      return {
        diff: truncate(diffResult.stdout, MAX_OUTPUT),
        stats: statsResult.stdout.trim(),
      };
    }
    case "gitLog": {
      const { count, path } = toolInputSchemas.gitLog.parse(input);
      const args = ["log", `--format=%h|||%s|||%an|||%ar`, `-n`, String(count)];
      if (path) args.push("--", path);

      const result = await runGitCommand(args);
      if (result.exitCode !== 0) throw new Error(`git log failed: ${result.stderr.trim()}`);

      const commits: { hash: string; message: string; author: string; relativeDate: string }[] = [];
      for (const line of result.stdout.trim().split("\n")) {
        if (!line) continue;
        const [hash, message, author, relativeDate] = line.split("|||");
        if (hash && message) {
          commits.push({
            hash: hash.trim(),
            message: message.trim(),
            author: (author || "").trim(),
            relativeDate: (relativeDate || "").trim(),
          });
        }
      }

      return { commits };
    }
    case "fetchUrl": {
      const { url } = toolInputSchemas.fetchUrl.parse(input);

      if (isBlockedUrl(url)) {
        throw new Error("Fetching internal/private URLs is not allowed");
      }

      const response = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
        headers: { "User-Agent": "AgenticCoder/1.0" },
      });

      if (!response.ok) {
        throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
      }

      const contentType = response.headers.get("content-type") || "text/plain";
      let text = await response.text();

      // Strip HTML tags if it's HTML
      if (contentType.includes("text/html")) {
        text = text
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s{2,}/g, " ")
          .trim();
      }

      const truncated = text.length > MAX_OUTPUT;
      return {
        url,
        contentType,
        content: truncate(text, MAX_OUTPUT),
        ...(truncated ? { truncated: true } : {}),
      };
    }
    case "searchReplace": {
      const { path, search, replace, isRegex } = toolInputSchemas.searchReplace.parse(input);
      const { cwd, resolved } = resolveInsideCwd(path);
      const content = await readFile(resolved, "utf-8");

      let newContent: string;
      let replacements: number;

      if (isRegex) {
        const regex = new RegExp(search, "g");
        replacements = (content.match(regex) || []).length;
        if (replacements === 0) throw new Error(`Pattern '${search}' not found in file`);
        newContent = content.replace(regex, replace);
      } else {
        replacements = content.split(search).length - 1;
        if (replacements === 0) throw new Error(`Text '${search}' not found in file`);
        newContent = content.split(search).join(replace);
      }

      await writeFile(resolved, newContent, "utf-8");
      return { success: true as const, path: relative(cwd, resolved), replacements };
    }
    case "thinkOut": {
      const { thought } = toolInputSchemas.thinkOut.parse(input);
      return { thought };
    }
    case "fileInfo": {
      const { path } = toolInputSchemas.fileInfo.parse(input);
      const { cwd, resolved } = resolveInsideCwd(path);
      const info = await stat(resolved);
      return {
        path: relative(cwd, resolved),
        size: info.size,
        sizeHuman: info.size >= 1024 * 1024 
          ? `${(info.size / (1024 * 1024)).toFixed(1)}MB`
          : info.size >= 1024
            ? `${(info.size / 1024).toFixed(1)}KB`
            : `${info.size}B`,
        type: info.isDirectory() ? "directory" : info.isFile() ? "file" : "other",
        modified: info.mtime.toISOString(),
        created: info.birthtime.toISOString(),
        permissions: info.mode.toString(8),
      };
    }
    case "gitBlame": {
      const { path, startLine, endLine } = toolInputSchemas.gitBlame.parse(input);
      const { cwd } = resolveInsideCwd(path);
      const args = ["blame", "--porcelain"];
      if (startLine && endLine) args.push(`-L${startLine},${endLine}`);
      else if (startLine) args.push(`-L${startLine},+20`);
      args.push(path);

      const result = await runGitCommand(args);
      if (result.exitCode !== 0) throw new Error(`git blame failed: ${result.stderr.trim()}`);

      // Parse porcelain output into structured data
      const lines = result.stdout.split("\n");
      const entries: { line: number; hash: string; author: string; date: string; content: string }[] = [];
      let currentHash = "";
      let currentLine = 0;
      let currentAuthor = "";
      let currentDate = "";

      for (const line of lines) {
        const hashMatch = line.match(/^([0-9a-f]{40})\s+(\d+)\s+(\d+)/);
        if (hashMatch) {
          currentHash = hashMatch[1]!.slice(0, 8);
          currentLine = Number(hashMatch[3]);
          continue;
        }
        if (line.startsWith("author ")) currentAuthor = line.slice(7);
        if (line.startsWith("author-time ")) {
          const ts = Number(line.slice(12));
          currentDate = new Date(ts * 1000).toISOString().split("T")[0]!;
        }
        if (line.startsWith("\t")) {
          entries.push({
            line: currentLine,
            hash: currentHash,
            author: currentAuthor,
            date: currentDate,
            content: line.slice(1),
          });
        }
      }

      return {
        path: relative(cwd, resolve(cwd, path)),
        entries: entries.slice(0, MAX_MATCHES),
        ...(entries.length > MAX_MATCHES ? { truncated: true, totalLines: entries.length } : {}),
      };
    }
    default:
      // Route MCP tools to the MCP client
      if (isMcpTool(toolName)) {
        return executeMcpTool(toolName, input as Record<string, unknown>);
      }
      throw new Error(`Unknown tool: ${toolName}`);
  }
};