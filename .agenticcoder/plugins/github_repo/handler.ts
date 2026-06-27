type Input = {
  repo?: string;
  mode?: "summary" | "releases" | "issues";
  count?: number;
};

function readInput(): Input {
  try {
    return JSON.parse(process.env.PLUGIN_INPUT || "{}") as Input;
  } catch {
    return {};
  }
}

function limitCount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 5;
  return Math.max(1, Math.min(20, Math.floor(parsed)));
}

async function githubGet(path: string) {
  const token = process.env.GITHUB_TOKEN || process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
  const response = await fetch(`https://api.github.com${path}`, {
    signal: AbortSignal.timeout(15_000),
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "AgenticCoder/1.0",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

const input = readInput();
const repo = String(input.repo || "").trim();
const mode = input.mode || "summary";
const count = limitCount(input.count);

if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
  throw new Error("repo must be in owner/name format");
}

if (mode === "releases") {
  const releases = await githubGet(`/repos/${repo}/releases?per_page=${count}`) as any[];
  const lines = [`GitHub releases: ${repo}`];
  for (const release of releases) {
    lines.push("", `- ${release.name || release.tag_name}`);
    lines.push(`  Tag: ${release.tag_name}`);
    lines.push(`  Published: ${release.published_at || "unknown"}`);
    lines.push(`  URL: ${release.html_url}`);
  }
  console.log(lines.join("\n"));
} else if (mode === "issues") {
  const issues = await githubGet(`/repos/${repo}/issues?state=open&per_page=${count}`) as any[];
  const lines = [`GitHub open issues: ${repo}`];
  for (const issue of issues.filter((item) => !item.pull_request).slice(0, count)) {
    lines.push("", `- #${issue.number} ${issue.title}`);
    lines.push(`  Updated: ${issue.updated_at}`);
    lines.push(`  URL: ${issue.html_url}`);
  }
  console.log(lines.join("\n"));
} else {
  const data = await githubGet(`/repos/${repo}`) as any;
  const latestRelease = await githubGet(`/repos/${repo}/releases/latest`).catch(() => null) as any;
  const lines = [
    `GitHub repository: ${repo}`,
    `Description: ${data.description || "No description"}`,
    `Default branch: ${data.default_branch}`,
    `Language: ${data.language || "unknown"}`,
    `Stars: ${data.stargazers_count}`,
    `Forks: ${data.forks_count}`,
    `Open issues: ${data.open_issues_count}`,
    `License: ${data.license?.spdx_id || "unknown"}`,
    `Updated: ${data.updated_at}`,
    `URL: ${data.html_url}`,
  ];

  if (latestRelease) {
    lines.push("", `Latest release: ${latestRelease.name || latestRelease.tag_name}`);
    lines.push(`Release date: ${latestRelease.published_at || "unknown"}`);
    lines.push(`Release URL: ${latestRelease.html_url}`);
  }

  console.log(lines.join("\n"));
}
