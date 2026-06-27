type SearchInput = {
  query?: string;
  count?: number;
  provider?: "auto" | "brave" | "duckduckgo";
  freshness?: "any" | "pd" | "pw" | "pm" | "py";
};

type SearchResult = {
  title: string;
  url: string;
  snippet?: string;
  source?: string;
};

function readInput(): SearchInput {
  try {
    return JSON.parse(process.env.PLUGIN_INPUT || "{}") as SearchInput;
  } catch {
    return {};
  }
}

function cleanText(value: unknown): string {
  return String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resultLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 5;
  return Math.max(1, Math.min(10, Math.floor(parsed)));
}

async function braveSearch(input: Required<SearchInput>): Promise<{ provider: string; results: SearchResult[]; note?: string }> {
  const apiKey = process.env.BRAVE_API_KEY || process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    throw new Error("BRAVE_API_KEY is not set");
  }

  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", input.query);
  url.searchParams.set("count", String(input.count));
  if (input.freshness !== "any") {
    url.searchParams.set("freshness", input.freshness);
  }

  const response = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
      "User-Agent": "AgenticCoder/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Brave Search failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as {
    web?: {
      results?: Array<{
        title?: string;
        url?: string;
        description?: string;
        profile?: { name?: string };
      }>;
    };
  };

  const results = (data.web?.results ?? [])
    .filter((item) => item.title && item.url)
    .slice(0, input.count)
    .map((item) => ({
      title: cleanText(item.title),
      url: String(item.url),
      snippet: cleanText(item.description),
      source: cleanText(item.profile?.name),
    }));

  return { provider: "Brave Search", results };
}

function collectDuckDuckGoTopics(topic: any, results: SearchResult[], limit: number) {
  if (results.length >= limit) return;

  if (Array.isArray(topic?.Topics)) {
    for (const child of topic.Topics) {
      collectDuckDuckGoTopics(child, results, limit);
      if (results.length >= limit) return;
    }
    return;
  }

  if (topic?.FirstURL && topic?.Text) {
    const text = cleanText(topic.Text);
    const [title, ...rest] = text.split(" - ");
    results.push({
      title: title || text,
      url: String(topic.FirstURL),
      snippet: rest.join(" - ") || text,
      source: "DuckDuckGo",
    });
  }
}

async function duckDuckGoSearch(input: Required<SearchInput>): Promise<{ provider: string; results: SearchResult[]; note?: string }> {
  const url = new URL("https://api.duckduckgo.com/");
  url.searchParams.set("q", input.query);
  url.searchParams.set("format", "json");
  url.searchParams.set("no_html", "1");
  url.searchParams.set("no_redirect", "1");
  url.searchParams.set("skip_disambig", "1");

  const response = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: { "User-Agent": "AgenticCoder/1.0" },
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo request failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as any;
  const results: SearchResult[] = [];

  if (data.AbstractURL && data.Heading) {
    results.push({
      title: cleanText(data.Heading),
      url: String(data.AbstractURL),
      snippet: cleanText(data.AbstractText),
      source: cleanText(data.AbstractSource) || "DuckDuckGo",
    });
  }

  for (const item of data.Results ?? []) {
    collectDuckDuckGoTopics(item, results, input.count);
  }
  for (const item of data.RelatedTopics ?? []) {
    collectDuckDuckGoTopics(item, results, input.count);
  }

  return {
    provider: "DuckDuckGo Instant Answer",
    results: results.slice(0, input.count),
    note: "Fallback provider. For full web search results, set BRAVE_API_KEY and use provider=auto or provider=brave.",
  };
}

function formatResults(query: string, provider: string, results: SearchResult[], note?: string) {
  const lines = [`Web search for: ${query}`, `Provider: ${provider}`];
  if (note) lines.push(`Note: ${note}`);
  if (results.length === 0) {
    lines.push("", "No results returned.");
    return lines.join("\n");
  }

  results.forEach((result, index) => {
    lines.push("", `${index + 1}. ${result.title}`);
    lines.push(`   URL: ${result.url}`);
    if (result.source) lines.push(`   Source: ${result.source}`);
    if (result.snippet) lines.push(`   Snippet: ${result.snippet}`);
  });

  return lines.join("\n");
}

const rawInput = readInput();
const query = cleanText(rawInput.query);
if (!query) {
  throw new Error("query is required");
}

const input: Required<SearchInput> = {
  query,
  count: resultLimit(rawInput.count),
  provider: rawInput.provider || "auto",
  freshness: rawInput.freshness || "any",
};

let response: { provider: string; results: SearchResult[]; note?: string };
if (input.provider === "brave" || (input.provider === "auto" && (process.env.BRAVE_API_KEY || process.env.BRAVE_SEARCH_API_KEY))) {
  response = await braveSearch(input);
} else {
  response = await duckDuckGoSearch(input);
}

console.log(formatResults(query, response.provider, response.results, response.note));
