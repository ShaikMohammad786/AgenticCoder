type Input = {
  url?: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
  headers?: Record<string, string>;
  body?: string;
  maxBytes?: number;
};

const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "metadata.google.internal",
  "169.254.169.254",
]);

function readInput(): Input {
  try {
    return JSON.parse(process.env.PLUGIN_INPUT || "{}") as Input;
  } catch {
    return {};
  }
}

function assertPublicUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only http and https URLs are allowed");
  }

  const hostname = url.hostname.toLowerCase();
  if (
    BLOCKED_HOSTS.has(hostname) ||
    /^10\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^169\.254\./.test(hostname)
  ) {
    throw new Error("Private and local network URLs are blocked");
  }

  return url;
}

function maxBytes(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 20_000;
  return Math.max(1_000, Math.min(100_000, Math.floor(parsed)));
}

const input = readInput();
const url = assertPublicUrl(String(input.url || "").trim());
const method = input.method || "GET";
const headers = input.headers || {};

const response = await fetch(url, {
  method,
  signal: AbortSignal.timeout(20_000),
  headers: {
    "User-Agent": "AgenticCoder/1.0",
    ...headers,
  },
  body: ["POST", "PUT", "PATCH"].includes(method) ? input.body : undefined,
});

const contentType = response.headers.get("content-type") || "unknown";
const rawText = method === "HEAD" ? "" : await response.text();
const limit = maxBytes(input.maxBytes);
const body = rawText.length > limit
  ? `${rawText.slice(0, limit)}\n... (truncated, ${rawText.length} total chars)`
  : rawText;

const interestingHeaders = [
  "content-type",
  "cache-control",
  "etag",
  "last-modified",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
];

const lines = [
  `${method} ${url.toString()}`,
  `Status: ${response.status} ${response.statusText}`,
  `Content-Type: ${contentType}`,
  "",
  "Headers:",
];

for (const name of interestingHeaders) {
  const value = response.headers.get(name);
  if (value) lines.push(`- ${name}: ${value}`);
}

lines.push("", "Body:", body || "(empty)");
console.log(lines.join("\n"));
