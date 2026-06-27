import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type PluginCatalogEntry = {
  name: string;
  description: string;
  env?: Record<string, string>;
  inputSchema: Record<string, unknown>;
  handler: string;
  handlerContent: string;
};

const webSearchHandler = `type Input = {
  query?: string;
  count?: number;
  provider?: "auto" | "brave" | "duckduckgo";
};

const input = JSON.parse(process.env.PLUGIN_INPUT || "{}") as Input;
const query = String(input.query || "").trim();
const count = Math.max(1, Math.min(10, Number(input.count || 5)));

if (!query) throw new Error("query is required");

async function braveSearch() {
  const apiKey = process.env.BRAVE_API_KEY || process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) throw new Error("BRAVE_API_KEY is not set");

  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(count));
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
      "User-Agent": "AgenticCoder/1.0",
    },
  });
  if (!response.ok) throw new Error(\`Brave Search failed: \${response.status} \${response.statusText}\`);
  const data = await response.json() as any;
  return (data.web?.results || []).slice(0, count).map((item: any, index: number) =>
    \`\${index + 1}. \${item.title}\\n   URL: \${item.url}\\n   \${item.description || ""}\`
  );
}

async function duckDuckGoFallback() {
  const url = new URL("https://api.duckduckgo.com/");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("no_html", "1");
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: { "User-Agent": "AgenticCoder/1.0" },
  });
  if (!response.ok) throw new Error(\`DuckDuckGo failed: \${response.status} \${response.statusText}\`);
  const data = await response.json() as any;
  const results: string[] = [];
  if (data.AbstractURL) results.push(\`1. \${data.Heading || query}\\n   URL: \${data.AbstractURL}\\n   \${data.AbstractText || ""}\`);
  for (const item of data.RelatedTopics || []) {
    if (results.length >= count) break;
    if (item.FirstURL && item.Text) results.push(\`\${results.length + 1}. \${item.Text}\\n   URL: \${item.FirstURL}\`);
  }
  return results;
}

const useBrave = input.provider === "brave" || (input.provider !== "duckduckgo" && (process.env.BRAVE_API_KEY || process.env.BRAVE_SEARCH_API_KEY));
const results = useBrave ? await braveSearch() : await duckDuckGoFallback();
console.log(["Web search: " + query, useBrave ? "Provider: Brave" : "Provider: DuckDuckGo fallback", "", ...(results.length ? results : ["No results returned."])].join("\\n"));
`;

const npmPackageHandler = `type Input = { packageName?: string; version?: string; includeVersions?: boolean };
const input = JSON.parse(process.env.PLUGIN_INPUT || "{}") as Input;
const packageName = String(input.packageName || "").trim();
const requestedVersion = String(input.version || "latest").trim();
if (!packageName) throw new Error("packageName is required");
const encodedName = packageName.startsWith("@") ? "@" + encodeURIComponent(packageName.slice(1)).replace("%2F", "/") : encodeURIComponent(packageName);
const response = await fetch(\`https://registry.npmjs.org/\${encodedName}\`, {
  signal: AbortSignal.timeout(15_000),
  headers: { "User-Agent": "AgenticCoder/1.0" },
});
if (!response.ok) throw new Error(\`npm registry request failed: \${response.status} \${response.statusText}\`);
const metadata = await response.json() as any;
const distTags = metadata["dist-tags"] || {};
const resolvedVersion = distTags[requestedVersion] || requestedVersion;
const versionInfo = metadata.versions?.[resolvedVersion];
if (!versionInfo) throw new Error(\`Version or dist-tag not found: \${requestedVersion}\`);
const deps = Object.entries(versionInfo.dependencies || {}).slice(0, 12).map(([name, range]) => \`- \${name}: \${range}\`);
const lines = [
  \`npm package: \${metadata.name}\`,
  \`Description: \${metadata.description || versionInfo.description || "No description"}\`,
  \`Resolved version: \${versionInfo.version}\`,
  \`Latest: \${distTags.latest || "unknown"}\`,
  \`License: \${versionInfo.license || metadata.license || "unknown"}\`,
  \`Repository: \${typeof versionInfo.repository === "string" ? versionInfo.repository : versionInfo.repository?.url || "none"}\`,
  "",
  "Dependencies:",
  ...(deps.length ? deps : ["- none"]),
];
if (input.includeVersions) lines.push("", "Recent versions:", ...Object.keys(metadata.versions || {}).slice(-12).reverse().map((v) => \`- \${v}\`));
console.log(lines.join("\\n"));
`;

