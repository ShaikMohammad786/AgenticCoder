# AgenticCoder 🤖

> AI-powered terminal coding assistant with multi-provider support, 16+ tools, plugin system, and intelligent context management.

## ✨ Features

### 🧠 AI & Providers
- **Multi-Provider**: OpenRouter (15+ free models) + Ollama (local models, zero cloud)
- **Token-Aware Context Management**: Priority-based message trimming with budget allocation (system 15% / project 10% / history 55% / reserve 20%)
- **Conversation Memory (RAG)**: Cross-session learning — remembers your preferences, corrections, and project context using BM25 keyword retrieval
- **Auto-Lint Self-Healing**: After every code edit, runs language-specific linters and feeds errors back to the AI for automatic correction
- **Streaming Progress**: Real-time `⚡ 142 tok/s │ ⏱ 3.2s │ 📊 1.2K` in the status bar

### 🔧 Tools & Extensibility
- **16 Built-in Tools**: readFile, writeFile, editFile, bash, grep, glob, searchReplace, listDirectory, listCodeDefinitions, gitStatus, gitDiff, gitLog, gitBlame, fetchUrl, thinkOut, fileInfo
- **Plugin System**: Create custom tools in `.agenticcoder/plugins/` with JSON manifests + shell handlers
- **Skills System**: 5 built-in + custom reusable prompt templates (code review, add tests, refactor, debug, document)
- **MCP Protocol**: Connect external tool servers via Model Context Protocol

### 🎨 Developer Experience
- **Rich Diff Viewer**: Colorized before/after diffs on every file edit
- **File Watcher**: Real-time toast notifications for external file changes (debounced, AI-write-aware)
- **Image Understanding**: Vision model support with screenshot capture and clipboard paste
- **Git Checkpoints**: Automatic undo/redo with `git stash` before destructive operations
- **10+ Themes**: Dracula, Monokai, Solarized, Nord, Tokyo Night, and more

### 🔒 Production
- **Auth**: Clerk OAuth PKCE flow
- **Billing**: Polar credits-based metering (skip billing for local Ollama models)
- **Rate Limiting**: Per-user request throttling (10 req/min)
- **Security**: SSRF protection, path traversal blocking, sandboxed plugin execution

## Prerequisites

