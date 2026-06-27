type Input = {
  packageName?: string;
  version?: string;
  includeVersions?: boolean;
};

function readInput(): Input {
  try {
    return JSON.parse(process.env.PLUGIN_INPUT || "{}") as Input;
  } catch {
    return {};
  }
}

function formatRecord(record: Record<string, string> | undefined, limit = 12): string[] {
  if (!record || Object.keys(record).length === 0) return ["- none"];
  return Object.entries(record)
    .slice(0, limit)
    .map(([name, range]) => `- ${name}: ${range}`);
}

const input = readInput();
const packageName = String(input.packageName || "").trim();
const requestedVersion = String(input.version || "latest").trim();

if (!packageName) {
  throw new Error("packageName is required");
}

const encodedName = packageName.startsWith("@")
  ? `@${encodeURIComponent(packageName.slice(1)).replace("%2F", "/")}`
  : encodeURIComponent(packageName);

const response = await fetch(`https://registry.npmjs.org/${encodedName}`, {
  signal: AbortSignal.timeout(15_000),
  headers: { "User-Agent": "AgenticCoder/1.0" },
});

if (!response.ok) {
  throw new Error(`npm registry request failed: ${response.status} ${response.statusText}`);
}

const metadata = await response.json() as any;
const distTags = metadata["dist-tags"] || {};
const resolvedVersion = distTags[requestedVersion] || requestedVersion;
const versionInfo = metadata.versions?.[resolvedVersion];

if (!versionInfo) {
  const availableTags = Object.keys(distTags).join(", ") || "none";
  throw new Error(`Version or dist-tag not found: ${requestedVersion}. Available dist-tags: ${availableTags}`);
}

const lines = [
  `npm package: ${metadata.name}`,
  `Description: ${metadata.description || versionInfo.description || "No description"}`,
  `Requested: ${requestedVersion}`,
  `Resolved version: ${versionInfo.version}`,
  `Latest: ${distTags.latest || "unknown"}`,
  `License: ${versionInfo.license || metadata.license || "unknown"}`,
  `Homepage: ${versionInfo.homepage || metadata.homepage || "none"}`,
  `Repository: ${typeof versionInfo.repository === "string" ? versionInfo.repository : versionInfo.repository?.url || "none"}`,
  "",
  "Dependencies:",
  ...formatRecord(versionInfo.dependencies),
  "",
  "Peer dependencies:",
  ...formatRecord(versionInfo.peerDependencies),
];

if (input.includeVersions) {
  const versions = Object.keys(metadata.versions || {}).slice(-12).reverse();
  lines.push("", "Recent versions:", ...versions.map((version) => `- ${version}`));
}

console.log(lines.join("\n"));