const githubRepoHandler = `type Input = { repo?: string; mode?: "summary" | "releases" | "issues"; count?: number };
const input = JSON.parse(process.env.PLUGIN_INPUT || "{}") as Input;
const repo = String(input.repo || "").trim();
const mode = input.mode || "summary";
const count = Math.max(1, Math.min(20, Number(input.count || 5)));
if (!/^[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error("repo must be in owner/name format");
async function githubGet(path: string) {
  const token = process.env.GITHUB_TOKEN || process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  const response = await fetch(\`https://api.github.com\${path}\`, {
    signal: AbortSignal.timeout(15_000),
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "AgenticCoder/1.0",
      ...(token ? { Authorization: \`Bearer \${token}\` } : {}),
    },
  });
  if (!response.ok) throw new Error(\`GitHub API request failed: \${response.status} \${response.statusText}\`);
  return response.json();
}
if (mode === "releases") {
  const releases = await githubGet(\`/repos/\${repo}/releases?per_page=\${count}\`) as any[];
  console.log(["GitHub releases: " + repo, ...releases.map((r) => \`\\n- \${r.name || r.tag_name}\\n  Tag: \${r.tag_name}\\n  URL: \${r.html_url}\`)].join("\\n"));
} else if (mode === "issues") {
  const issues = await githubGet(\`/repos/\${repo}/issues?state=open&per_page=\${count}\`) as any[];
  console.log(["GitHub open issues: " + repo, ...issues.filter((i) => !i.pull_request).slice(0, count).map((i) => \`\\n- #\${i.number} \${i.title}\\n  URL: \${i.html_url}\`)].join("\\n"));
} else {
  const data = await githubGet(\`/repos/\${repo}\`) as any;
  console.log([\`GitHub repository: \${repo}\`, \`Description: \${data.description || "No description"}\`, \`Default branch: \${data.default_branch}\`, \`Language: \${data.language || "unknown"}\`, \`Stars: \${data.stargazers_count}\`, \`Open issues: \${data.open_issues_count}\`, \`URL: \${data.html_url}\`].join("\\n"));
}
`;

const httpRequestHandler = `type Input = { url?: string; method?: string; headers?: Record<string, string>; body?: string; maxBytes?: number };
const input = JSON.parse(process.env.PLUGIN_INPUT || "{}") as Input;
const rawUrl = String(input.url || "").trim();
const url = new URL(rawUrl);
if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only http and https URLs are allowed");
const hostname = url.hostname.toLowerCase();
if (["localhost", "127.0.0.1", "0.0.0.0", "::1", "metadata.google.internal", "169.254.169.254"].includes(hostname) || /^10\\./.test(hostname) || /^172\\.(1[6-9]|2\\d|3[01])\\./.test(hostname) || /^192\\.168\\./.test(hostname)) {
  throw new Error("Private and local network URLs are blocked");
}
const method = input.method || "GET";
const response = await fetch(url, {
  method,
  signal: AbortSignal.timeout(20_000),
  headers: { "User-Agent": "AgenticCoder/1.0", ...(input.headers || {}) },
  body: ["POST", "PUT", "PATCH"].includes(method) ? input.body : undefined,
});
const text = method === "HEAD" ? "" : await response.text();
const limit = Math.max(1000, Math.min(100000, Number(input.maxBytes || 20000)));
console.log([\`\${method} \${url.toString()}\`, \`Status: \${response.status} \${response.statusText}\`, \`Content-Type: \${response.headers.get("content-type") || "unknown"}\`, "", "Body:", text.length > limit ? text.slice(0, limit) + \`\\n... (truncated, \${text.length} total chars)\` : text].join("\\n"));
`;

export const PLUGIN_CATALOG: PluginCatalogEntry[] = [
  {
    name: "web_search",
    description: "Search the web. Uses Brave with BRAVE_API_KEY, otherwise DuckDuckGo fallback.",
    env: { BRAVE_API_KEY: "Optional Brave Search API key for full web search results" },
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
        count: { type: "number", default: 5 },
        provider: { type: "string", enum: ["auto", "brave", "duckduckgo"], default: "auto" },
      },
      required: ["query"],
    },
    handler: "handler.ts",
    handlerContent: webSearchHandler,
  },
  {
    name: "npm_package",
    description: "Look up npm package metadata, latest versions, dependencies, and repo info.",
    inputSchema: {
      type: "object",
      properties: {
        packageName: { type: "string" },
        version: { type: "string", default: "latest" },
        includeVersions: { type: "boolean", default: false },
      },
      required: ["packageName"],
    },
    handler: "handler.ts",
    handlerContent: npmPackageHandler,
  },
  {
    name: "github_repo",
    description: "Inspect GitHub repositories, releases, and issues. Uses GITHUB_TOKEN when available.",
    env: { GITHUB_TOKEN: "Optional GitHub token for higher API limits" },
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "owner/name" },
        mode: { type: "string", enum: ["summary", "releases", "issues"], default: "summary" },
        count: { type: "number", default: 5 },
      },
      required: ["repo"],
    },
    handler: "handler.ts",
    handlerContent: githubRepoHandler,
  },
  {
    name: "http_request",
    description: "Call public HTTP APIs. Blocks localhost and private network targets.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"], default: "GET" },
        headers: { type: "object", additionalProperties: { type: "string" } },
        body: { type: "string" },
        maxBytes: { type: "number", default: 20000 },
      },
      required: ["url"],
    },
    handler: "handler.ts",
    handlerContent: httpRequestHandler,
  },
];

export function installCatalogPlugin(entry: PluginCatalogEntry, cwd = process.cwd()) {
  const pluginDir = join(cwd, ".agenticcoder", "plugins", entry.name);
  if (existsSync(join(pluginDir, "plugin.json"))) {
    return { success: false, message: `Plugin "${entry.name}" is already installed.` };
  }

  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(join(pluginDir, "plugin.json"), JSON.stringify({
    name: entry.name,
    description: entry.description,
    ...(entry.env ? { env: entry.env } : {}),
    inputSchema: entry.inputSchema,
    handler: entry.handler,
  }, null, 2), "utf8");
  writeFileSync(join(pluginDir, entry.handler), entry.handlerContent, "utf8");
  return { success: true, message: `Installed plugin "${entry.name}".` };
}