- [Bun](https://bun.sh) v1.1+
- [Git](https://git-scm.com)
- A [Neon](https://neon.tech) PostgreSQL database (free tier works)
- An [OpenRouter](https://openrouter.ai) API key (free models available)
- A [Clerk](https://clerk.com) application (for OAuth authentication)
- A [Polar](https://polar.sh) account (for billing — sandbox mode works)
- *(Optional)* [Ollama](https://ollama.com) for local model support

## Project Structure

```
agenticcoder/
├── packages/
│   ├── shared/        # Types, schemas, model definitions, token counter
│   ├── database/      # Prisma schema + Neon PostgreSQL client
│   ├── server/        # Express API server (auth, chat, billing, context manager)
│   └── cli/           # Terminal UI app (React + @opentui)
│       └── src/
│           ├── hooks/       # useChat (streaming, memory, plugins)
│           ├── screens/     # Session screen (file watcher, metrics)
│           ├── components/  # UI components + dialogs + command menu
│           ├── providers/   # Theme, auth, toast, prompt config
│           └── lib/         # Core libraries ↓
│               ├── local-tools.ts       # 16 tool implementations
│               ├── auto-lint.ts         # Self-healing lint pipeline
│               ├── memory.ts            # RAG conversation memory
│               ├── streaming-tracker.ts # Token/s metrics
│               ├── diff-renderer.ts     # Rich diff engine
│               ├── file-watcher.ts      # External change detection
│               ├── ollama.ts            # Ollama client
│               ├── plugins.ts           # Plugin loader
│               ├── skills.ts            # Skills loader
│               ├── image-input.ts       # Screenshot/clipboard capture
│               ├── mcp-client.ts        # MCP protocol client
│               └── checkpoint.ts        # Git checkpoint/undo
├── .agenticcoder/     # User extensions
│   ├── plugins/       # Custom tools (JSON manifest + handler script)
│   └── skills/        # Custom prompt templates (Markdown + YAML)
├── .env               # All environment variables (single file)
└── tsconfig.base.json # Shared TypeScript config
```

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/ShaikMohammad786/AgenticCoder.git
cd AgenticCoder
bun install
```

### 2. Configure Environment

Copy and fill in your `.env` at the project root:

```env
# Database (Neon PostgreSQL)
DATABASE_URL="postgresql://user:pass@host/dbname?ssl=true"

# Backend URL
API_URL=http://localhost:3000

# AI Provider (OpenRouter — free models available)
OPENROUTER_API_KEY="sk-or-v1-..."

# Authentication (Clerk)
CLERK_FRONTEND_API="https://your-app.clerk.accounts.dev"
CLERK_PUBLISHABLE_KEY="pk_test_..."
CLERK_SECRET_KEY="sk_test_..."
CLERK_OAUTH_CLIENT_ID="..."
CLERK_OAUTH_CLIENT_SECRET="..."

# Billing (Polar — use sandbox for development)
POLAR_ACCESS_TOKEN="polar_oat_..."
POLAR_PRODUCT_ID="..."
POLAR_CREDITS_METER_ID="..."
POLAR_SERVER=sandbox

# Optional
JWT_SECRET="your-random-64-char-secret"
```

### 3. Generate Prisma Client

```bash
cd packages/database
bunx prisma generate
```

### 4. Run Database Migrations

```bash
cd packages/database
bunx prisma migrate dev
```

### 5. Start Development

Open **two terminals**:

```bash
# Terminal 1 — Backend API server (port 3000)
bun run dev:server

# Terminal 2 — CLI terminal app
bun run dev:cli
```

### 6. Login

Once the CLI starts, type `/login` and authenticate via your browser.

### 7. (Optional) Setup Ollama

```bash
# Install Ollama from https://ollama.com
ollama pull codellama:7b
# Then use /ollama command in the CLI to select the model
```

## Available Commands

| Command | Description |
|---------|-------------|
| `/new` | Start a new conversation |
| `/clear` | Clear chat and go home |
| `/agents` | Switch between Plan/Build modes |
| `/models` | Select AI model |
| `/ollama` | Browse & select local Ollama models |
| `/skills` | Browse & activate prompt skills |
| `/plugins` | View installed plugins |
| `/sessions` | Browse past sessions |
| `/theme` | Change color theme |
| `/login` | Sign in via browser |
| `/logout` | Sign out |
| `/upgrade` | Buy credits |
| `/usage` | Open billing portal |
| `/status` | Show current config |
| `/help` | List all commands |
| `/exit` | Quit |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Tab` | Toggle Plan/Build mode |
| `Esc` | Interrupt streaming response |
| `@` | File mention picker |
| `/` | Command menu |
| `Ctrl+C` | Clear input / exit |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                           YOUR MACHINE                              │
│                                                                     │
│  ┌─────────────────────┐           ┌───────────────────────────┐   │
│  │    CLI (Terminal)    │  HTTP     │    Server (Express API)   │   │
│  │                     │ ◄──────► │                           │   │
│  │  React + @opentui   │  Stream   │  /chat   → AI SDK stream │   │
│  │                     │           │  /auth   → Clerk OAuth   │   │
│  │  ┌───────────────┐ │           │  /billing → Polar        │   │
│  │  │ local-tools.ts│ │           │                           │   │
│  │  │ (16 tools)    │ │           │  ┌─────────────────────┐ │   │
│  │  │ + auto-lint   │ │           │  │  Context Manager    │ │   │
│  │  │ + diff render │ │           │  │  (token-aware       │ │   │
│  │  │ + file watch  │ │           │  │   priority trimming)│ │   │
│  │  │ + plugins     │ │           │  └─────────────────────┘ │   │
│  │  └───────────────┘ │           └───────────┬───────────────┘   │
│  │                     │                       │                    │
│  │  ┌───────────────┐ │                       │                    │
│  │  │ Memory (RAG)  │ │                       ▼                    │
│  │  │ ~/.agenticcoder│ │           ┌───────────────────────────┐   │
│  │  │ /memory.jsonl │ │           │    External Services      │   │
│  │  └───────────────┘ │           │                           │   │
│  │                     │           │  • OpenRouter (15+ LLMs) │   │
│  │  ┌───────────────┐ │           │  • Ollama (local models) │   │
│  │  │ Stream Tracker│ │           │  • Neon (PostgreSQL)     │   │
│  │  │ ⚡ tok/s │ ⏱  │ │           │  • Clerk (Auth)          │   │
│  │  └───────────────┘ │           │  • Polar (Billing)       │   │
│  └─────────────────────┘           └───────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

**Key design choices:**
- **Client-side tool execution**: All 16 tools execute on your machine. The server never touches your files.
- **Token-aware context**: Priority-based trimming ensures important messages (errors, user instructions) are kept over low-value content.
- **Self-healing**: Auto-lint pipeline catches errors immediately after the AI writes code, feeding them back for automatic correction.
- **Cross-session memory**: Preferences and corrections persist in an append-only JSONL log with BM25 retrieval.

## System Design Highlights

| Concept | Implementation |
|---------|---------------|
| **Token Budget Allocation** | 15% system / 10% project / 55% history / 20% reserve |
| **Priority Queue** | Message scoring: errors (+50) > user (+30) > write tools (+25) > text |
| **BM25 Retrieval** | Memory keyword search with IDF scoring + recency bias |
| **Self-Healing Loop** | lint errors → tool output → AI auto-corrects |
| **Provider Abstraction** | OpenRouter + Ollama behind `resolveChatModel()` |
| **Plugin Architecture** | JSON manifest + subprocess execution with env var passing |
| **Streaming Metrics** | Rolling 50-chunk window for tok/s calculation |
| **Append-Only Log** | Memory JSONL with 90-day TTL expiry |
| **Event Debouncing** | File watcher 500ms debounce + AI-write filtering |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun |
| Language | TypeScript (strict mode) |
| Monorepo | Bun Workspaces |
| Server | Express 5 (HTTP framework) |
| CLI UI | @opentui/react (terminal React renderer) |
| Database | Neon PostgreSQL + Prisma ORM |
| AI | Vercel AI SDK + OpenRouter + Ollama |
| Auth | Clerk (OAuth PKCE flow) |
| Billing | Polar (credits-based metering) |
| Error Tracking | Sentry |

## Creating Plugins

Create a directory in `.agenticcoder/plugins/your-tool/`:

```json
// plugin.json
{
  "name": "your-tool",
  "description": "What this tool does",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string", "description": "Input query" }
    },
    "required": ["query"]
  },
  "handler": "handler.sh"
}
```

```bash
#!/bin/bash
# handler.sh — receives PLUGIN_INPUT as JSON env var
echo "Result: $(echo $PLUGIN_INPUT | jq -r '.query')"
```

## Creating Skills

Add Markdown files to `.agenticcoder/skills/`:

```markdown
---
name: My Custom Skill
description: What this skill does
mode: BUILD
---

You are a specialized assistant for [task].
Follow these steps:
1. ...
2. ...
```

## License

MIT
