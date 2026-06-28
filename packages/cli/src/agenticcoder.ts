#!/usr/bin/env bun

import { existsSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const userCwd = process.cwd();
const cliDir = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(cliDir, "../../..");
const apiUrl = (process.env.API_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const serverDist = resolve(appRoot, "packages/server/dist/index.js");
const serverSrc = resolve(appRoot, "packages/server/src/index.ts");
const cliEntry = resolve(appRoot, "packages/cli/src/index.tsx");
const args = process.argv.slice(2);

let serverProcess: Bun.Subprocess | null = null;

async function printVersion() {
  const pkg = await Bun.file(resolve(appRoot, "package.json")).json().catch(() => ({ version: "unknown" }));
  console.log(`AgenticCoder ${pkg.version}`);
}

function printHelp() {
  console.log(`AgenticCoder terminal agent

Usage:
  agenticcoder          Start the server if needed, then open the TUI
  agenticcoder --help   Show this help
  agenticcoder -v       Show version

Environment:
  API_URL               Backend URL, defaults to http://localhost:3000
`);
}

async function isServerReady(): Promise<boolean> {
  try {
    const response = await fetch(`${apiUrl}/auth/callback`, { signal: AbortSignal.timeout(800) });
    return response.status >= 200 && response.status < 500;
  } catch {
    return false;
  }
}

async function waitForServer(timeoutMs = 15000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isServerReady()) return;
    await Bun.sleep(250);
  }

  throw new Error(`AgenticCoder server did not become ready at ${apiUrl}`);
}

async function ensureServer(): Promise<void> {
  if (await isServerReady()) return;

  const serverEntry = existsSync(serverDist) ? serverDist : serverSrc;
  serverProcess = Bun.spawn(["bun", "run", serverEntry], {
    cwd: appRoot,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      API_URL: apiUrl,
      AGENTICCODER_HOME: appRoot,
    },
  });

  await waitForServer();
}

function cleanup() {
  if (serverProcess) {
    try {
      serverProcess.kill();
    } catch {
      // Server may already be stopped.
    }
    serverProcess = null;
  }
}

process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(143);
});

try {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  if (args.includes("--version") || args.includes("-v")) {
    await printVersion();
    process.exit(0);
  }

  await ensureServer();

  const cliProcess = Bun.spawn(["bun", "run", cliEntry], {
    cwd: userCwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      API_URL: apiUrl,
      AGENTICCODER_HOME: appRoot,
    },
  });

  const exitCode = await cliProcess.exited;
  cleanup();
  process.exit(exitCode);
} catch (error) {
  cleanup();
  const message = error instanceof Error ? error.message : String(error);
  console.error(`AgenticCoder failed to start: ${message}`);
  process.exit(1);
}
