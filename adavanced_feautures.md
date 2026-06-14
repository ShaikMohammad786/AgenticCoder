# AgenticCoder — Complete Change Walkthrough

## Table of Contents
- [1. MCP Support](#1-mcp-support)
- [2. Dialog ESC Fix](#2-dialog-esc-fix)
- [3. Agents Dialog Fix](#3-agents-dialog-fix)
- [4. Preference Persistence](#4-preference-persistence)
- [5. Error Boundaries](#5-error-boundaries)
- [6. Checkpoint / Undo System](#6-checkpoint--undo-system)
- [7. Image Input](#7-image-input)
- [8. Project Context Injection](#8-project-context-injection)
- [9. Bash Streaming](#9-bash-streaming)

---

## 1. MCP Support

### Files Changed

#### [mcp-client.ts](file:///m:/MOHAMMAD/Full%20Stack%20Develoment/Web%20Development/MERN/AgenticCoder/packages/cli/src/lib/mcp-client.ts) — The MCP protocol engine

**Types defined:**
```ts
type McpServerConfig = {
  command: string;      // e.g. "npx"
  args: string[];       // e.g. ["-y", "@modelcontextprotocol/server-puppeteer"]
  env?: Record<string, string>; // e.g. { GITHUB_TOKEN: "..." }
};

type McpConfig = {
  mcpServers: Record<string, McpServerConfig>; // keyed by server name
};

type McpConnection = {
  process: ChildProcess;          // spawned subprocess handle
  tools: McpToolDefinition[];     // discovered tools from this server
  connected: boolean;
};

type McpToolDefinition = {
  name: string;        // prefixed: "mcp_servername_toolname"
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema for tool params
};
```

**Key functions:**
| Function | Signature | Purpose |
|----------|-----------|---------|
| `hasMcpConfig()` | `() → boolean` | Checks if `.agenticcoder/mcp.json` exists in cwd |
| `loadMcpConfig()` | `() → McpConfig` | Reads + parses the config file |
| `initializeMcp()` | `(cwd?) → Promise<{errors: string[]}>` | Spawns all servers, discovers tools via JSON-RPC `tools/list` |
| `getAllMcpTools()` | `() → McpToolDefinition[]` | Returns flat list of all tools from all connected servers |
| `getMcpStatus()` | `() → McpServerInfo[]` | Returns server name, connected status, tool count, tool names |
| `callMcpTool()` | `(name, input) → Promise<unknown>` | Routes a tool call to correct server via JSON-RPC `tools/call` |
| `executeMcpTool` | alias for `callMcpTool` | Used by `local-tools.ts` |
| `isMcpTool()` | `(name) → boolean` | Returns true if name starts with `mcp_` |
| `shutdownMcp()` | `() → void` | Kills all spawned server processes |

**Flow: How MCP tools connect**
```
1. CLI starts → use-chat.ts useEffect fires
2. hasMcpConfig() checks .agenticcoder/mcp.json exists
3. initializeMcp() reads config, for each server:
   a. Spawns process: Bun.spawn([command, ...args])
   b. Sends JSON-RPC: {"method": "initialize", "params": {...}}
   c. Waits for {"result": {"capabilities": ...}}
   d. Sends JSON-RPC: {"method": "tools/list"}
   e. Receives: {"result": {"tools": [{name, description, inputSchema}]}}
   f. Prefixes each tool: "mcp_servername_toolname"
   g. Stores in connections Map
4. getAllMcpTools() collects tools from all connections
5. Tools sent to server in chat request body as mcpTools[]
```

**Flow: How AI calls an MCP tool**
```
1. Server includes MCP tools in streamText({tools: {...builtIn, ...mcpTools}})
2. AI decides to call mcp_puppeteer_screenshot
3. Client receives tool call in onToolCall
4. local-tools.ts checks isMcpTool("mcp_puppeteer_screenshot") → true
5. Calls executeMcpTool("mcp_puppeteer_screenshot", {url: "..."})
6. mcp-client.ts finds "puppeteer" connection
7. Sends JSON-RPC: {"method": "tools/call", "params": {name: "screenshot", arguments: {url: "..."}}}
8. Receives result, returns to AI
```

---

#### [mcp-dialog.tsx](file:///m:/MOHAMMAD/Full%20Stack%20Develoment/Web%20Development/MERN/AgenticCoder/packages/cli/src/components/dialogs/mcp-dialog.tsx) — MCP Server UI

**Types:**
```ts
type McpListItem = {
  id: string;           // server identifier (e.g. "github")
  label: string;        // display name (e.g. "GitHub")
  description: string;  // help text (e.g. "Manage repos, issues, PRs")
  status: "connected" | "configured" | "available";
  toolCount: number;
  needsKey: boolean;    // true if server needs API key
  catalogEntry?: CatalogEntry; // reference to install config
};
```

**Built-in catalog (6 servers):**
| Server | Package | Needs API Key |
|--------|---------|---------------|
| Filesystem | `@modelcontextprotocol/server-filesystem` | No |
| GitHub | `@modelcontextprotocol/server-github` | Yes (GITHUB_TOKEN) |
| Brave Search | `@modelcontextprotocol/server-brave-search` | Yes (BRAVE_API_KEY) |
| PostgreSQL | `@modelcontextprotocol/server-postgres` | Yes (DATABASE_URL) |
| Memory | `@modelcontextprotocol/server-memory` | No |
| Puppeteer | `@modelcontextprotocol/server-puppeteer` | No |

**Flow: User opens /mcp**
```
1. Command menu calls ctx.dialog.open({title: "MCP Servers", children: <McpDialogContent />})
2. useEffect fires:
   a. If hasMcpConfig() → tries initializeMcp() with 5s timeout
   b. Gets connected servers via getMcpStatus()
   c. Reads .agenticcoder/mcp.json for configured-but-not-connected
   d. Adds remaining catalog entries as "available"
   e. Sets items[] → loading=false → renders DialogSearchList
3. User navigates with ↑↓, selects with Enter
4. On select "available" server:
   a. Reads/creates .agenticcoder/mcp.json
   b. Adds server entry with command, args, env
   c. Writes JSON back
   d. If needsKey → opens browser to setup URL
   e. Closes dialog
5. ESC → dialog.close() (handled by useKeyboard)
```

---

#### [use-chat.ts](file:///m:/MOHAMMAD/Full%20Stack%20Develoment/Web%20Development/MERN/AgenticCoder/packages/cli/src/hooks/use-chat.ts) — MCP integration in chat

**New refs:**
```ts
const mcpToolsRef = useRef<ReturnType<typeof getAllMcpTools> | null>(null);
const mcpInitializedRef = useRef(false);
```

**New useEffect logic:**
```ts
// Fires once on mount
if (!mcpInitializedRef.current && hasMcpConfig()) {
  mcpInitializedRef.current = true;
  Promise.race([
    initializeMcp(),
    new Promise((_, reject) => setTimeout(() => reject("timeout"), 10000)),
  ]).then(() => {
    mcpToolsRef.current = getAllMcpTools(); // cache tools
  }).catch(() => {});
}
```

**New request body field:**
```ts
// In prepareSendMessagesRequest:
const mcpTools = mcpToolsRef.current?.map((t) => ({
  name: t.name,
  description: t.description,
  inputSchema: t.inputSchema,
})) ?? [];

body: {
  ...existingFields,
  mcpTools: mcpTools.length > 0 ? mcpTools : undefined, // NEW
}
```

---

#### [chat.ts (server)](file:///m:/MOHAMMAD/Full%20Stack%20Develoment/Web%20Development/MERN/AgenticCoder/packages/server/src/routes/chat.ts) — Server accepts MCP tools

**Schema change:**
```ts
const submitSchema = z.object({
  // ...existing fields...
  projectContext: z.string().optional(),        // NEW
  mcpTools: z.array(z.object({                  // NEW
    name: z.string(),
    description: z.string(),
    inputSchema: z.record(z.unknown()),
  })).optional(),
});
```

**Tool merging:**
```ts
const builtInTools = getToolContracts(mode);     // was: const tools = ...
const tools: Record<string, any> = { ...builtInTools };

if (mcpTools && mcpTools.length > 0) {
  for (const mcpTool of mcpTools) {
    tools[mcpTool.name] = {
      description: mcpTool.description,
      parameters: mcpTool.inputSchema,
    };
  }
}
```

**System prompt injection:**
```ts
system: buildSystemPrompt({ mode }) + (projectContext ? "\n\n" + projectContext : ""),
```

---

#### [local-tools.ts](file:///m:/MOHAMMAD/Full%20Stack%20Develoment/Web%20Development/MERN/AgenticCoder/packages/cli/src/lib/local-tools.ts) — MCP tool routing

**Import:**
```ts
import { isMcpTool, executeMcpTool } from "./mcp-client";
```

**Routing (in executeLocalTool function):**
```ts
// After all built-in tool handlers:
if (isMcpTool(toolName)) {
  return executeMcpTool(toolName, input as Record<string, unknown>);
}
```

---



## 2. Agents Dialog Fix

#### [agents-dialog.tsx](file:///m:/MOHAMMAD/Full%20Stack%20Develoment/Web%20Development/MERN/AgenticCoder/packages/cli/src/components/dialogs/agents-dialog.tsx)

**Problem:** "Build" label was invisible. The `DialogSearchList` wrapper has `height={1}` + `overflow="hidden"` on each item row. Having TWO `<text>` children inside the row caused layout overflow — the label text was pushed out of view.

**Fix:** Merged everything into a single `<text>` element with one concatenated string:

```diff
-  <box flexDirection="row" gap={1}>
-    <text fg={isSelected ? "black" : "white"}>
-      {item.mode === currentMode ? " ◉ " : " ○ "}
-      {item.label}
-    </text>
-    <text attributes={TextAttributes.DIM} fg={isSelected ? "black" : colors.dimSeparator}>
-      {item.description}
-    </text>
-  </box>
+  <text selectable={false} fg={isSelected ? "black" : "white"}>
+    {(item.mode === currentMode ? " ◉ " : " ○ ") + item.label + "  " + item.description}
+  </text>
```

**Key insight:** In @opentui with `height={1}` rows, use a SINGLE `<text>` element per row.

---

## 3. Preference Persistence

#### [prompt-config/index.tsx](file:///m:/MOHAMMAD/Full%20Stack%20Develoment/Web%20Development/MERN/AgenticCoder/packages/cli/src/providers/prompt-config/index.tsx)

**Storage location:** `~/.agenticcoder/preferences.json`

**Format:**
```json
{
  "model": "google/gemini-2.5-flash",
  "mode": "BUILD"
}
```

**Load on mount:**
```ts
useEffect(() => {
  const prefs = loadPreferences(); // reads file, returns {model?, mode?, theme?}
  if (prefs.model) setModel(prefs.model);
  if (prefs.mode) setMode(prefs.mode);
}, []);
```

**Save on change:**
```ts
const setModel = (model) => {
  _setModel(model);
  savePreferences({ model }); // merge-on-write: reads existing, merges, writes
};
```

**Merge-on-write pattern (prevents overwriting other preferences):**
```ts
function savePreferences(partial: Partial<Preferences>) {
  const existing = loadPreferences(); // read current
  const merged = { ...existing, ...partial }; // merge
  writeFileSync(PREFS_PATH, JSON.stringify(merged, null, 2));
}
```

#### [theme/index.tsx](file:///m:/MOHAMMAD/Full%20Stack%20Develoment/Web%20Development/MERN/AgenticCoder/packages/cli/src/providers/theme/index.tsx)

Same pattern — loads theme name from preferences on mount, saves on `/theme` change.

---



## 4. Checkpoint / Undo System

#### [checkpoint.ts](file:///m:/MOHAMMAD/Full%20Stack%20Develoment/Web%20Development/MERN/AgenticCoder/packages/cli/src/lib/checkpoint.ts)

**Functions:**
| Function | Signature | What it does |
|----------|-----------|-------------|
| `createCheckpoint()` | `() → Promise<{success, message}>` | Runs `git stash push -u -m "agenticcoder-checkpoint-{timestamp}"` |
| `undoToLastCheckpoint()` | `() → Promise<{success, message}>` | Finds latest checkpoint stash, runs `git stash pop` |
| `cleanupCheckpoints()` | `(keepCount=5) → Promise<void>` | Lists stashes, drops checkpoint stashes beyond keepCount |

**Git stash naming convention:**
```
stash@{0}: agenticcoder-checkpoint-1718378400000
stash@{1}: agenticcoder-checkpoint-1718378300000
```

**Commands in UI:**
- `/undo` → calls `undoToLastCheckpoint()`, shows toast with result
- `/commit` → runs `git add -A && git commit -m "chore: agenticcoder changes"`

---

## 5. Image Input

#### [image-input.ts](file:///m:/MOHAMMAD/Full%20Stack%20Develoment/Web%20Development/MERN/AgenticCoder/packages/cli/src/lib/image-input.ts)

**Types:**
```ts
type ImageAttachment = {
  filename: string;     // "screenshot.png"
  mimeType: string;     // "image/png"
  data: string;         // base64-encoded content
};
```

**Functions:**
| Function | Signature | Purpose |
|----------|-----------|---------|
| `extractImageAttachments()` | `(message, cwd?) → {cleanedMessage, images}` | Finds `@file.ext` patterns, reads files, returns base64 |
| `extractImageMentions()` | `(message, cwd?) → Promise<{text, images}>` | Async wrapper with `{text, images}` return shape for use-chat.ts |
| `hasImageReferences()` | `(message) → boolean` | Quick regex test for `@*.png` etc. |

**Supported extensions:** `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`, `.svg`

**Regex:** `/@([\w./-]+\.(png|jpg|jpeg|gif|webp|bmp|svg))/gi`

---

## 6. Project Context Injection

#### [project-context.ts](file:///m:/MOHAMMAD/Full%20Stack%20Develoment/Web%20Development/MERN/AgenticCoder/packages/cli/src/lib/project-context.ts)

**What it gathers:**
1. `.agenticcoder/AGENT.md` — project memory/instructions
2. `.agenticcoder/context/*.md` — additional context files
3. `package.json` — detects framework, dependencies, scripts

**Flow:**
```
1. use-chat.ts useEffect → buildProjectContext() → Promise<string>
2. gatherProjectContext() reads files:
   - AGENT.md content
   - All context/*.md files
   - package.json → detects React/Next/Express/etc.
3. formatContextForPrompt() formats as markdown block
4. Stored in projectContextRef.current
5. Sent with every chat request as body.projectContext
6. Server appends to system prompt: system + "\n\n" + projectContext
```

---

## 7. Bash Streaming

**Flow across files:**

#### [use-chat.ts](file:///m:/MOHAMMAD/Full%20Stack%20Develoment/Web%20Development/MERN/AgenticCoder/packages/cli/src/hooks/use-chat.ts)
```ts
const [bashOutput, setBashOutput] = useState("");       // accumulated output
const [isBashStreaming, setIsBashStreaming] = useState(false); // streaming indicator

const onBashOutput = useCallback((chunk: string) => {
  setIsBashStreaming(true);
  setBashOutput((prev) => {
    const combined = prev + chunk;
    const lines = combined.split("\n");
    return lines.length > 100 ? lines.slice(-100).join("\n") : combined; // cap at 100 lines
  });
  // Auto-clear streaming after 500ms idle
  bashTimeoutRef.current = setTimeout(() => setIsBashStreaming(false), 500);
}, []);
```

#### [session.tsx](file:///m:/MOHAMMAD/Full%20Stack%20Develoment/Web%20Development/MERN/AgenticCoder/packages/cli/src/screens/session.tsx)
```tsx
// Passes bash state as props to BotMessage
<BotMessage
  bashOutput={bashOutput}
  isBashStreaming={isBashStreaming}
/>
```

#### [bot-message.tsx](file:///m:/MOHAMMAD/Full%20Stack%20Develoment/Web%20Development/MERN/AgenticCoder/packages/cli/src/components/messages/bot-message.tsx)
```tsx
// Renders streaming bash output below the message
{isBashStreaming && bashOutput && (
  <box flexDirection="column">
    <text fg="gray">{bashOutput.split("\n").slice(-5).join("\n")}</text>
  </box>
)}
```

---


## Commands Added to [Commands.tsx](file:///m:/MOHAMMAD/Full%20Stack%20Develoment/Web%20Development/MERN/AgenticCoder/packages/cli/src/components/command-menu/Commands.tsx)

| Command | Description | Action |
|---------|-------------|--------|
| `/undo` | Revert to last checkpoint | `undoToLastCheckpoint()` → toast result |
| `/commit` | Git commit all changes | `bash: git add -A && git commit -m "..."` |
| `/mcp` | View/install MCP servers | `dialog.open({children: <McpDialogContent />})` |

**Help text updated:**
```
/new /clear /undo /commit /agents /models /mcp /sessions /theme /login /logout /upgrade /usage /help /status /exit
```

---

## Dialogs index [index.tsx](file:///m:/MOHAMMAD/Full%20Stack%20Develoment/Web%20Development/MERN/AgenticCoder/packages/cli/src/components/dialogs/index.tsx)

```ts
export { ThemeDialogContent } from "./theme-dialog";
export { SessionsDialogContent } from "./sessions-dialog";
export { AgentsDialogContent } from "./agents-dialog";
export { ModelsDialogContent } from "./models-dialog";
export { McpDialogContent } from "./mcp-dialog";  // NEW
```
