/**
 * Conversation Memory — cross-session learning with keyword-based retrieval.
 *
 * Architecture:
 *   Session ends → extract learnings → append to memory.jsonl
 *   Session starts → load relevant memories → inject into system prompt
 *
 * Storage: ~/.agenticcoder/memory.jsonl (append-only log)
 * Retrieval: BM25-style keyword matching (no vector DB needed for CLI)
 */

import { readFile, appendFile, stat } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { existsSync, mkdirSync } from "fs";

const MEMORY_DIR = join(homedir(), ".agenticcoder");
const MEMORY_FILE = join(MEMORY_DIR, "memory.jsonl");
const MAX_MEMORIES = 500;
const MAX_RELEVANT = 8; // Max memories to inject per session
const MAX_MEMORY_AGE_DAYS = 90;

export type MemoryEntry = {
  id: string;
  timestamp: number;
  type: "preference" | "fact" | "pattern" | "correction" | "project-info";
  content: string;
  keywords: string[];
  project?: string; // Project root directory
  sessionId?: string;
  score?: number; // Relevance score (set during retrieval)
};

/**
 * Save a learning to memory.
 */
export async function saveMemory(entry: Omit<MemoryEntry, "id" | "timestamp">): Promise<void> {
  ensureMemoryDir();

  const fullEntry: MemoryEntry = {
    ...entry,
    id: generateId(),
    timestamp: Date.now(),
  };

  await appendFile(MEMORY_FILE, JSON.stringify(fullEntry) + "\n", "utf-8");
}

/**
 * Save multiple learnings at once.
 */
export async function saveMemories(entries: Omit<MemoryEntry, "id" | "timestamp">[]): Promise<void> {
  if (entries.length === 0) return;
  ensureMemoryDir();

  const lines = entries.map((entry) => {
    const full: MemoryEntry = {
      ...entry,
      id: generateId(),
      timestamp: Date.now(),
    };
    return JSON.stringify(full);
  });

  await appendFile(MEMORY_FILE, lines.join("\n") + "\n", "utf-8");
}

/**
 * Load all memories from disk.
 */
export async function loadAllMemories(): Promise<MemoryEntry[]> {
  if (!existsSync(MEMORY_FILE)) return [];

  try {
    const content = await readFile(MEMORY_FILE, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const now = Date.now();
    const maxAge = MAX_MEMORY_AGE_DAYS * 24 * 60 * 60 * 1000;

    const memories: MemoryEntry[] = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as MemoryEntry;
        // Skip expired memories
        if (now - entry.timestamp > maxAge) continue;
        memories.push(entry);
      } catch {
        // Skip malformed lines
      }
    }

    // Keep only the most recent N entries
    return memories.slice(-MAX_MEMORIES);
  } catch {
    return [];
  }
}

/**
 * Retrieve relevant memories for a given query/context using BM25-style scoring.
 */
export async function retrieveRelevantMemories(
  query: string,
  projectDir?: string,
): Promise<MemoryEntry[]> {
  const all = await loadAllMemories();
  if (all.length === 0) return [];

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return all.slice(-MAX_RELEVANT);

  // Calculate IDF for each query token
  const docCount = all.length;
  const tokenDocFreq = new Map<string, number>();

  for (const memory of all) {
    const memTokens = new Set([...tokenize(memory.content), ...memory.keywords]);
    for (const token of queryTokens) {
      if (memTokens.has(token)) {
        tokenDocFreq.set(token, (tokenDocFreq.get(token) ?? 0) + 1);
      }
    }
  }

  // Score each memory
  const scored: MemoryEntry[] = all.map((memory) => {
    const memTokens = new Set([...tokenize(memory.content), ...memory.keywords]);
    let score = 0;

    // BM25-inspired scoring
    for (const token of queryTokens) {
      if (memTokens.has(token)) {
        const df = tokenDocFreq.get(token) ?? 0;
        const idf = Math.log((docCount - df + 0.5) / (df + 0.5) + 1);
        score += idf;
      }
    }

    // Bonus for same project
    if (projectDir && memory.project === projectDir) {
      score *= 1.5;
    }

    // Bonus for keyword matches (they're curated)
    for (const kw of memory.keywords) {
      if (queryTokens.includes(kw.toLowerCase())) {
        score += 2;
      }
    }

    // Recency bias: recent memories are slightly more relevant
    const ageHours = (Date.now() - memory.timestamp) / (1000 * 60 * 60);
    const recencyBoost = Math.max(0, 1 - ageHours / (24 * 30)); // Decays over 30 days
    score += recencyBoost;

    // Priority boost by type
    if (memory.type === "correction") score += 3; // Corrections are critical
    if (memory.type === "preference") score += 1;

    return { ...memory, score };
  });

  // Sort by score descending, return top N
  scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return scored.slice(0, MAX_RELEVANT).filter((m) => (m.score ?? 0) > 0.5);
}

/**
 * Extract learnings from a conversation for persistence.
 * Analyzes the conversation to find preferences, facts, corrections, and patterns.
 */
