import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ENV_PATH = ".env";

function envPath(cwd = process.cwd()) {
  return join(cwd, ENV_PATH);
}

export function readProjectEnv(cwd = process.cwd()): Record<string, string> {
  const path = envPath(cwd);
  if (!existsSync(path)) return {};

  const env: Record<string, string> = {};
  const content = readFileSync(path, "utf8");

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    let value = rawValue ?? "";
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key!] = value;
  }

  return env;
}

export function getEnvValue(name: string, cwd = process.cwd()): string | undefined {
  return process.env[name] || readProjectEnv(cwd)[name];
}

export function missingEnvVars(names: string[], cwd = process.cwd()): string[] {
  return names.filter((name) => !getEnvValue(name, cwd));
}

export function setProjectEnvValue(name: string, value: string, cwd = process.cwd()) {
  const path = envPath(cwd);
  const nextLine = `${name}=${JSON.stringify(value)}`;
  const lines = existsSync(path)
    ? readFileSync(path, "utf8").split(/\r?\n/)
    : [];

  let replaced = false;
  const nextLines = lines.map((line) => {
    if (line.match(new RegExp(`^\\s*${name}\\s*=`))) {
      replaced = true;
      return nextLine;
    }
    return line;
  });

  if (!replaced) {
    if (nextLines.length > 0 && nextLines[nextLines.length - 1] !== "") {
      nextLines.push("");
    }
    nextLines.push(nextLine);
  }

  writeFileSync(path, nextLines.join("\n").replace(/\n{3,}/g, "\n\n"), "utf8");
  process.env[name] = value;
}
