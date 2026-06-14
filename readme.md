# AgenticCoder

> AI-powered terminal coding assistant with 16 tools, streaming chat, and client-side execution.

## Prerequisites

- [Bun](https://bun.sh) v1.1+
- [Node.js](https://nodejs.org) v20+ (for some dependencies)
- [Git](https://git-scm.com)
- A [Neon](https://neon.tech) PostgreSQL database (free tier works)
- An [OpenRouter](https://openrouter.ai) API key (free models available)
- A [Clerk](https://clerk.com) application (for OAuth authentication)
- A [Polar](https://polar.sh) account (for billing — sandbox mode works)

## Project Structure

```
agenticcoder/
├── packages/
│   ├── shared/        # Types, schemas, model definitions (shared by all packages)
│   ├── database/      # Prisma schema + Neon PostgreSQL client
│   ├── server/        # Hono API server (auth, chat, billing, sessions)
│   └── cli/           # Terminal UI app (React + @opentui)
├── .env               # All environment variables (single file)
├── package.json       # Bun workspace root
└── tsconfig.base.json # Shared TypeScript config
```

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/your-username/AgenticCoder.git
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

## Available Commands

| Command | Description |
|---------|-------------|
| `/new` | Start a new conversation |
| `/clear` | Clear chat and go home |
| `/agents` | Switch between Plan/Build modes |
| `/models` | Select AI model |
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

## Architecture Overview

```
CLI (Terminal UI)          Server (Hono API)         Database (Neon)
┌─────────────────┐       ┌─────────────────┐       ┌──────────────┐
│  React + @opentui│ ───► │  /chat (stream)  │ ───► │  PostgreSQL  │
│                 │       │  /sessions CRUD  │       │  (Prisma ORM)│
│  Tools execute  │       │  /auth callback  │       └──────────────┘
│  CLIENT-SIDE    │       │  /billing (Polar)│
│  (local-tools.ts)│       │                 │       ┌──────────────┐
│                 │ ◄──── │  AI SDK stream   │ ◄──── │  OpenRouter  │
└─────────────────┘       └─────────────────┘       │  (LLM API)   │
                                                     └──────────────┘
```

**Key design choice:** All 16 tools execute on the client machine (not server). The server only orchestrates the AI conversation — tool calls are intercepted by the CLI and executed locally via `local-tools.ts`.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun |
| Language | TypeScript (strict mode) |
| Monorepo | Bun Workspaces |
| Server | Hono (lightweight HTTP framework) |
| CLI UI | @opentui/react (terminal React renderer) |
| Database | Neon PostgreSQL + Prisma ORM |
| AI | Vercel AI SDK + OpenRouter |
| Auth | Clerk (OAuth PKCE flow) |
| Billing | Polar (credits-based metering) |
| Error Tracking | Sentry |