export function extractLearnings(
  messages: Array<{ role: string; parts?: Array<{ type: string; text?: string }> }>,
  projectDir?: string,
): Omit<MemoryEntry, "id" | "timestamp">[] {
  const learnings: Omit<MemoryEntry, "id" | "timestamp">[] = [];

  for (const msg of messages) {
    if (msg.role !== "user") continue;

    const text = (msg.parts ?? [])
      .filter((p) => p.type === "text" && p.text)
      .map((p) => p.text!)
      .join(" ");

    if (!text || text.length < 10) continue;

    // Detect preferences: "I prefer...", "always use...", "don't use...", "use X instead of Y"
    const prefPatterns = [
      /(?:i (?:prefer|like|want|always use)|always use|please use|use .+ instead of)/i,
      /(?:don't|never|avoid|stop) (?:use|using|add|do)/i,
    ];
    for (const pat of prefPatterns) {
      if (pat.test(text)) {
        learnings.push({
          type: "preference",
          content: text.slice(0, 200),
          keywords: extractKeywords(text),
          project: projectDir,
        });
        break;
      }
    }

    // Detect corrections: "no, I meant...", "that's wrong", "fix this"
    const corrPatterns = [
      /(?:no,? (?:i meant|that's wrong|not (?:like )?that))/i,
      /(?:that's (?:wrong|incorrect|not right|not what i))/i,
    ];
    for (const pat of corrPatterns) {
      if (pat.test(text)) {
        learnings.push({
          type: "correction",
          content: text.slice(0, 200),
          keywords: extractKeywords(text),
          project: projectDir,
        });
        break;
      }
    }
  }

  // Detect project info from tool results
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const parts = msg.parts ?? [];
    
    for (const part of parts) {
      if (part.type === "text" && part.text) {
        // Detect framework mentions
        const frameworks = part.text.match(
          /(?:using|project uses|stack:?)\s+(React|Vue|Angular|Next\.js|Express|Hono|Prisma|Django|FastAPI)/gi
        );
        if (frameworks) {
          for (const fw of frameworks) {
            learnings.push({
              type: "project-info",
              content: `Project uses ${fw.replace(/^(?:using|project uses|stack:?)\s+/i, "")}`,
              keywords: [fw.toLowerCase()],
              project: projectDir,
            });
          }
        }
      }
    }
  }

  // Deduplicate by content similarity
  const unique = new Map<string, Omit<MemoryEntry, "id" | "timestamp">>();
  for (const l of learnings) {
    const key = l.content.toLowerCase().slice(0, 50);
    if (!unique.has(key)) unique.set(key, l);
  }

  return [...unique.values()];
}

/**
 * Format memories for injection into system prompt.
 */
export function formatMemoriesForPrompt(memories: MemoryEntry[]): string {
  if (memories.length === 0) return "";

  const lines = memories.map((m) => {
    const typeLabel = {
      preference: "🎯 Preference",
      fact: "📌 Fact",
      pattern: "🔄 Pattern",
      correction: "⚠️ Correction",
      "project-info": "📦 Project",
    }[m.type];
    return `- ${typeLabel}: ${m.content}`;
  });

  return [
    "",
    "## Remembered Context (from previous sessions)",
    "The user has these known preferences and project context:",
    ...lines,
    "",
  ].join("\n");
}

// --- Utilities ---

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function extractKeywords(text: string): string[] {
  const tokens = tokenize(text);
  // Remove common stop words
  const stops = new Set([
    "the", "and", "for", "are", "but", "not", "you", "all", "can",
    "had", "her", "was", "one", "our", "out", "has", "have", "this",
    "that", "with", "from", "will", "been", "they", "some", "what",
    "when", "where", "who", "how", "which", "their", "use", "using",
    "please", "want", "like", "don", "always", "instead",
  ]);
  return [...new Set(tokens.filter((t) => !stops.has(t)))].slice(0, 10);
}

function generateId(): string {
  return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensureMemoryDir(): void {
  if (!existsSync(MEMORY_DIR)) {
    mkdirSync(MEMORY_DIR, { recursive: true });
  }
}

/**
 * Get memory stats for /stats command.
 */
export async function getMemoryStats(): Promise<{
  totalMemories: number;
  byType: Record<string, number>;
  oldestDays: number;
  fileSizeKb: number;
}> {
  const all = await loadAllMemories();
  const byType: Record<string, number> = {};

  for (const m of all) {
    byType[m.type] = (byType[m.type] ?? 0) + 1;
  }

  let fileSizeKb = 0;
  try {
    const s = await stat(MEMORY_FILE);
    fileSizeKb = Math.round(s.size / 1024);
  } catch {}

  const oldest = all.length > 0
    ? Math.round((Date.now() - all[0]!.timestamp) / (1000 * 60 * 60 * 24))
    : 0;

  return {
    totalMemories: all.length,
    byType,
    oldestDays: oldest,
    fileSizeKb,
  };
}
