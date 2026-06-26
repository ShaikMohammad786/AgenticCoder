import { Database } from "bun:sqlite";
import { resolve, extname, relative, join, dirname } from "path";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "fs";
import { homedir } from "os";
// web-tree-sitter v0.24: module export IS the Parser constructor
const Parser = require("web-tree-sitter") as TreeSitterParserStatic;

interface TreeSitterParserStatic {
  new (): TreeSitterParser;
  init(): Promise<void>;
  Language: {
    load(path: string): Promise<TreeSitterLanguage>;
  };
}
type TreeSitterParser = {
  setLanguage(lang: TreeSitterLanguage): void;
  parse(input: string): TreeSitterTree;
};
type TreeSitterLanguage = unknown;
type TreeSitterTree = { rootNode: TreeSitterNode };
type TreeSitterNode = {
  type: string;
  text: string;
  namedChildren: TreeSitterNode[];
  childForFieldName(name: string): TreeSitterNode | null;
};

// ─── Types ────────────────────────────────────────────────────────────

export type SymbolEntry = {
  rowid?: number;
  name: string;
  type: "function" | "class" | "interface" | "type" | "variable" | "method";
  filePath: string;
  content: string;
};

// ─── Tree-Sitter Initialization ───────────────────────────────────────

let _parserInitialized = false;
const _loadedLanguages = new Map<string, TreeSitterLanguage>();
let _parser: TreeSitterParser | null = null;

/**
 * Maps file extensions to tree-sitter grammar names.
 * Every language that has a .wasm in tree-sitter-wasms is supported.
 */
const EXT_TO_GRAMMAR: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".cs": "c_sharp",
  ".rb": "ruby",
  ".php": "php",
  ".swift": "swift",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".scala": "scala",
  ".lua": "lua",
  ".dart": "dart",
  ".ex": "elixir",
  ".exs": "elixir",
  ".elm": "elm",
  ".zig": "zig",
  ".sol": "solidity",
  ".ml": "ocaml",
  ".vue": "vue",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
};

/**
 * AST node types that represent "function-like" definitions per language grammar.
 */
const FUNCTION_NODE_TYPES = new Set([
  "function_declaration",
  "function_definition",
  "method_definition",
  "method_declaration",
  "arrow_function",
  "function_item",              // Rust
  "func_literal",               // Go
  "function_signature",         // TS interface methods
  "generator_function_declaration",
]);

/**
 * AST node types that represent "class/struct/trait" definitions.
 */
const CLASS_NODE_TYPES = new Set([
  "class_declaration",
  "class_definition",
  "struct_item",                // Rust
  "struct_specifier",           // C/C++
  "interface_declaration",
  "trait_item",                 // Rust
  "impl_item",                 // Rust
  "enum_declaration",
  "enum_item",                  // Rust
  "type_alias_declaration",
  "module_declaration",
]);

/**
 * AST node types that represent variable/const declarations.
 */
const VARIABLE_NODE_TYPES = new Set([
  "lexical_declaration",        // const/let in JS/TS
  "variable_declaration",
  "const_item",                 // Rust
  "static_item",                // Rust
  "short_var_declaration",      // Go :=
  "var_declaration",            // Go
  "const_declaration",          // Go
]);

async function ensureParserReady(): Promise<TreeSitterParser> {
  if (_parser && _parserInitialized) return _parser;
  await Parser.init();
  _parser = new Parser();
  _parserInitialized = true;
  return _parser;
}

function getWasmPath(grammarName: string): string {
  const wasmDir = join(
    dirname(require.resolve("tree-sitter-wasms/package.json")),
    "out",
  );
  return join(wasmDir, `tree-sitter-${grammarName}.wasm`);
}

async function getLanguage(grammarName: string): Promise<TreeSitterLanguage | null> {
  if (_loadedLanguages.has(grammarName)) {
    return _loadedLanguages.get(grammarName)!;
  }
  const wasmPath = getWasmPath(grammarName);
  if (!existsSync(wasmPath)) return null;
  try {
    const lang = await Parser.Language.load(wasmPath);
    _loadedLanguages.set(grammarName, lang);
    return lang;
  } catch {
    return null;
  }
}

