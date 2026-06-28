# AgenticCoder

AgenticCoder is a terminal-first AI coding agent built with Bun, TypeScript, Express, Prisma, the Vercel AI SDK, and OpenTUI. It runs the UI and tool execution on your machine, while the server coordinates model calls, auth, billing, context management, and session persistence.

The goal is a practical local coding agent: multi-provider models, real tool use, MCP and plugin extensions, parallel subagents, checkpoints, rich diffs, memory, and a terminal UI that stays readable while work streams.

## Highlights

- **Many model providers**: OpenRouter, OpenAI, Anthropic, Gemini AI Studio, Groq, Together, Fireworks, Cerebras, DeepSeek, xAI, Mistral, Perplexity, Cloudflare Workers AI, NVIDIA NIM, NaraRouter, and local Ollama.
- **Provider-aware billing**: local Ollama is not billed; cloud models use catalog pricing or provider fallback pricing.
- **Unified tool behavior**: every provider receives the same AgenticCoder system prompt, project context, memory, and MCP/plugin tool list.
- **18 built-in tools in Build mode**: file read/write/edit, search, grep, glob, bash, git, URL fetch, semantic code search, diff-aware edits, and subagent spawning.
- **MCP support**: stdio MCP servers from `.agenticcoder/mcp.json`, with schema normalization for provider compatibility.
- **Wide MCP catalog**: filesystem, memory, sequential-thinking, Context7, Playwright, Puppeteer, Fetch, Git, Time, GitHub, Brave Search, Postgres, SQLite, Slack, Google Maps, Google Drive, n8n, Telegram, Notion, Supabase, Stripe, Sentry, GitLab, Redis, EverArt, Docker, Kubernetes, AWS, and Everything.
- **Scoped subagent MCP runtimes**: subagents still run in parallel, but each subagent gets isolated MCP processes when it calls MCP tools, so browser automation and other shared-state tools do not overwrite each other.
- **Plugin system**: local plugins plus external installs from GitHub, npm, and URLs, with manifest validation and API-key prompts.
- **Subagent orchestration**: researcher, coder, reviewer, planner, and debugger agents with logs, status chips, transcript viewer, timeout handling, and per-agent tool scopes.
- **Terminal UX**: safer streaming markdown rendering, sanitized ANSI/control output, readable errors, blank-response diagnostics, `/copy` clipboard fix, inline diffs instead of blocking dialogs, and external-file-change notifications that do not stop the model.
- **Project intelligence**: `.agenticcoder/AGENT.md`, `.agenticcoder/context/*.md`, installed plugins, MCP servers, local skills, `.env` key names, package metadata, memory, and semantic code search are injected into context.

## Architecture

```text
AgenticCoder
├─ packages/shared
│  ├─ model catalog, pricing, provider IDs
│  ├─ tool schemas and mode contracts
│  └─ token estimation helpers
├─ packages/database
│  ├─ Prisma schema
│  └─ Neon/PostgreSQL client
├─ packages/server
│  ├─ Express API
│  ├─ AI SDK streaming
│  ├─ auth and billing
│  ├─ context trimming
│  ├─ provider routing
│  └─ subagent endpoint
└─ packages/cli
   ├─ OpenTUI React terminal UI
   ├─ local tool execution
   ├─ MCP client
   ├─ plugin system
   ├─ subagent orchestrator
   ├─ memory, indexer, diffs, checkpoints
   └─ dialogs and command palette
```

The server never directly edits project files. It sends model tool calls back to the CLI, and the CLI executes them locally.

## Model Providers

Supported provider prefixes:

| Provider | Example model ID | Key env |
|---|---|---|
| OpenRouter | `qwen/qwen3-coder:free` | `OPENROUTER_API_KEY` |
| OpenAI | `openai:gpt-5` | `OPENAI_API_KEY` |
| Anthropic | `anthropic:claude-sonnet-4-5` | `ANTHROPIC_API_KEY` |
| Gemini AI Studio | `gemini:gemini-2.5-pro` | `GEMINI_API_KEY` |
| Groq | `groq:openai/gpt-oss-120b` | `GROQ_API_KEY` |
| Together | `together:meta-llama/Llama-3.3-70B-Instruct-Turbo` | `TOGETHER_API_KEY` |
| Fireworks | `fireworks:accounts/fireworks/models/gpt-oss-120b` | `FIREWORKS_API_KEY` |
| Cerebras | `cerebras:gpt-oss-120b` | `CEREBRAS_API_KEY` |
| DeepSeek | `deepseek:deepseek-v4-flash` | `DEEPSEEK_API_KEY` |
| xAI | `xai:grok-4` | `XAI_API_KEY` |
| Mistral | `mistral:mistral-large-latest` | `MISTRAL_API_KEY` |
| Perplexity | `perplexity:sonar-pro` | `PERPLEXITY_API_KEY` |
| Cloudflare | `cloudflare:@cf/meta/llama-3.3-70b-instruct-fp8-fast` | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` |
| NVIDIA NIM | `nvidia:meta/llama-3.3-70b-instruct` | `NVIDIA_API_KEY` |
| NaraRouter | `nararouter:mimo-v2.5-free` | `NARAROUTER_API_KEY`, optional `NARAROUTER_BASE_URL` |
| Ollama | `ollama:qwen2.5:1.5b` | local Ollama server |

Third-party OpenAI-compatible providers use chat completions. OpenAI direct uses the Responses API where supported. Tool behavior is unified by AgenticCoder, but some smaller/cheaper models may still return no tool call; the UI now shows a visible diagnostic instead of silently stopping.

## Built-In Tools

Build mode exposes:

- `readFile`, `listDirectory`, `glob`, `grep`, `listCodeDefinitions`, `fileInfo`
- `searchCodebase`
- `writeFile`, `editFile`, `searchReplace`
- `bash`
- `gitStatus`, `gitDiff`, `gitLog`, `gitBlame`
- `fetchUrl`
- `thinkOut`
- `spawnAgent`

Plan mode is read-focused. Write tools are withheld from the model, and local execution also blocks write tools in Plan mode.

## Subagents

AgenticCoder supports five subagent types:

| Type | Purpose |
|---|---|
| `researcher` | Read-only code and docs exploration |
| `coder` | File edits, implementation, build/test commands |
| `reviewer` | Bug, risk, security, and quality review |
| `planner` | Grounded implementation planning |
| `debugger` | Reproduction, diagnosis, fix, verification |

Subagents run concurrently. The main agent receives their summaries and integrates results. The UI shows active subagent chips at the bottom; selecting a chip opens that subagent conversation and tool transcript.

External-tool isolation:

- Built-in file tools still operate on the same workspace.
- MCP tools are scoped per subagent on first use.
- Playwright MCP gets per-subagent output directories under `.agenticcoder/playwright-output/<agent-id>`.
- Plugins receive `AGENTICCODER_TOOL_SCOPE`, so handlers can isolate state if they need to.

## MCP

MCP config lives at:

```text
.agenticcoder/mcp.json
```

Example:

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@modelcontextprotocol/server-filesystem", "."]
    },
    "playwright": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@playwright/mcp@latest", "--output-dir", ".agenticcoder/playwright-output"]
    }
  }
}
```

