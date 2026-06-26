# AgenticCoder — Complete Project Documentation

> This document explains **every file, every data type, every flow, and every interaction** in the AgenticCoder codebase. Read this top-to-bottom to fully understand how the project works from basic to advanced.

---

## Table of Contents

1. [What Is AgenticCoder?](#1-what-is-agenticcoder)
2. [Architecture Overview](#2-architecture-overview)
3. [Monorepo Structure](#3-monorepo-structure)
4. [Package: `shared`](#4-package-shared)
5. [Package: `database`](#5-package-database)
6. [Package: `server`](#6-package-server)
7. [Package: `cli`](#7-package-cli)
8. [Complete Data Flow](#8-complete-data-flow)
9. [Tool Execution Deep Dive](#9-tool-execution-deep-dive)
10. [Authentication Flow](#10-authentication-flow)
11. [Billing Flow](#11-billing-flow)
12. [Environment Variables](#12-environment-variables)
13. [Advanced: Token-Aware Context Management](#13-advanced-token-aware-context-management)
14. [Advanced: Conversation Memory (RAG)](#14-advanced-conversation-memory-rag)
15. [Advanced: Auto-Lint Self-Healing Pipeline](#15-advanced-auto-lint-self-healing-pipeline)
16. [Advanced: Streaming Progress Tracker](#16-advanced-streaming-progress-tracker)
17. [Advanced: Ollama Local Model Support](#17-advanced-ollama-local-model-support)
18. [Advanced: Plugin System, Skills, File Watcher, Rich Diff & Image Understanding](#18-advanced-plugin-system-skills-file-watcher-rich-diff--image-understanding)
19. [MCP (Model Context Protocol) Support](#19-mcp-model-context-protocol-support)
20. [Checkpoint / Undo System](#20-checkpoint--undo-system)
21. [Project Context Injection](#21-project-context-injection)
22. [Bash Streaming](#22-bash-streaming)
23. [Preference Persistence](#23-preference-persistence)
24. [Image Input Deep Dive](#24-image-input-deep-dive)

---

## 1. What Is AgenticCoder?

AgenticCoder is an **AI-powered coding assistant** that runs entirely in your terminal. Think of it like Claude Code or Cursor — but as an open-source terminal app.

**How it works at the highest level:**
1. You type a message in the terminal (e.g. "Fix the bug in auth.ts")
2. The CLI sends your message to the backend server
3. The server sends it to an AI model (via OpenRouter)
4. The AI responds with text AND tool calls (e.g. "read file X", "edit line Y")
5. Tool calls are sent back to the CLI and executed **locally on your machine**
6. Tool results are sent back to the AI, which continues reasoning
7. This loop repeats until the AI is done (up to 25 steps)

**Key design decision:** Tools run on the CLIENT (your machine), not the server. This means the server never touches your files — it only relays messages between you and the AI.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        YOUR MACHINE                         │
│                                                             │
│  ┌───────────────────┐         ┌──────────────────────┐    │
│  │   CLI (Terminal)   │ ◄────► │   Server (Port 3000)  │    │
│  │                   │  HTTP   │                      │    │
│  │  • React UI       │         │  • Express framework │    │
│  │  • @opentui       │         │  • AI SDK            │    │
│  │  • local-tools.ts │         │  • Clerk auth        │    │
│  │    (16 tools)     │         │  • Polar billing     │    │
│  └───────────────────┘         └──────────┬───────────┘    │
│         │                                  │                │
│         │ (reads/writes                    │ (API calls)    │
│         │  YOUR files)                     │                │
│         ▼                                  ▼                │
│  ┌──────────────┐              ┌──────────────────────┐    │
│  │ Your Project  │              │   External Services   │    │
│  │ Files (cwd)   │              │                      │    │
│  └──────────────┘              │  • OpenRouter (AI)   │    │
│                                 │  • Neon (PostgreSQL) │    │
│                                 │  • Clerk (Auth)      │    │
│                                 │  • Polar (Billing)   │    │
│                                 └──────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

**Three processes run:**
1. **Server** (`bun run dev:server`) — Express HTTP server on port 3000
2. **CLI** (`bun run dev:cli`) — Terminal React app
3. **Database** — Neon PostgreSQL (hosted, no local process)

---

## 3. Monorepo Structure

### Root `package.json`
```json
{
  "name": "agenticcoder",
  "workspaces": ["packages/*"],   // ← Bun resolves all 4 packages
  "scripts": {
    "dev:cli": "bun run --watch packages/cli/src/index.tsx",
    "dev:server": "bun run --hot packages/server/src/index.ts"
  }
}
```

- `"workspaces": ["packages/*"]` — tells Bun this is a monorepo. Each folder in `packages/` is a separate package that can import from each other using `workspace:*` dependencies.
- `dev:cli` uses `--watch` (restart on file change)
- `dev:server` uses `--hot` (hot module replacement, faster)

### Root `tsconfig.base.json`
```json
{
  "compilerOptions": {
    "lib": ["ESNext"],           // Use latest JS features
    "target": "ESNext",          // Compile to latest JS
    "module": "Preserve",        // Don't transform imports
    "moduleResolution": "bundler", // Bun-style resolution
    "strict": true,              // All strict checks ON
    "noUncheckedIndexedAccess": true,  // array[0] might be undefined
    "noImplicitOverride": true,  // Must use 'override' keyword
    "noEmit": true               // Bun runs TS directly, no compilation
  }
}
```

### Root `.env`
Single environment file at the project root. Both server and database packages read from here. Contains: `DATABASE_URL`, `API_URL`, `OPENROUTER_API_KEY`, Clerk keys, Polar keys.

### Package Dependency Graph
```
shared ◄─── server
  ▲            ▲
  │            │
  └──── cli ───┘
          │
          ▼
       database ◄── server
```

- `shared` depends on nothing (pure types/schemas)
- `database` depends on nothing (pure DB client)
- `server` depends on `shared` + `database`
- `cli` depends on `shared` + `database` + `server` (server is dev-only, for type inference)

---

## 4. Package: `shared`

**Purpose:** Types, schemas, and constants shared between server and CLI. This package has ZERO runtime dependencies on other packages — it's pure definitions.

### `packages/shared/src/index.ts` — Barrel Export
```typescript
export { SUPPORTED_CHAT_MODELS, DEFAULT_CHAT_MODEL_ID, findSupportedChatModel,
  type ModelPricing, type SupportedProvider, type SupportedChatModel, type SupportedChatModelId,
} from "./models";

export { Mode, modeSchema, toolInputSchemas, getToolContracts,
  type ToolContracts, type ModeType,
} from "./schemas";
```
This file re-exports everything from `models.ts` and `schemas.ts`. Other packages import like:
```typescript
import { Mode, toolInputSchemas, SUPPORTED_CHAT_MODELS } from "@agenticcoder/shared";
```

---

### `packages/shared/src/models.ts` — AI Model Definitions

**Every supported AI model is defined here.** The app uses OpenRouter as a unified gateway to multiple AI providers.

```typescript
export type ModelPricing = {
  inputUsdPerMillionTokens: number;   // Cost per 1M input tokens in USD
  outputUsdPerMillionTokens: number;  // Cost per 1M output tokens in USD
};
```
- Used by the billing system to calculate credits
- All current models have `0` pricing (free tier)

```typescript
export type SupportedProvider = "openrouter";  // Only provider currently
```

```typescript
type SupportedChatModelDefinition = {
  id: string;                    // OpenRouter model ID like "qwen/qwen3-coder:free"
  provider: SupportedProvider;   // Always "openrouter"
  pricing: ModelPricing;         // Cost info
};
```

```typescript
export const SUPPORTED_CHAT_MODELS = [
  { id: "qwen/qwen3-coder:free", provider: "openrouter", pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 } },
  { id: "nvidia/nemotron-3-ultra-550b-a55b:free", ... },
  // ... 15 models total
] as const satisfies readonly SupportedChatModelDefinition[];
```
- `as const` makes every string a literal type (not just `string`)
- `satisfies` validates the array matches the type WITHOUT widening it

```typescript
export type SupportedChatModel = (typeof SUPPORTED_CHAT_MODELS)[number];
// = { id: "qwen/qwen3-coder:free", provider: "openrouter", pricing: {...} } | { id: "nvidia/...", ... } | ...

export type SupportedChatModelId = SupportedChatModel["id"];
// = "qwen/qwen3-coder:free" | "nvidia/nemotron-3-ultra-550b-a55b:free" | ...
// This is a UNION of all model ID strings — not just `string`
```

```typescript
export function findSupportedChatModel(modelId: string) {
  return SUPPORTED_CHAT_MODELS.find((model) => model.id === modelId);
}
// Returns the full model definition or undefined

export const DEFAULT_CHAT_MODEL_ID: SupportedChatModelId = "qwen/qwen3-coder:free";
```

---

### `packages/shared/src/schemas.ts` — Tool Schemas + Mode Definitions

This is the **contract between server and client**. Every tool is defined here with its input schema (using Zod) and its description.

#### Mode Definition
```typescript
export const Mode = {
  BUILD: "BUILD",
  PLAN: "PLAN",
} as const;

export const modeSchema = z.enum([Mode.BUILD, Mode.PLAN]);
// Validates that a value is exactly "BUILD" or "PLAN"

export type ModeType = (typeof Mode)[keyof typeof Mode];
// = "BUILD" | "PLAN"
```

#### Tool Input Schemas
Every tool has a Zod schema that validates its input. The AI model generates these inputs.

```typescript
export const toolInputSchemas = {
  readFile: z.object({
    path: z.string().describe("Relative path to the file to read"),
  }),
  // The AI will call: readFile({ path: "src/index.ts" })

  listDirectory: z.object({
    path: z.string().default(".").describe("Relative directory path to list"),
  }),
  // default(".") means if AI doesn't pass path, it lists current directory

  glob: z.object({
    pattern: z.string().describe("Glob pattern to match files"),
    path: z.string().default(".").describe("Directory to search from"),
  }),

  grep: z.object({
    pattern: z.string().describe("Regex pattern to search for"),
    path: z.string().default(".").describe("Directory to search from"),
    include: z.string().optional().describe("Optional glob for files to include"),
  }),

  writeFile: z.object({
    path: z.string().describe("Relative path to write"),
    content: z.string().describe("File contents"),
  }),

  editFile: z.object({
    path: z.string().describe("Relative path to edit"),
    oldString: z.string().describe("Exact text to replace; must be unique"),
    newString: z.string().describe("Replacement text"),
  }),

  bash: z.object({
    command: z.string().describe("Shell command to run"),
    description: z.string().optional().describe("Short description of the command"),
    timeout: z.number().optional().describe("Timeout in milliseconds"),
  }),

  listCodeDefinitions: z.object({
    path: z.string().describe("Relative path to the source file to analyze"),
  }),

  gitStatus: z.object({}),  // No inputs needed

  gitDiff: z.object({
    ref: z.string().optional().describe("Git ref to diff against"),
    path: z.string().optional().describe("Limit diff to a specific file path"),
  }),

  gitLog: z.object({
    count: z.number().default(10).describe("Number of commits to show"),
    path: z.string().optional().describe("Limit history to a specific file"),
  }),

  fetchUrl: z.object({
    url: z.string().url().describe("The URL to fetch"),
  }),

  searchReplace: z.object({
    path: z.string().describe("Relative path to the file"),
    search: z.string().describe("Text or regex pattern to search for"),
    replace: z.string().describe("Replacement text"),
    isRegex: z.boolean().default(false).describe("Treat search as regex pattern"),
  }),

  thinkOut: z.object({
    thought: z.string().describe("Your internal reasoning or analysis"),
  }),

  fileInfo: z.object({
    path: z.string().describe("Relative path to the file"),
  }),

  gitBlame: z.object({
    path: z.string().describe("Relative path to the file"),
    startLine: z.number().optional().describe("Start line number"),
    endLine: z.number().optional().describe("End line number"),
  }),
} as const;
```

#### Tool Contracts
Tool contracts combine the schema with a description for the AI model:

```typescript
export const readOnlyToolContracts = {
  readFile: tool({
    description: "Read a file from the current project directory.",
    inputSchema: toolInputSchemas.readFile,
  }),
  // ... all read-only tools
} as const;
// These are available in PLAN mode

export const buildToolContracts = {
  ...readOnlyToolContracts,     // Includes all PLAN tools
  writeFile: tool({ ... }),      // Plus write tools
  editFile: tool({ ... }),
  bash: tool({ ... }),
  searchReplace: tool({ ... }),
} as const;
// These are available in BUILD mode
```

```typescript
export function getToolContracts(mode: ModeType) {
  return mode === Mode.PLAN ? readOnlyToolContracts : buildToolContracts;
}
```
- In PLAN mode: AI can only use read-only tools (12 tools)
- In BUILD mode: AI can use all tools (16 tools)

---

## 5. Package: `database`

**Purpose:** Prisma ORM setup for Neon PostgreSQL. Manages the `Session` table.

### `packages/database/prisma/schema.prisma` — Database Schema

```prisma
generator client {
  provider = "prisma-client"
  output   = "../generated/prisma"   // Generated client goes here
}

datasource db {
  provider = "postgresql"            // Neon is PostgreSQL-compatible
}

model Session {
  id        String   @id @default(cuid())   // Unique ID, auto-generated
  userId    String                           // Clerk user ID (who owns this)
  title     String                           // Session title (from first message)
  createdAt DateTime @default(now())         // Auto-set on creation
  updatedAt DateTime @updatedAt              // Auto-updated on every change
  messages  Json     @default("[]")          // All messages stored as JSON array
  @@index([userId])                          // Index for fast user-based queries
}
```

**Key insight:** Messages are stored as a single JSON column, not as separate rows. This is because:
1. AI SDK uses `UIMessage[]` format — storing the array as JSON preserves the exact structure
2. No need to JOIN — we always load all messages for a session at once
3. Simpler queries — `UPDATE session SET messages = $1` instead of complex INSERTs

### `packages/database/src/client.ts` — Database Connection

```typescript
import dotenv from "dotenv";
import path from "path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.ts";

// Load .env from project root (3 levels up from this file)
dotenv.config({
  path: path.resolve(import.meta.dirname, "../../../.env"),
});

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");

// PrismaPg adapter: connects Prisma to PostgreSQL via pg driver
// (needed for Neon's serverless driver)
const adapter = new PrismaPg({ connectionString: databaseUrl });

export const db = new PrismaClient({ adapter });
```

**Why PrismaPg adapter?** Standard Prisma uses its own query engine. Neon requires the `pg` driver adapter for serverless connections.

### `packages/database/src/index.ts` — Re-export Generated Types
```typescript
export * from "../generated/prisma/client.ts";
```
This exports the generated Prisma types (e.g., `Prisma`, `Session`) so other packages can import them:
```typescript
import type { Prisma } from "@agenticcoder/database";
```

---

## 6. Package: `server`

**Purpose:** Express HTTP API server. Handles authentication, chat streaming, session management, and billing. **Does NOT execute tools** — only relays AI messages.

### `packages/server/src/index.ts` — Server Entry Point

```typescript
import express from "express";
import * as Sentry from "@sentry/bun";
import { requireAuth } from "./middleware/require-auth";
import { rateLimit } from "./middleware/rate-limit";
import sessions from "./routes/sessions";
import chat from "./routes/chat";
import auth from "./routes/auth";
import billing from "./routes/billing";

// Sentry error tracking
Sentry.init({ dsn: "...", tracesSampleRate: 1.0 });

const app = express();

// Parse JSON bodies
app.use(express.json({ limit: "10mb" }));

// Global error handler
app.use((err, _req, res, _next) => {
  console.error("Unhandled server error", err);
  res.status(500).json({ error: "Internal server error" });
});

// Middleware — applied per route prefix
app.use("/sessions", requireAuth);       // All session routes need auth
app.use("/chat", requireAuth);           // All chat routes need auth
app.use("/chat", rateLimit);             // Chat also gets rate-limited
app.use("/billing/checkout", requireAuth);
app.use("/billing/portal", requireAuth);

// Mount route modules (Express Router)
app.use("/auth", auth);          // GET /auth/callback
app.use("/billing", billing);    // POST /billing/checkout, /billing/portal
app.use("/sessions", sessions);  // CRUD for sessions
app.use("/chat", chat);          // POST /chat (streaming)

app.listen(3000, () => {
  console.log("AgenticCoder server running on port 3000");
});

export default app;
```

---

### Server Middleware

#### `middleware/require-auth.ts` — Authentication Guard

```typescript
export type AuthenticatedEnv = {
  Variables: {
    userId: string;   // Available via c.get("userId") in route handlers
  };
};

export const requireAuth = createMiddleware<AuthenticatedEnv>(async (c, next) => {
  try {
    const auth = await authenticateOAuthRequest(c.req.raw);
    if (!auth) return c.json({ error: "Unauthorized. Run /login to continue." }, 401);
    c.set("userId", auth.userId);  // Store userId for downstream handlers
    await next();
  } catch {
    return c.json({ error: "Unauthorized. Run /login to continue." }, 401);
  }
});
```

**How it works:**
1. Extracts the `Authorization: Bearer <token>` header from the request
2. Converts Express request to Web Fetch Request for Clerk's SDK
3. Validates the token with Clerk's backend SDK
4. Extracts the `userId` from the token
5. Stores it on the request object (`(req as AuthenticatedRequest).userId`)
6. All downstream route handlers can access `req.userId`

#### `middleware/rate-limit.ts` — Rate Limiting

```typescript
const WINDOW_MS = 60_000;    // 1 minute window
const MAX_REQUESTS = 20;      // 20 requests per minute per user

type WindowEntry = { count: number; resetAt: number; };
const windows = new Map<string, WindowEntry>();  // In-memory store

// Cleanup stale entries every 5 minutes (prevents memory leak)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of windows) {
    if (now > entry.resetAt) windows.delete(key);
  }
}, 5 * 60_000);
```

**Algorithm:** Sliding window counter per userId.
1. Look up user's current window entry
2. If window expired or doesn't exist, create new one
3. Increment counter
4. If counter > 20, return 429 with `Retry-After` header
5. Otherwise, proceed

**Limitation:** In-memory only. Resets on server restart. For production, use Redis.

#### `middleware/require-credits-balance.ts` — Billing Guard

```typescript
export const requireCreditsBalance = createMiddleware<AuthenticatedEnv>(async (c, next) => {
  const userId = c.get("userId");
  const creditsBalance = await getAvailableCreditsBalance(userId);
  if (creditsBalance <= 0) {
    return c.json({ error: "No credits remaining. Run /upgrade to buy more credits." }, 402);
  }
  await next();
});
```
Checks Polar's API for the user's credit balance before allowing the request. Returns HTTP 402 (Payment Required) if empty.

---

### Server Routes

#### `routes/chat.ts` — The Core: AI Chat Streaming

This is the heart of the entire application. Let's go line by line.

```typescript
type ChatMessageMetadata = {
  mode?: ModeType;              // "BUILD" or "PLAN"
  model?: string;               // Model ID used for this message
  durationMs?: number;          // How long the AI took to respond
  usage?: LanguageModelUsage;   // Token counts { inputTokens, outputTokens }
};
```
Every message carries metadata. The CLI uses `durationMs` and `usage` to show stats in the UI.

```typescript
type agenticcoderUIMessage = UIMessage<ChatMessageMetadata, never, InferUITools<ToolContracts>>;
```
This is a **generic type** from Vercel AI SDK:
- `ChatMessageMetadata` = custom metadata on each message
- `never` = no custom data types (unused)
- `InferUITools<ToolContracts>` = TypeScript infers all tool input/output types from our schemas

```typescript
const submitSchema = z.object({
  id: z.string(),                    // Session ID
  messages: z.array(z.custom<...>()) // Array of UI messages
    .min(1),                         // At least 1 message
  mode: modeSchema,                  // "BUILD" or "PLAN"
  model: z.string()
    .refine(isSupportedChatModel, "Unsupported model"),  // Must be a valid model ID
});
```

**The chat endpoint flow:**

```
POST /chat
  ├─ Validate request body (Zod)
  ├─ Find session in database
  ├─ Merge incoming messages with stored messages
  ├─ Filter out corrupted messages
  ├─ Trim to last 50 messages (context window management)
  ├─ Validate messages against tool schemas
  ├─ Convert to model format
  ├─ Create AbortController (120s timeout)
  ├─ Call streamText() with AI model
  │   ├─ System prompt (mode-specific)
  │   ├─ All tool contracts
  │   ├─ maxSteps: 25 (tool call loop limit)
  │   ├─ maxTokens: 16384
  │   ├─ temperature: 0 (deterministic)
  │   └─ toolCallStreaming: true
  ├─ Return streaming response
  └─ onFinish: Save messages to DB + bill usage
```

**Context window trimming (critical for long conversations):**
```typescript
const MAX_CONTEXT_MESSAGES = 50;
if (validMessages.length > MAX_CONTEXT_MESSAGES) {
  const first = validMessages[0];                    // Keep first message for context
  const latest = validMessages.slice(-MAX_CONTEXT_MESSAGES + 1);  // Keep latest 49
  trimmedMessages = first ? [first, ...latest] : latest;
}
```
Without this, long conversations would exceed the model's context window and crash.

**Save on abort (prevents data loss):**
```typescript
if (event.isAborted) {
  // User pressed Esc — still save what we have
  await db.session.update({
    where: { id, userId },
    data: { messages: event.messages as unknown as Prisma.InputJsonValue },
  });
  return;
}
```

**Billing skip for free models:**
```typescript
const pricing = findSupportedChatModel(resolvedModel.modelId)?.pricing;
if (pricing && pricing.inputUsdPerMillionTokens === 0 && pricing.outputUsdPerMillionTokens === 0) {
  return;  // Don't bill for free models
}
```

#### `routes/sessions.ts` — Session CRUD

| Method | Path | Description |
|--------|------|-------------|
| `GET /sessions` | List all user's sessions (ordered by updatedAt DESC) |
| `GET /sessions/:id` | Get a single session with all messages |
| `POST /sessions` | Create a new session |
| `DELETE /sessions/:id` | Delete a session |
| `PATCH /sessions/:id` | Rename a session |

#### `routes/auth.ts` — OAuth Callback Relay

```typescript
app.get("/callback", (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");

  // Decode the state to find the CLI's local port
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString());
  const port = payload.port;

  // Redirect to CLI's local callback server
  return c.redirect(`http://localhost:${port}/callback?code=${code}&state=${state}`);
});
```

**Why this relay?** Clerk OAuth redirects to a fixed URL (our server). But the CLI runs a temporary local HTTP server on a random port. The server extracts the port from the OAuth state and redirects to the CLI.

#### `routes/billing.ts` — Polar Integration

```typescript
app.post("/checkout", async (c) => {
  const url = await createCheckoutUrl({ customerExternalId: userId, requestUrl: c.req.url });
  return c.json({ url });  // CLI opens this URL in browser
});

app.post("/portal", async (c) => {
  const url = await createCustomerPortalUrl({ ... });
  return c.json({ url });
});

app.get("/success", (c) => c.text("Done. You can close this tab."));
```

---

### Server Libraries

#### `lib/auth.ts` — Clerk Backend Integration

```typescript
const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
  publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
});

export async function authenticateOAuthRequest(request: Request) {
  const requestState = await clerkClient.authenticateRequest(request, {
    acceptsToken: "oauth_token",   // We use OAuth tokens, not session tokens
  });
  if (!requestState.isAuthenticated) return null;
  const auth = requestState.toAuth();
  if (auth.tokenType !== "oauth_token" || !auth.userId) return null;
  return { userId: auth.userId };
}
```

#### `lib/models.ts` — OpenRouter Model Resolution

```typescript
const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

export function resolveChatModel(modelId: string): ResolvedModel {
  const model = findSupportedChatModel(modelId);
  if (!model) throw new Error(`Unsupported model: ${modelId}`);
  return {
    model: openrouter.chat(model.id),   // AI SDK LanguageModel instance
    provider: "openrouter",
    modelId: model.id,
  };
}
```

`openrouter.chat(model.id)` creates a `LanguageModel` object that Vercel AI SDK's `streamText()` uses. OpenRouter is a unified gateway — one API key accesses models from Google, Nvidia, Meta, etc.

#### `lib/credits.ts` — Usage Billing Calculation

```typescript
const TOKENS_PER_MILLION = 1_000_000;
const USD_PER_CREDIT = 0.001;  // 1 credit = $0.001

function estimateCostUsd(tokens: TokenCounts, pricing: ModelPricing) {
  return (
    (tokens.inputTokens * pricing.inputUsdPerMillionTokens +
     tokens.outputTokens * pricing.outputUsdPerMillionTokens) /
    TOKENS_PER_MILLION
  );
}

function convertUsdToCredits(costUsd: number) {
  if (costUsd <= 0) return 0;
  return Math.max(1, Math.ceil(costUsd / USD_PER_CREDIT));
  // Always charge at least 1 credit for any non-zero usage
}
```

#### `lib/polar.ts` — Polar Billing SDK

Polar is used for:
1. **Checkout** — Creating payment URLs for buying credits
2. **Customer Portal** — Managing subscriptions
3. **Credit Balance** — Checking how many credits a user has
4. **Usage Ingestion** — Recording AI usage events (deducting credits)

```typescript
export async function ingestAiUsage({ externalCustomerId, eventId, credits }: IngestAiUsageParams) {
  if (credits <= 0) return;
  await polar.events.ingest({
    events: [{
      name: "agenticcoder_usage",
      externalId: eventId,           // Unique per message (prevents double-billing)
      externalCustomerId,            // Clerk userId
      metadata: { credits },
    }],
  });
}
```

---

### `system-prompts.ts` — AI System Prompt Engineering

The system prompt is dynamically built based on the mode:

```typescript
export function buildSystemPrompt({ mode, projectContext }: SystemPromptParams): string {
  const parts: string[] = [];

  // 1. Core identity
  parts.push(`You are an expert software engineer...`);

  // 2. Core principles (always included)
  // - Understand before acting
  // - Minimal, precise edits
  // - Verify your work
  // - Explain your reasoning
  // - Be proactive

  // 3. Project context (if available)
  if (projectContext) parts.push(`## Project Context\n${projectContext}`);

  // 4. Mode-specific instructions
  if (mode === "PLAN") {
    parts.push(`## Mode: PLAN\nYou are in planning mode...`);
    // Lists read-only tools with descriptions
    // Includes workflow strategy for PLAN mode
  } else {
    parts.push(`## Mode: BUILD\nYou are in build mode...`);
    // Lists all tools including write tools
    // Includes workflow strategy for BUILD mode
    // Includes error recovery instructions
  }

  return parts.join("\n");
}
```

**Why mode-specific prompts?** In PLAN mode, the AI shouldn't try to write files. The prompt reinforces this. In BUILD mode, the prompt includes error recovery strategies (e.g., "if editFile fails, re-read the file").

---

## 7. Package: `cli`

**Purpose:** Terminal UI application using React + @opentui. This is what the user sees and interacts with.

### Entry Point: `src/index.tsx`

```typescript
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { createMemoryRouter, RouterProvider } from "react-router";

const router = createMemoryRouter([
  {
    path: "/",
    element: <RootLayout />,       // Wraps all pages with providers
    children: [
      { index: true, element: <Home /> },              // Landing page
      { path: "sessions/new", element: <NewSession /> }, // Create session
      { path: "sessions/:id", element: <Session /> },    // Chat session
    ]
  }
]);

const renderer = await createCliRenderer({
  targetFps: 60,          // 60fps terminal rendering
  exitOnCtrlC: false,     // We handle Ctrl+C ourselves
});

createRoot(renderer).render(<App />);
```

**@opentui** is a React renderer for terminals (like Ink). It renders React components to terminal UI using ANSI escape codes. `<box>`, `<text>`, `<textarea>` etc. are terminal-native elements.

**react-router** is used for navigation:
- `/` → Home screen (header + input)
- `/sessions/new` → Creates session on server, then navigates to it
- `/sessions/:id` → Chat session (messages + input)

---

### Layout: `layouts/root-layout.tsx`

```typescript
export function RootLayout() {
  return (
    <ThemeProvider>           {/* Color theme context */}
      <ToastProvider>         {/* Toast notifications */}
        <KeyboardLayerProvider> {/* Keyboard focus management */}
          <DialogProvider>     {/* Modal dialog system */}
            <PromptConfigProvider> {/* Mode + model state */}
              <ThemedRoot>     {/* Applies bg color from theme */}
                <Outlet />     {/* Renders matched route */}
              </ThemedRoot>
            </PromptConfigProvider>
          </DialogProvider>
        </KeyboardLayerProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
```

Each provider wraps the app and provides context:

| Provider | Context Value | Purpose |
|----------|--------------|---------|
| `ThemeProvider` | `colors` object | Dark/light mode, color tokens |
| `ToastProvider` | `toast.show()` | Show temporary notifications |
| `KeyboardLayerProvider` | `push/pop/isTopLayer` | Manages which component gets keyboard input |
| `DialogProvider` | `dialog.open/close` | Modal dialogs (models, agents, sessions, theme) |
| `PromptConfigProvider` | `mode, model, setMode, setModel, toggleMode` | Current AI mode and model |

---

### Screens

#### `screens/home.tsx` — Landing Page
Shows the ASCII header, input bar, and keyboard hints (`tab agents · / commands · @ files`). When user submits text, navigates to `/sessions/new` with the message.

#### `screens/new-session.tsx` — Session Creator
1. Calls `POST /sessions` to create a new session on the server
2. On success, navigates to `/sessions/:id` with the initial message
3. Shows loading spinner while creating

#### `screens/session.tsx` — Chat Session
```typescript
function SessionChat({ session, initialPrompt }) {
  const { messages, status, submit, abort, interrupt, error } = useChat(
    session.id,
    initialMessages
  );

  // Auto-submit initial prompt on mount
  useEffect(() => {
    if (initialPrompt && !hasSubmittedRef.current) {
      hasSubmittedRef.current = true;
      submit({ userText: initialPrompt.message, mode: initialPrompt.mode, model: initialPrompt.model });
    }
  }, []);

  // Esc to interrupt streaming
  useKeyboard((key) => {
    if (key.name === "escape" && status === "streaming") {
      interrupt();
    }
  });

  return (
    <SessionShell onSubmit={(text) => submit({ userText: text, mode, model })} loading={status === "streaming"}>
      {messages.map((msg) => <ChatMessage key={msg.id} msg={msg} />)}
      {error && <ErrorMessage message={error.message} />}
    </SessionShell>
  );
}
```

---

### Components

#### `components/Header.tsx`
ASCII art "Agentic coder" logo with tagline.

#### `components/status-bar.tsx`
Shows `ProjectName › Plan/Build › model-name` at the bottom of the input bar.

#### `components/session-shell.tsx`
Layout wrapper for chat sessions:
- Scrollable message area (sticky scroll = auto-scroll to bottom)
- Input bar at bottom
- Footer with spinner (during streaming) and keyboard hints

#### `components/Input-bar.tsx` (611 lines)
The most complex component. Features:
1. **Text input** — Multiline textarea with Enter=submit, Shift+Enter=newline
2. **Command menu** — Type `/` to see commands, filtered by query
3. **File mention picker** — Type `@` to browse files, with recursive search
4. **Mode toggle** — Tab key switches Plan/Build

**File mention system:**
- User types `@src/` → lists files in `src/` directory
- Filters by typed prefix
- If no direct matches, recursively searches subdirectories
- Skips `node_modules` and hidden directories
- Max 32 fallback candidates
- 8 visible items in the picker (scrollable)

#### `components/messages/user-message.tsx`
Shows user's message with a colored left border (green for Build, blue for Plan) and timestamp.

#### `components/messages/bot-message.tsx`
Renders AI response parts:
- **Text parts** → Rendered as markdown
- **Tool call parts** → Shows tool name + status icon (`⠋` pending, `✓` done, `✗` failed)
- **Footer** → Duration (e.g. "2.1s") + token usage (e.g. "1.2k↑ 856↓")

#### `components/messages/error-message.tsx`
Categorizes errors with icons and recovery hints:
- Rate limit (⏱) → "Wait a moment and try again"
- Timeout (⌛) → "The request took too long"
- Network (🔌) → "Check your internet connection"
- Auth (🔒) → "Try /login to re-authenticate"

#### `components/command-menu/Commands.tsx`
Defines all 13 slash commands:
- `/new`, `/clear`, `/help`, `/status` — Navigation/info
- `/agents`, `/models`, `/sessions`, `/theme` — Dialogs
- `/login`, `/logout` — Authentication
- `/upgrade`, `/usage` — Billing
- `/exit` — Quit

#### `components/dialogs/`
- **agents-dialog.tsx** — Pick Build/Plan mode with descriptions
- **models-dialog.tsx** — Pick AI model (shows provider + current selection)
- **sessions-dialog.tsx** — Browse/delete past sessions
- **theme-dialog.tsx** — Switch color themes

---

### Hooks

#### `hooks/use-chat.ts` — The Chat Engine

This is the **bridge between CLI and server**. It manages the entire chat lifecycle.

```typescript
export function useChat(sessionId: string, initialMessages: Message[]) {
  // 1. Create transport — tells AI SDK how to send messages to our server
  const transport = new DefaultChatTransport<Message>({
    api: apiClient.chat.$url().toString(),  // "http://localhost:3000/chat"
    headers() {
      const auth = getAuth();
      return auth ? { Authorization: `Bearer ${auth.token}` } : new Headers();
    },
    prepareSendMessagesRequest({ messages }) {
      // Only send the latest 1-2 messages (not the entire history)
      // Server already has the full history stored in DB
      const message = messages[messages.length - 1];
      return {
        body: {
          id: sessionId,
          messages: requestMessages,  // Latest user + assistant message only
          mode: message.metadata?.mode,
          model: message.metadata?.model,
        },
      };
    }
  });

  // 2. Use AI SDK's useChat hook
  const chat = useAiChat<Message>({
    id: sessionId,
    messages: initialMessages,
    transport,
    // 3. Tool call handler — THIS IS WHERE TOOLS EXECUTE
    async onToolCall({ toolCall }) {
      const MAX_RETRIES = 1;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const output = await executeLocalTool(toolCall.toolName, toolCall.input, mode);
          chat.addToolOutput({ tool: toolCall.toolName, toolCallId: toolCall.toolCallId, output });
          return;
        } catch (error) {
          if (attempt === MAX_RETRIES) {
            chat.addToolOutput({ ..., state: "output-error", errorText: error.message });
          }
          // Otherwise retry silently
        }
      }
    },
    // 4. Auto-send tool results back to server
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
  });

  return { messages, status, submit, abort, interrupt };
}
```

**The tool call loop:**
1. Server streams AI response with tool calls
2. `onToolCall` fires for each tool call
3. `executeLocalTool()` runs the tool on the client machine
4. `addToolOutput()` attaches the result to the message
5. `sendAutomaticallyWhen` detects all tools are done
6. Automatically sends results back to the server
7. Server continues the AI conversation (up to 25 steps)

---

### Client Libraries

#### `lib/config.ts` — Centralized Configuration
```typescript
export const config = {
  apiUrl: (process.env.API_URL ?? "http://localhost:3000").replace(/\/+$/, ""),
} as const;
```
Single source of truth for the backend URL. Both `api-client.ts` and `oauth.ts` import from here.

#### `lib/api-client.ts` — Typed HTTP Client
```typescript
export const apiClient = hc<AppType>(config.apiUrl, {
  fetch: async (input, init) => {
    const headers = new Headers(init?.headers);
    const auth = getAuth();
    if (auth) headers.set("Authorization", `Bearer ${auth.token}`);
    const response = await fetch(input, { ...init, headers });
    if (response.status === 401) clearAuth();  // Auto-logout on 401
    return response;
  }
});
```

The API client is a plain `fetch` wrapper that provides a convenient interface for calling server endpoints:
```typescript
apiClient.sessions.$get()                         // → GET /sessions
apiClient.sessions[":id"].$get({param: {id}})     // → GET /sessions/:id
apiClient.sessions[":id"].$delete({param: {id}})  // → DELETE /sessions/:id
apiClient.chat.$post({json: body})                // → POST /chat
apiClient.billing.checkout.$post()                // → POST /billing/checkout
```

#### `lib/auth.ts` — Token Storage
Stores the OAuth token in `~/.agenticcoder/auth.json` with restrictive file permissions (`0o600` = owner read/write only).

#### `lib/oauth.ts` — OAuth PKCE Login Flow
See [Authentication Flow](#10-authentication-flow) for details.

#### `lib/local-tools.ts` — Tool Execution Engine (550 lines)
See [Tool Execution Deep Dive](#9-tool-execution-deep-dive) for details.

#### `lib/http-errors.ts` — Error Message Extraction
```typescript
export async function getErrorMessage(response: ErrorResponse) {
  const data = (await response.json()) as { error?: string };
  if (typeof data.error === "string") return data.error;
  return response.statusText || `Request failed with status ${response.status}`;
}
```
Tries to extract the `error` field from JSON response body, falls back to status text.

#### `lib/upgrade.ts` — Billing Helpers
```typescript
export async function openUpgradeCheckout() {
  const response = await apiClient.billing.checkout.$post();
  const data = await response.json();
  await open(data.url);  // Opens Polar checkout in browser
}
```

---

## 8. Complete Data Flow

### Flow 1: User Sends a Message

```
User types "Fix the bug" → Enter
    │
    ▼
InputBar.onSubmit("Fix the bug")
    │
    ▼
SessionChat.submit({ userText: "Fix the bug", mode: "BUILD", model: "qwen/qwen3-coder:free" })
    │
    ▼
useChat.sendMessage({ text: "Fix the bug", metadata: { mode: "BUILD", model: "qwen/..." } })
    │
    ▼
DefaultChatTransport.prepareSendMessagesRequest()
  → Creates request body: { id: sessionId, messages: [userMessage], mode: "BUILD", model: "qwen/..." }
    │
    ▼
POST http://localhost:3000/chat
  Headers: { Authorization: "Bearer <clerk-oauth-token>" }
  Body: { id, messages, mode, model }
    │
    ▼ (Server)
requireAuth middleware
  → Validates token with Clerk → sets userId
    │
    ▼
rateLimit middleware
  → Checks user hasn't exceeded 20 req/min
    │
    ▼
submitValidator
  → Validates request body with Zod schema
    │
    ▼
Chat route handler
  → Loads session from DB
  → Merges incoming messages with stored messages
  → Trims to 50 messages (context window)
  → Builds system prompt for BUILD mode
  → Calls streamText({ model, system, messages, tools, maxSteps: 25 })
    │
    ▼ (OpenRouter)
AI model generates response (text + tool calls)
    │
    ▼ (Streaming back to CLI)
toUIMessageStreamResponse() streams parts to client
    │
    ▼ (CLI receives stream)
useAiChat processes stream:
  → Text parts → rendered in BotMessage
  → Tool call parts → onToolCall fires
    │
    ▼
executeLocalTool("readFile", { path: "src/auth.ts" }, "BUILD")
  → Reads file from user's machine
  → Returns file contents
    │
    ▼
addToolOutput({ output: fileContents })
    │
    ▼
sendAutomaticallyWhen detects tool output → re-sends to server
    │
    ▼ (Loop continues up to 25 steps)
    │
    ▼ (When AI is done)
Server onFinish:
  → Saves all messages to DB
  → Calculates credits
  → Bills via Polar (if not free model)
```

### Flow 2: Session Creation

```
User types message on Home screen → Enter
    │
    ▼
Home.handleSubmit("Fix the bug")
    │
    ▼
navigate("/sessions/new", { state: { message: "Fix the bug", mode: "BUILD", model: "qwen/..." } })
    │
    ▼
NewSession component mounts
  → POST /sessions { title: "Fix the bug" }
  → Server creates Session row in Neon DB
  → Returns { id: "clxyz...", title: "Fix the bug", ... }
    │
    ▼
navigate(`/sessions/clxyz...`, { state: { session, initialPrompt } })
    │
    ▼
Session component mounts
  → Renders SessionChat with session data
  → useEffect auto-submits initial prompt
  → Chat flow begins (see Flow 1)
```

---

## 9. Tool Execution Deep Dive

### Architecture

```typescript
export const executeLocalTool = async (
  toolName: string,
  input: Record<string, unknown>,
  mode: ModeType,
): Promise<unknown> => {
  // 1. Security: Block write tools in PLAN mode
  if (mode === Mode.PLAN && !PLAN_TOOLS.includes(toolName)) {
    throw new Error(`Tool "${toolName}" is not available in Plan mode`);
  }

  // 2. Dispatch to tool implementation
  switch (toolName) {
    case "readFile": { ... }
    case "writeFile": { ... }
    // ... 16 tools
  }
};
```

### Security Measures

1. **Path traversal protection:**
```typescript
function resolveInsideCwd(path: string) {
  const cwd = process.cwd();
  const resolved = resolve(cwd, path);
  const rel = relative(cwd, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Path is outside the project directory");
  }
  return { cwd, resolved };
}
```
Every file operation passes through this. The AI cannot access files outside the project directory.

2. **SSRF protection (fetchUrl):**
```typescript
const BLOCKED_HOSTS = ["localhost", "127.0.0.1", "0.0.0.0", "::1", "metadata.google.internal", "169.254.169.254"];
```
Blocks access to internal IPs and cloud metadata endpoints.

3. **Output truncation:**
```typescript
const MAX_FILE_SIZE = 10_000;   // 10k chars max for readFile
const MAX_OUTPUT = 20_000;      // 20k chars max for bash output
const MAX_MATCHES = 50;         // 50 results max for grep
```

### Tool Implementations (All 16)

| Tool | Mode | What It Does | Key Implementation Detail |
|------|------|-------------|--------------------------|
| `readFile` | PLAN+BUILD | Read file contents | Truncates at 10k chars, adds line numbers |
| `listDirectory` | PLAN+BUILD | List directory entries | Hides `.git`, `node_modules`, sorts dirs first |
| `glob` | PLAN+BUILD | Find files by pattern | Pure JS recursive walker, no system `find` |
| `grep` | PLAN+BUILD | Search file contents | Pure JS (not system `grep`), cross-platform |
| `listCodeDefinitions` | PLAN+BUILD | Extract symbols from code | Regex-based parser for TS/JS/Python/Go/Rust |
| `writeFile` | BUILD only | Create/overwrite file | Auto-creates parent directories via `mkdir -p` |
| `editFile` | BUILD only | Replace text in file | `oldString` must be unique; verifies uniqueness |
| `searchReplace` | BUILD only | Multi-replace in file | Supports regex mode; returns replacement count |
| `bash` | BUILD only | Run shell command | Uses PowerShell on Windows, bash on Unix |
| `gitStatus` | PLAN+BUILD | Show git status | Structured JSON output (staged/unstaged/untracked) |
| `gitDiff` | PLAN+BUILD | Show diff | Includes `--stat` for file change summary |
| `gitLog` | PLAN+BUILD | Show commit history | Structured JSON with hash, author, date, message |
| `gitBlame` | PLAN+BUILD | Per-line blame | Parses porcelain format into structured entries |
| `fetchUrl` | PLAN+BUILD | Fetch URL content | 10s timeout, 1MB limit, SSRF protection |
| `thinkOut` | PLAN+BUILD | Reasoning scratchpad | Returns thought as-is (no action taken) |
| `fileInfo` | PLAN+BUILD | File metadata | Size, type, modified date, permissions |

### `listCodeDefinitions` — How It Parses Code

```typescript
const PATTERNS: Record<string, RegExp[]> = {
  ".ts": [
    /^export\s+(?:async\s+)?function\s+(\w+)/,    // export function foo()
    /^export\s+(?:const|let|var)\s+(\w+)/,         // export const bar
    /^export\s+(?:interface|type)\s+(\w+)/,        // export type Baz
    /^export\s+class\s+(\w+)/,                     // export class Qux
    /^export\s+enum\s+(\w+)/,                      // export enum Status
    /^(?:const|let|var)\s+(\w+)\s*=/,              // const local = ...
    /^(?:async\s+)?function\s+(\w+)/,              // function helper()
    /^class\s+(\w+)/,                              // class Internal
    /^interface\s+(\w+)/,                          // interface Props
    /^type\s+(\w+)/,                               // type Config
    /^enum\s+(\w+)/,                               // enum Direction
  ],
  ".py": [
    /^def\s+(\w+)/,       // def function_name
    /^class\s+(\w+)/,     // class ClassName
    /^(\w+)\s*=/,         // CONSTANT = value
  ],
  // .go, .rs patterns too
};
```

### `bash` — Cross-Platform Shell Execution

```typescript
case "bash": {
  const { command, timeout } = toolInputSchemas.bash.parse(input);
  const effectiveTimeout = Math.min(timeout ?? DEFAULT_TIMEOUT, 120_000);

  const shell = IS_WINDOWS ? "powershell.exe" : "bash";
  const args = IS_WINDOWS ? ["-NoProfile", "-Command", command] : ["-c", command];

  const proc = Bun.spawn([shell, ...args], {
    cwd,
    env: { ...process.env, TERM: "dumb" },
    stdout: "pipe", stderr: "pipe",
    timeout: effectiveTimeout,
  });
  // ... captures stdout/stderr, truncates output
}
```

On Windows, `bash` commands run via PowerShell. On Linux/Mac, they run via bash.

---

## 10. Authentication Flow

AgenticCoder uses **OAuth 2.0 PKCE** (Proof Key for Code Exchange) with Clerk.

```
Step 1: User types /login in CLI
    │
    ▼
Step 2: CLI generates:
  - codeVerifier (random 32 bytes)
  - codeChallenge (SHA-256 hash of codeVerifier)
  - nonce (random UUID)
  - state (base64url JSON with { nonce, port })
    │
    ▼
Step 3: CLI starts temporary HTTP server on random port (e.g., 54321)
    │
    ▼
Step 4: CLI opens browser to Clerk authorization URL:
  https://your-app.clerk.accounts.dev/authorize?
    client_id=INlEqcxoaanj1CEX
    &redirect_uri=http://localhost:3000/auth/callback  ← Server URL
    &response_type=code
    &scope=openid profile email
    &state=eyJub25jZSI6Li4uLCJwb3J0Ijo1NDMyMX0=  ← Contains port 54321
    &code_challenge=<sha256-hash>
    &code_challenge_method=S256
    │
    ▼
Step 5: User signs in with Clerk (Google/GitHub/email)
    │
    ▼
Step 6: Clerk redirects to server:
  http://localhost:3000/auth/callback?code=abc123&state=eyJ...
    │
    ▼
Step 7: Server's auth route decodes state, extracts port=54321
  → Redirects to http://localhost:54321/callback?code=abc123&state=eyJ...
    │
    ▼
Step 8: CLI's temporary server receives the callback
  → Validates nonce matches
  → Exchanges code for token via Clerk's token endpoint:
    POST https://your-app.clerk.accounts.dev/oauth/token
    { grant_type: "authorization_code", code: "abc123", code_verifier: "..." }
    │
    ▼
Step 9: Clerk returns access_token
  → CLI saves token to ~/.agenticcoder/auth.json
  → CLI shows "Signed in" toast
  → Temporary server shuts down
    │
    ▼
Step 10: All subsequent API calls include:
  Authorization: Bearer <access_token>
```

---

## 11. Billing Flow

```
User types /upgrade
    │
    ▼
CLI calls POST /billing/checkout
    │
    ▼
Server creates Polar checkout URL
    │
    ▼
CLI opens URL in browser
    │
    ▼
User completes payment on Polar
    │
    ▼
Polar credits the user's meter
    │
    ▼
On next chat message:
  requireCreditsBalance middleware checks Polar → balance > 0 → allowed
    │
    ▼
After AI response:
  calculateCreditsForUsage() converts tokens → USD → credits
  ingestAiUsage() reports usage to Polar (deducts credits)
```

---

## 12. Environment Variables

| Variable | Required | Used By | Purpose |
|----------|----------|---------|---------|
| `DATABASE_URL` | ✅ | database | PostgreSQL connection string for Neon |
| `API_URL` | ❌ | cli | Backend URL (default: `http://localhost:3000`) |
| `OPENROUTER_API_KEY` | ✅ | server | OpenRouter API key for AI models |
| `CLERK_FRONTEND_API` | ✅ | cli | Clerk frontend API URL for OAuth |
| `CLERK_PUBLISHABLE_KEY` | ✅ | server | Clerk public key |
| `CLERK_SECRET_KEY` | ✅ | server | Clerk secret key for token validation |
| `CLERK_OAUTH_CLIENT_ID` | ✅ | cli | OAuth client ID |
| `CLERK_OAUTH_CLIENT_SECRET` | ✅ | cli | OAuth client secret |
| `JWT_SECRET` | ❌ | — | Currently unused (reserved) |
| `POLAR_ACCESS_TOKEN` | ✅ | server | Polar SDK auth token |
| `POLAR_PRODUCT_ID` | ✅ | server | Polar product for checkout |
| `POLAR_CREDITS_METER_ID` | ✅ | server | Polar meter ID for credit tracking |
| `POLAR_SERVER` | ❌ | server | `"sandbox"` or `"production"` (default: sandbox) |

---

## Summary

AgenticCoder is a **4-package monorepo** where:

- **`shared`** defines the contract (tool schemas, model definitions, token counter, types)
- **`database`** stores sessions and messages in Neon PostgreSQL via Prisma
- **`server`** orchestrates AI conversations with token-aware context management, authentication, and billing (Express + AI SDK + Clerk + Polar)
- **`cli`** renders the terminal UI and executes all 16+ tools locally with auto-lint self-healing, conversation memory, streaming metrics, plugins, skills, file watching, and rich diffs (React + @opentui)

The AI never touches your files directly. The server acts as a relay between you and the AI model. Tool calls flow: **Server → CLI → Your Files → Auto-Lint → CLI → Server → AI → repeat (up to 25 steps)**.

---

## 13. Advanced: Token-Aware Context Management

### The Problem

LLMs have fixed context windows (8K–128K tokens). Long conversations exceed this limit, causing truncation or API errors. A naive approach (keep latest N messages) loses critical context like error messages and original user intent.

### The Solution

AgenticCoder uses a **priority-based context manager** that intelligently allocates token budget and selectively keeps the most important messages.

### File: `packages/shared/src/token-counter.ts`

**Token estimation** — fast, dependency-free, O(1):

```typescript
const CHARS_PER_TOKEN = 3.5; // Conservative estimate for code

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
```

**Why not tiktoken?** Tiktoken requires a 4MB WASM binary and is 100x slower. For budget allocation (not billing), character-based estimation is accurate enough (within ~15% of exact count) and has zero dependencies.

**Token budget allocation:**

```
getTokenBudget(32768) → {
  systemPromptBudget:    4915  (15%) — system instructions
  projectContextBudget:  3276  (10%) — AGENT.md + project context
  historyBudget:        18022  (55%) — conversation messages
  reserveTokens:         6553  (20%) — AI response generation
}
```

### File: `packages/server/src/lib/context-manager.ts`

**Priority scoring** — each message gets a priority score:

| Message Type | Score | Rationale |
|-------------|-------|----------|
| Error tool results | +50 | Prevent repeating mistakes |
| User messages | +30 | Contains instructions |
| Write tool results (writeFile, editFile) | +25 | Shows what was changed |
| Long text content | +1-20 | More context = more useful |
| Assistant messages | +10 | Base value |

**Trimming strategy:**
1. Always keep the first message (original context)
2. Always keep the last 6 messages (recency)
3. Score all middle messages by priority
4. Fill remaining budget with highest-priority middle messages
5. Generate a summary of dropped messages and inject it as context

**Integration in `chat.ts`:**

```typescript
const contextResult = manageContext(
  validMessages,
  systemTokens,      // tokens used by system prompt
  projectTokens,     // tokens used by project context
  32768,             // model context size
);
// contextResult.messages     → trimmed messages
// contextResult.trimmedCount → how many were dropped
// contextResult.summary      → summary of dropped messages
// contextResult.totalTokens  → total tokens used
```

### Design Decisions for Interview Discussion

1. **Why char-based estimation?** Speed (O(1) vs O(n) for BPE), zero deps, sufficient for budget allocation
2. **Why not just keep latest N?** Loses critical error context and original user intent
3. **Why 55% for history?** Leaves enough room for system prompt, project context, and AI response
4. **Why summarize dropped messages?** The AI needs to know what happened previously, even if the full messages are trimmed

---

## 14. Advanced: Conversation Memory (RAG)

### The Problem

Each chat session is isolated. The AI doesn't remember that you prefer tabs over spaces, that your project uses Prisma, or that you corrected it about a specific pattern last week.

### The Solution

A lightweight **RAG (Retrieval-Augmented Generation)** system that extracts learnings from conversations and retrieves relevant ones for new sessions.

### File: `packages/cli/src/lib/memory.ts`

**Storage:** `~/.agenticcoder/memory.jsonl` — append-only log (no database needed)

**Memory types:**

| Type | Trigger Pattern | Example |
|------|----------------|--------|
| `preference` | "I prefer...", "always use...", "don't use..." | "User prefers const over let" |
| `correction` | "no, that's wrong", "not like that" | "Don't use var in TypeScript" |
| `project-info` | Detected from AI responses | "Project uses Prisma + PostgreSQL" |
| `fact` | Explicit saves | "API endpoint is /v2/users" |
| `pattern` | Repeated behaviors | "User always runs tests after edits" |

**Retrieval: BM25 keyword scoring**

```typescript
// For each memory, calculate relevance:
score = Σ(IDF(term) for term in query ∩ memory)
      × 1.5 if same project
      + 2.0 per keyword match
      + recency_bias (decays over 30 days)
      + 3.0 if correction type (critical to remember)
```

**Lifecycle:**

```
Session starts
  → retrieveRelevantMemories(query, projectDir)
  → BM25 score all memories against current context
  → Return top 8 by score (threshold > 0.5)
  → Format as system prompt section:
     "## Remembered Context
      - 🎯 Preference: User prefers tabs over spaces
      - ⚠️ Correction: Don't use var, use const
      - 📦 Project: Project uses Prisma + PostgreSQL"

Session ends
  → extractLearnings(messages)
  → Detect preference/correction patterns in user messages
  → saveMemories(learnings) → append to memory.jsonl
```

**Configuration:**
- Max 500 memories stored
- Max 8 injected per session
- 90-day TTL (old memories auto-expire)
- Deduplication by content prefix

### Design Decisions for Interview Discussion

1. **Why not a vector DB?** For a CLI tool with <500 memories, BM25 keyword matching is sufficient and requires zero infrastructure. A vector DB is overkill.
2. **Why append-only JSONL?** Simple, fast, no migrations, easy to inspect and debug
3. **Why 8 max memories?** Each memory ≈ 20-50 tokens. 8 memories ≈ 200-400 tokens — small enough to not crowd out real context
4. **Why BM25 over TF-IDF?** BM25 handles term frequency saturation better — a memory mentioning "TypeScript" 5 times shouldn't score 5× higher than one mentioning it once

---

## 15. Advanced: Auto-Lint Self-Healing Pipeline

### The Problem

AI models generate code with syntax errors, type mismatches, and missing imports. Without feedback, the AI has no way to know its output was broken.

### The Solution

After every `writeFile`, `editFile`, and `searchReplace` tool call, automatically run the appropriate linter for the file type. If errors are found, include them in the tool response so the AI can self-correct on the next iteration.

### File: `packages/cli/src/lib/auto-lint.ts`

**Supported languages:**

| Extension | Linter | Method | Timeout |
|-----------|--------|--------|--------|
| `.ts`, `.tsx` | `tsc --noEmit` | Finds nearest `tsconfig.json`, filters errors to edited file | 30s |
| `.js`, `.jsx` | `node --check` | Syntax validation | 15s |
| `.py` | `python -m py_compile` | Syntax validation | 15s |
| `.json` | `JSON.parse()` | Inline validation | Instant |
| `.css` | Bracket matching | Inline validation | Instant |

**Self-healing flow:**

```
1. AI calls editFile({ path: "src/utils.ts", oldString: ..., newString: ... })
2. local-tools.ts applies the edit
3. autoLint("src/utils.ts", cwd) runs automatically
4. tsc finds 2 errors in utils.ts
5. Tool response includes:
   {
     success: true,
     path: "src/utils.ts",
     diff: "... colored diff ...",
     lint: "❌ TypeScript lint: 2 error(s)\n  • error TS2322: Type 'string' is not assignable to type 'number'\n  • error TS2304: Cannot find name 'foo'\n\n💡 Fix the TypeScript errors in utils.ts, then try again."
   }
6. AI reads the lint field and makes a follow-up editFile to fix the errors
7. Step 3-6 repeat until lint passes ✅
```

**TypeScript-specific intelligence:**
- Searches up to 5 parent directories for `tsconfig.json`
- If found, runs project-wide check but filters to only show errors in the edited file
- If not found, falls back to single-file check with sensible defaults

**Integration in `local-tools.ts`:**

```typescript
case "writeFile": {
  // ... write the file ...
  const lint = await autoLint(relPath, cwd).catch(() => null);
  return {
    success: true,
    path: relPath,
    bytesWritten: Buffer.byteLength(content, "utf-8"),
    ...(lint && !lint.passed ? { lint: formatLintResult(lint) } : {}),
  };
}
```

### Design Decisions for Interview Discussion

1. **Why not block on lint failure?** The edit still succeeded — we want to inform the AI, not prevent writes
2. **Why filter tsc errors?** A project may have 50 pre-existing errors. We only show errors in the file the AI just touched
3. **Why graceful fallback?** If `tsc` isn't installed, we silently skip rather than breaking the tool pipeline
4. **Why inline JSON/CSS validation?** These are cheap to check without spawning processes

---

## 16. Advanced: Streaming Progress Tracker

### The Problem

During long AI responses, the user has no visibility into how fast the model is generating, how many tokens have been produced, or what the estimated cost is.

### The Solution

A real-time metrics tracker that measures streaming performance and displays it in the terminal status bar.

### File: `packages/cli/src/lib/streaming-tracker.ts`

**Metrics tracked:**

| Metric | How It's Calculated |
|--------|-------------------|
| `tokensPerSecond` | Rolling 50-chunk window: `tokens_in_window / window_duration_ms × 1000` |
| `elapsedMs` | `Date.now() - startTime` |
| `tokensGenerated` | `totalChars / 3.5` (same char-based estimation) |
| `estimatedCost` | `(inputTokens / 1M × inputPrice) + (outputTokens / 1M × outputPrice)` |
| `firstTokenMs` | Time between `start()` and first `onChunk()` (TTFT) |

**Status bar display:**

```
⚡ 142 tok/s  │  ⏱ 3.2s  │  📊 1.2K  │  💰 $0.0012
```

**Integration:**
- `StreamingTracker` is a singleton (one per CLI process)
- `start()` is called when user submits a message
- `onChunk()` is called on each streaming text update
- `stop()` is called when streaming completes
- `getMetrics()` returns a snapshot for UI rendering
- The status bar persists after streaming stops so the user can see final metrics

---

## 17. Advanced: Ollama Local Model Support

### The Problem

Cloud AI providers require API keys, internet, and may charge per token. Users want the option to run models locally.

### The Solution

Full Ollama integration as a first-class provider alongside OpenRouter.

### File: `packages/cli/src/lib/ollama.ts`

**Capabilities:**
- Auto-detect Ollama availability (`http://localhost:11434/api/tags`)
- List installed models with sizes
- Pull new models with progress tracking
- Format model sizes ("3.8 GB")

### File: `packages/server/src/lib/models.ts`

**Provider routing:**

```typescript
function resolveChatModel(modelId: string) {
  if (isOllamaModel(modelId)) {
    // Route to local Ollama — no API key needed
    return {
      model: ollama(modelId.replace("ollama:", "")),
      isLocal: true  // ← Skip billing
    };
  }
  // Route to OpenRouter
  return { model: openrouter(modelId), isLocal: false };
}
```

**Billing bypass:** In `chat.ts`, when `resolvedModel.isLocal` is true, credit checks and usage ingestion are skipped entirely.

**Model ID format:** `ollama:codellama:7b` — the `ollama:` prefix triggers local routing.

---

## 18. Advanced: Plugin System, Skills, File Watcher, Rich Diff & Image Understanding

### Plugin System

**File:** `packages/cli/src/lib/plugins.ts`

Plugins are custom tools stored in `.agenticcoder/plugins/<name>/`:

```
.agenticcoder/plugins/my-tool/
├── plugin.json    ← { name, description, inputSchema, handler }
└── handler.sh     ← Receives PLUGIN_INPUT env var (JSON)
```

**Execution flow:** Plugin tool calls are intercepted in `local-tools.ts` before falling through to MCP. The handler script is spawned as a subprocess with `PLUGIN_INPUT` set to the JSON-serialized input. Stdout is captured as the tool result.

### Skills System

**File:** `packages/cli/src/lib/skills.ts`

Skills are reusable prompt templates with YAML frontmatter:

```markdown
---
name: Code Review
description: Review code for bugs, security, and performance
mode: PLAN
---
Review the following code for...
```

**5 built-in skills:** Code Review, Add Tests, Refactor, Debug, Document

**Activation:** `/skills` command → select a skill → its prompt is injected into the chat input.

### File Watcher

**File:** `packages/cli/src/lib/file-watcher.ts`

Recursive `fs.watch()` that detects external file changes (not made by the AI) and shows toast notifications. Ignores `node_modules/`, `.git/`, and files recently written by AI tools (tracked via `markAiWritten()`).

**Debouncing:** 500ms window — batches rapid file changes into a single notification: `"📁 3 files changed externally"`.

### Rich Diff Viewer

**File:** `packages/cli/src/lib/diff-renderer.ts`

Pure TypeScript LCS-based diff engine that produces colorized output:

```diff
src/lib/utils.ts  +3 -1
@@ -10 +10 @@
  10 - const old = "value";
  10 + const updated = "new value";
  11 + const extra = true;
```

Integrated into `editFile` and `searchReplace` tool responses.

### Image Understanding

**File:** `packages/cli/src/lib/image-input.ts`

- **`@file.png` mentions:** Extracted from user input, converted to base64 multimodal parts
- **`captureScreenshot()`:** Platform-specific screenshot (Win: PowerShell, Mac: screencapture, Linux: gnome-screenshot)
- **`captureClipboardImage()`:** Read image from clipboard
- **Vision model detection:** `supportsVision` flag in model definitions, with image analysis instructions injected into system prompt when images are detected

---

## Complete New Files Reference

| File | Package | Purpose |
|------|---------|--------|
| `token-counter.ts` | shared | Token estimation + budget allocation |
| `context-manager.ts` | server | Priority-based context trimming |
| `memory.ts` | cli | RAG conversation memory (BM25) |
| `auto-lint.ts` | cli | Self-healing lint pipeline |
| `streaming-tracker.ts` | cli | Real-time streaming metrics |
| `ollama.ts` | cli | Ollama local model client |
| `plugins.ts` | cli | Plugin loader + executor |
| `skills.ts` | cli | Skills loader + built-in skills |
| `file-watcher.ts` | cli | External file change detection |
| `diff-renderer.ts` | cli | LCS-based rich diff engine |
| `image-input.ts` | cli | Screenshot + clipboard image capture |
| `ollama-dialog.tsx` | cli | Ollama model browser UI |
| `plugins-dialog.tsx` | cli | Plugin viewer UI |
| `skills-dialog.tsx` | cli | Skills browser UI |

---

## 19. MCP (Model Context Protocol) Support

### File: `packages/cli/src/lib/mcp-client.ts` — The MCP protocol engine

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

### File: `packages/cli/src/components/dialogs/mcp-dialog.tsx` — MCP Server UI

**Built-in catalog (6 servers):**
| Server | Package | Needs API Key |
|--------|---------|---------------|
| Filesystem | `@modelcontextprotocol/server-filesystem` | No |
| GitHub | `@modelcontextprotocol/server-github` | Yes (GITHUB_TOKEN) |
| Brave Search | `@modelcontextprotocol/server-brave-search` | Yes (BRAVE_API_KEY) |
| PostgreSQL | `@modelcontextprotocol/server-postgres` | Yes (DATABASE_URL) |
| Memory | `@modelcontextprotocol/server-memory` | No |
| Puppeteer | `@modelcontextprotocol/server-puppeteer` | No |

**Tool routing in `local-tools.ts`:**
```ts
// After all built-in tool handlers:
if (isMcpTool(toolName)) {
  return executeMcpTool(toolName, input as Record<string, unknown>);
}
```

---

## 20. Checkpoint / Undo System

### File: `packages/cli/src/lib/checkpoint.ts`

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

**Automatic checkpoints:** Before any write operation (`writeFile`, `editFile`, `searchReplace`, `bash`), `local-tools.ts` calls `ensureCheckpoint()` to save the current state.

**Commands:**
- `/undo` → calls `undoToLastCheckpoint()`, shows toast with result
- `/commit` → runs `git add -A && git commit -m "chore: agenticcoder changes"`

---

## 21. Project Context Injection

### File: `packages/cli/src/lib/project-context.ts`

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

## 22. Bash Streaming

### How bash output streams in real-time across the UI

**`use-chat.ts`** — State management:
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

**`session.tsx`** — Passes as props:
```tsx
<ChatMessage msg={msg} bashOutput={bashOutput} isBashStreaming={isBashStreaming} />
```

**`bot-message.tsx`** — Renders last 5 lines:
```tsx
{isBashStreaming && bashOutput && (
  <box flexDirection="column">
    <text fg="gray">{bashOutput.split("\n").slice(-5).join("\n")}</text>
  </box>
)}
```

---

## 23. Preference Persistence

### File: `packages/cli/src/providers/prompt-config/index.tsx`

**Storage location:** `~/.agenticcoder/preferences.json`

**Format:**
```json
{
  "model": "google/gemini-2.5-flash",
  "mode": "BUILD"
}
```

**Merge-on-write pattern (prevents overwriting other preferences):**
```ts
function savePreferences(partial: Partial<Preferences>) {
  const existing = loadPreferences(); // read current
  const merged = { ...existing, ...partial }; // merge
  writeFileSync(PREFS_PATH, JSON.stringify(merged, null, 2));
}
```

Same pattern used by `packages/cli/src/providers/theme/index.tsx` for theme persistence.

---

## 24. Image Input Deep Dive

### File: `packages/cli/src/lib/image-input.ts`

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
| `extractImageMentions()` | `(message, cwd?) → Promise<{text, images}>` | Async wrapper for use-chat.ts |
| `hasImageReferences()` | `(message) → boolean` | Quick regex test for `@*.png` etc. |
| `captureScreenshot()` | `(outputPath) → Promise<string>` | Platform-specific screenshot capture |
| `captureClipboardImage()` | `(outputPath) → Promise<string>` | Read image from clipboard |

**Supported extensions:** `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`, `.svg`

**Regex:** `/@([\w./-]+\.(png|jpg|jpeg|gif|webp|bmp|svg))/gi`

**Vision model detection:** Models with `supportsVision: true` in `shared/models.ts` get additional image analysis instructions injected into the system prompt when images are detected in the conversation.

---

## All Commands Reference

| Command | Description | Handler |
|---------|-------------|--------|
| `/new` | Start a new conversation | Creates new session |
| `/clear` | Clear chat and go home | Navigates to home |
| `/undo` | Revert to last checkpoint | `undoToLastCheckpoint()` |
| `/commit` | Git commit all changes | `git add -A && git commit` |
| `/agents` | Switch Plan/Build modes | Opens agents dialog |
| `/models` | Select AI model | Opens models dialog |
| `/ollama` | Browse local Ollama models | Opens ollama dialog |
| `/skills` | Browse prompt skills | Opens skills dialog |
| `/plugins` | View installed plugins | Opens plugins dialog |
| `/mcp` | View/install MCP servers | Opens MCP dialog |
| `/sessions` | Browse past sessions | Opens sessions dialog |
| `/theme` | Change color theme | Opens theme dialog |
| `/login` | Sign in via browser | Opens OAuth flow |
| `/logout` | Sign out | Clears auth |
| `/upgrade` | Buy credits | Opens Polar checkout |
| `/usage` | Open billing portal | Opens Polar portal |
| `/status` | Show current config | Displays config |
| `/help` | List all commands | Shows help text |
| `/exit` | Quit | Exits process |

---

## Complete New Files Reference

| File | Package | Purpose |
|------|---------|--------|
| `token-counter.ts` | shared | Token estimation + budget allocation |
| `context-manager.ts` | server | Priority-based context trimming |
| `memory.ts` | cli | RAG conversation memory (BM25) |
| `auto-lint.ts` | cli | Self-healing lint pipeline |
| `streaming-tracker.ts` | cli | Real-time streaming metrics |
| `ollama.ts` | cli | Ollama local model client |
| `plugins.ts` | cli | Plugin loader + executor |
| `skills.ts` | cli | Skills loader + built-in skills |
| `file-watcher.ts` | cli | External file change detection |
| `diff-renderer.ts` | cli | LCS-based rich diff engine |
| `image-input.ts` | cli | Screenshot + clipboard image capture |
| `mcp-client.ts` | cli | MCP protocol client |
| `checkpoint.ts` | cli | Git checkpoint/undo system |
| `project-context.ts` | cli | Project context injection |
| `subagent.ts` | cli | SubAgent orchestrator engine |
| `agent-prompts.ts` | cli | Specialized system prompts + configs per agent type |
| `plugin-registry.ts` | cli | External plugin install/remove/update from GitHub, npm, URL |
| `ollama-dialog.tsx` | cli | Ollama model browser UI |
| `plugins-dialog.tsx` | cli | Plugin viewer UI |
| `skills-dialog.tsx` | cli | Skills browser UI |
| `mcp-dialog.tsx` | cli | MCP server browser UI |

---

## 23. External Plugin Registry

### Overview

The plugin system now supports **installing, removing, and updating external plugins** from 3 sources:

### Installation Commands

```
/plugin install github:user/repo          # GitHub repository
/plugin install npm:package-name          # npm package
/plugin install https://url.com/file.tgz  # Direct URL (tar.gz/tgz)
```

### Management Commands

```
/plugin remove my-plugin    # Delete a plugin
/plugin update my-plugin    # Re-fetch latest from source
/plugins                    # View all installed plugins with source info
```

### How It Works

1. **Install**: Downloads from source → extracts tarball → validates `plugin.json` → saves to `.agenticcoder/plugins/<name>/`
2. **Source Tracking**: Each installed plugin gets a `.source.json` metadata file so update knows where to fetch from
3. **Update**: Reads `.source.json` → removes old → re-installs from original source
4. **Remove**: Deletes the plugin directory entirely

### Safety

| Guard | Value |
|-------|-------|
| Validation | `plugin.json` manifest required — invalid archives are rejected and cleaned up |
| Tarball extraction | Platform-aware (`tar` on Unix, PowerShell `tar` on Windows) |
| Source tracking | `.source.json` prevents updates on manually-installed plugins |

### Key Files

| File | Purpose |
|------|---------|
| `plugin-registry.ts` | Core install/remove/update logic with GitHub, npm, URL support |
| `plugins-dialog.tsx` | Updated to show source info (github/npm/local/url) |
| `Input-bar.tsx` | `/plugin install|remove|update` command interception |
| `Commands.tsx` | Command menu entries for plugin management |

---

## 24. SubAgent System

### Overview

The SubAgent system allows the AI to **autonomously spawn specialized child agents** that handle complex, multi-step tasks in parallel. Each subagent gets its own AI conversation with a focused system prompt, constrained tool access, and isolated context window.

### When SubAgents Are Used

SubAgents are activated **only for genuinely complex tasks**:

**✅ DO spawn agents when:**
- Task spans 3+ files across different components
- Task has naturally parallelizable sub-tasks (research + implement)
- Large refactors, migrations, or multi-file features
- Need parallel code review while implementing

**⚠️ Do NOT spawn agents for:**
- Simple single-file edits or quick lookups
- Tasks completable in 1-3 tool calls

### Agent Types

| Type | Tools | Max Steps | Timeout | Purpose |
|------|-------|-----------|---------|---------|
| `researcher` | read-only | 15 | 60s | Explore codebase, gather context |
| `coder` | all build tools | 25 | 120s | Write/edit code, run commands |
| `reviewer` | read-only + git | 15 | 60s | Code review, find bugs |
| `planner` | read-only + thinkOut | 10 | 45s | Break down tasks, create plans |
| `debugger` | all build tools | 20 | 90s | Diagnose and fix bugs |

### Key Files

| File | Purpose |
|------|---------|
| `schemas.ts` | `spawnAgent` tool schema, `AgentType` enum |
| `agent-prompts.ts` | Per-agent system prompts and config |
| `subagent.ts` | `SubAgentOrchestrator` — lifecycle, parallel execution, JSONL logging |
| `local-tools.ts` | `spawnAgent` case handler |
| `chat.ts` | `POST /chat/subagent` — isolated AI conversation endpoint |

### Logging

Subagent conversations are logged to `~/.agenticcoder/subagent-logs/<session-id>/` as JSONL files (like Antigravity/Claude Code).

### Billing

SubAgent API calls are **not billed separately** — bundled into the parent request.

## Summary

AgenticCoder is a **4-package monorepo** with **20+ features** where:

- **`shared`** defines the contract (tool schemas, model definitions, token counter, types)
- **`database`** stores sessions and messages in Neon PostgreSQL via Prisma
- **`server`** orchestrates AI conversations with **token-aware context management**, authentication, and billing (Express + AI SDK + Clerk + Polar)
- **`cli`** renders the terminal UI and executes all 17+ tools locally with **subagent orchestration**, **auto-lint self-healing**, **conversation memory (RAG)**, **streaming metrics**, **plugins**, **skills**, **file watching**, **rich diffs**, **MCP protocol**, **checkpoint/undo**, **bash streaming**, **preference persistence**, and **image understanding** (React + @opentui)

The AI never touches your files directly. The server acts as a relay between you and the AI model. For complex tasks, the AI spawns **specialized subagents** that work in parallel with isolated contexts.