// ─── Database ─────────────────────────────────────────────────────────

let _db: Database | null = null;

function getDbPath(): string {
  const dir = join(homedir(), ".agenticcoder");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, "index.db");
}

export function getDb(): Database {
  if (_db) return _db;
  _db = new Database(getDbPath());
  _db.run("PRAGMA journal_mode = WAL");

  _db.run(`
    CREATE TABLE IF NOT EXISTS symbols (
      rowid INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      filePath TEXT NOT NULL,
      content TEXT NOT NULL
    )
  `);
  _db.run(`CREATE INDEX IF NOT EXISTS idx_symbols_filepath ON symbols(filePath)`);

  _db.run(`
    CREATE VIRTUAL TABLE IF NOT EXISTS symbols_fts USING fts5(
      name, content,
      content='symbols',
      content_rowid='rowid'
    )
  `);

  // Auto-sync triggers
  _db.run(`
    CREATE TRIGGER IF NOT EXISTS symbols_ai AFTER INSERT ON symbols BEGIN
      INSERT INTO symbols_fts(rowid, name, content) VALUES (new.rowid, new.name, new.content);
    END
  `);
  _db.run(`
    CREATE TRIGGER IF NOT EXISTS symbols_ad AFTER DELETE ON symbols BEGIN
      INSERT INTO symbols_fts(symbols_fts, rowid, name, content) VALUES ('delete', old.rowid, old.name, old.content);
    END
  `);
  _db.run(`
    CREATE TRIGGER IF NOT EXISTS symbols_au AFTER UPDATE ON symbols BEGIN
      INSERT INTO symbols_fts(symbols_fts, rowid, name, content) VALUES ('delete', old.rowid, old.name, old.content);
      INSERT INTO symbols_fts(rowid, name, content) VALUES (new.rowid, new.name, new.content);
    END
  `);

  return _db;
}

// ─── AST Symbol Extraction ────────────────────────────────────────────

function extractName(node: TreeSitterNode): string | null {
  // Try common field names for the symbol's identifier
  for (const fieldName of ["name", "declarator", "pattern"]) {
    const child = node.childForFieldName(fieldName);
    if (child) {
      // For complex declarators (C/C++), dig into the identifier
      if (child.type === "identifier" || child.type === "type_identifier" || child.type === "property_identifier") {
        return child.text;
      }
      // For destructured patterns, try the first identifier child
      const idChild = child.namedChildren.find(c => c.type === "identifier" || c.type === "type_identifier");
      if (idChild) return idChild.text;
      // Fallback to raw text if it looks like an identifier
      if (/^[a-zA-Z_]\w*$/.test(child.text)) return child.text;
    }
  }

  // For variable declarations, look inside the first declarator
  if (VARIABLE_NODE_TYPES.has(node.type)) {
    for (const child of node.namedChildren) {
      if (child.type === "variable_declarator" || child.type === "const_spec" || child.type === "var_spec") {
        const nameNode = child.childForFieldName("name");
        if (nameNode) return nameNode.text;
        // Go: first identifier child
        const id = child.namedChildren.find(c => c.type === "identifier");
        if (id) return id.text;
      }
    }
  }

  return null;
}

function classifyNode(nodeType: string): SymbolEntry["type"] | null {
  if (FUNCTION_NODE_TYPES.has(nodeType)) return "function";
  if (nodeType === "method_definition" || nodeType === "method_declaration") return "method";
  if (CLASS_NODE_TYPES.has(nodeType)) return "class";
  if (nodeType === "interface_declaration") return "interface";
  if (nodeType === "type_alias_declaration") return "type";
  if (VARIABLE_NODE_TYPES.has(nodeType)) return "variable";
  return null;
}

function collectSymbols(
  node: TreeSitterNode,
  filePath: string,
  symbols: SymbolEntry[],
  depth: number = 0,
): void {
  // Only extract top-level and class-level declarations (depth <= 1)
  if (depth > 2) return;

  const symbolType = classifyNode(node.type);
  if (symbolType) {
    const name = extractName(node);
    if (name && name.length > 1 && !name.startsWith("_")) {
      // Truncate content to first 500 chars for storage efficiency
      const content = node.text.length > 500
        ? node.text.slice(0, 500) + "..."
        : node.text;

      symbols.push({ name, type: symbolType, filePath, content });
    }
  }

  // Recurse into children
  for (const child of node.namedChildren) {
    collectSymbols(child, filePath, symbols, depth + 1);
  }
}