MCP tools are exposed to the model as:

```text
mcp_<server>_<tool>
```

The CLI:

1. reads `.agenticcoder/mcp.json`
2. starts configured servers
3. discovers tools with `tools/list`
4. normalizes schemas for AI SDK/provider compatibility
5. sends tool definitions to the server
6. executes returned MCP tool calls locally

## Plugins

Plugins live in:

```text
.agenticcoder/plugins/<name>/
```

Plugin layout:

```text
plugin.json
handler.sh | handler.ts | handler.js
```

Example manifest:

```json
{
  "name": "web_search",
  "description": "Search the web",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string" }
    },
    "required": ["query"]
  },
  "handler": "handler.ts",
  "env": {
    "BRAVE_API_KEY": ""
  }
}
```

Plugin tools are exposed as:

```text
plugin_<name>
```

External plugin installs support:

```text
/plugin install github:user/repo
/plugin install npm:package-name
/plugin install https://example.com/plugin.tgz
/plugin remove <name>
/plugin update <name>
```

Plugins with required env vars open a themed secret input dialog and save values into `.env`.

## Commands

| Command | Description |
|---|---|
| `/new` | Start a new session |
| `/clear` | Clear current chat/go home |
| `/models` | Select provider/model grouped by provider |
| `/ollama` | Browse local Ollama models |
| `/agents` | Switch Plan/Build mode |
| `/mcp` | View, connect, and install MCP servers |
| `/plugins` | View installed plugins |
| `/plugin install/remove/update` | Manage external plugins |
| `/skills` | Browse prompt skills |
| `/sessions` | Browse previous sessions |
| `/theme` | Change theme |
| `/checkpoints` | View/create/restore checkpoints |
| `/copy` | Copy selected/output text helper |
| `/login`, `/logout` | Auth |
| `/upgrade`, `/usage` | Billing |
| `/status` | Show current config |
| `/help` | Command list |
| `/exit` | Quit |

## Environment

Core env values:

```env
DATABASE_URL=""
API_URL="http://localhost:3000"
JWT_SECRET=""

CLERK_FRONTEND_API=""
CLERK_PUBLISHABLE_KEY=""
CLERK_SECRET_KEY=""
CLERK_OAUTH_CLIENT_ID=""
CLERK_OAUTH_CLIENT_SECRET=""

POLAR_ACCESS_TOKEN=""
POLAR_PRODUCT_ID=""
POLAR_CREDITS_METER_ID=""
POLAR_SERVER="sandbox"

OPENROUTER_API_KEY=""
OPENAI_API_KEY=""
ANTHROPIC_API_KEY=""
GEMINI_API_KEY=""
GROQ_API_KEY=""
TOGETHER_API_KEY=""
FIREWORKS_API_KEY=""
CEREBRAS_API_KEY=""
DEEPSEEK_API_KEY=""
XAI_API_KEY=""
MISTRAL_API_KEY=""
PERPLEXITY_API_KEY=""
CLOUDFLARE_ACCOUNT_ID=""
CLOUDFLARE_API_TOKEN=""
NVIDIA_API_KEY=""
NARAROUTER_API_KEY=""
NARAROUTER_BASE_URL=""
OLLAMA_BASE_URL="http://localhost:11434"
```

Secret values are never injected into prompts. Only env key names are included in project context.

## Quick Start

```bash
git clone https://github.com/ShaikMohammad786/AgenticCoder.git
cd AgenticCoder
bun install
```

Generate Prisma:

```bash
cd packages/database
bunx prisma generate
```

Start the app:

```bash
# Terminal 1
bun run dev:server

# Terminal 2
bun run dev:cli
```

Build:

```bash
bun run --filter @agenticcoder/server build
bun run --filter @agenticcoder/cli build
```

On Windows, sandboxed builds may hit file-read `EPERM` for some local files; running the same `bun run build` normally works.

## Notes

- Tool-heavy prompts need a model with strong tool-calling behavior. Smaller models can finish without visible text or a tool call; AgenticCoder now surfaces that as a visible diagnostic.
- MCP servers started from npm may need network access on first run.
- Browser automation is MCP-backed and can open real browser windows depending on the server.
- Checkpoints use git stash. Keep a clean commit history for best restore behavior.

## License

MIT