// ─── Index a Single File ──────────────────────────────────────────────

export async function indexFileAsync(filePath: string, cwd: string = process.cwd()): Promise<void> {
  const ext = extname(filePath);
  const grammarName = EXT_TO_GRAMMAR[ext];
  if (!grammarName) return;

  const resolved = resolve(cwd, filePath);
  if (!existsSync(resolved)) return;

  let content: string;
  try {
    content = readFileSync(resolved, "utf-8");
  } catch {
    return;
  }

  // Skip huge files (> 500KB)
  if (content.length > 500_000) return;

  const parser = await ensureParserReady();
  const language = await getLanguage(grammarName);
  if (!language) return;

  parser.setLanguage(language);
  const tree = parser.parse(content);

  const symbols: SymbolEntry[] = [];
  collectSymbols(tree.rootNode, filePath, symbols);

  const db = getDb();
  const tx = db.transaction(() => {
    db.run(`DELETE FROM symbols WHERE filePath = ?`, [filePath]);
    const insert = db.prepare(
      `INSERT INTO symbols (name, type, filePath, content) VALUES (?, ?, ?, ?)`,
    );
    for (const sym of symbols) {
      insert.run(sym.name, sym.type, sym.filePath, sym.content);
    }
  });
  tx();
}

/**
 * Synchronous wrapper that fires and forgets the async indexing.
 * Used by the file watcher which expects a sync callback.
 */
export function indexFile(filePath: string, cwd: string = process.cwd()): void {
  indexFileAsync(filePath, cwd).catch(() => {
    // Silently ignore indexing errors in the watcher path
  });
}

// ─── Search ───────────────────────────────────────────────────────────

export function searchCodebase(query: string): SymbolEntry[] {
  const db = getDb();
  const sanitized = query.replace(/['"]/g, "").trim();
  if (!sanitized) return [];

  try {
    const ftsStmt = db.prepare(`
      SELECT s.name, s.type, s.filePath, s.content
      FROM symbols s
      JOIN symbols_fts f ON s.rowid = f.rowid
      WHERE symbols_fts MATCH ?
      ORDER BY rank
      LIMIT 20
    `);
    return ftsStmt.all(`"${sanitized}"*`) as SymbolEntry[];
  } catch {
    const likeStmt = db.prepare(`
      SELECT name, type, filePath, content
      FROM symbols
      WHERE name LIKE ? OR content LIKE ?
      ORDER BY name
      LIMIT 20
    `);
    return likeStmt.all(`%${sanitized}%`, `%${sanitized}%`) as SymbolEntry[];
  }
}

// ─── Bulk Index Workspace ─────────────────────────────────────────────

export async function indexWorkspaceAsync(cwd: string = process.cwd()): Promise<void> {
  const db = getDb();
  const normalizedCwd = cwd.replace(/\\/g, "/");
  const count = db.prepare(
    "SELECT count(*) as c FROM symbols WHERE filePath LIKE ?",
  ).get(`${normalizedCwd}%`) as { c: number } | undefined;

  if (count && count.c > 0) return;

  async function scanDir(dir: string): Promise<void> {
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const name = entry.name;
      if (name === "node_modules" || name.startsWith(".") || name === "dist" || name === "build" || name === "__pycache__") {
        continue;
      }
      const fullPath = join(dir, name);
      if (entry.isDirectory()) {
        await scanDir(fullPath);
      } else {
        const ext = extname(name);
        if (EXT_TO_GRAMMAR[ext]) {
          await indexFileAsync(relative(cwd, fullPath), cwd);
        }
      }
    }
  }

  await scanDir(cwd);
}

/**
 * Synchronous wrapper for the file watcher startup.
 */
export function indexWorkspace(cwd: string = process.cwd()): void {
  indexWorkspaceAsync(cwd).catch((err) => {
    console.error("[indexer] Workspace indexing failed:", err);
  });
}
