/**
 * File watcher — detects external file changes in the project directory.
 */

import { watch, type FSWatcher } from "fs";
import { relative, join } from "path";
import { indexFile, indexWorkspace } from "./indexer";

export type FileChangeEvent = {
  files: string[];
  timestamp: number;
};

type ChangeCallback = (event: FileChangeEvent) => void;

const DEBOUNCE_MS = 500;
const IGNORED_DIRS = new Set(["node_modules", ".git", ".agenticcoder", "dist", "build", ".next", ".turbo"]);
const IGNORED_EXTENSIONS = new Set([".log", ".lock", ".tmp", ".swp", ".swo"]);

export class FileWatcher {
  private watcher: FSWatcher | null = null;
  private aiWrittenFiles = new Set<string>();
  private pendingChanges = new Set<string>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private callback: ChangeCallback | null = null;
  private cwd: string = "";
  private _running = false;

  /** Whether the watcher is currently active */
  get running() { return this._running; }

  /**
   * Mark a file as written by the AI (so we ignore it in change detection).
   * Path should be relative to cwd.
   */
  markAiWritten(relativePath: string) {
    this.aiWrittenFiles.add(relativePath);
    // Clear after 5 seconds (file system events should have fired by then)
    setTimeout(() => this.aiWrittenFiles.delete(relativePath), 5000);
  }

  /**
   * Start watching the project directory for external changes.
   */
  start(cwd: string, onChange: ChangeCallback) {
    if (this._running) this.stop();

    this.cwd = cwd;
    this.callback = onChange;
    this._running = true;

    // Run initial bulk index (will skip if already indexed)
    try {
      indexWorkspace(cwd);
    } catch (err) {
      console.error("[indexer] Failed to perform initial index:", err);
    }

    try {
      this.watcher = watch(cwd, { recursive: true }, (eventType, filename) => {
        if (!filename) return;

        // Normalize path separators
        const normalizedPath = filename.replace(/\\/g, "/");

        // Skip ignored directories
        const parts = normalizedPath.split("/");
        if (parts.some((p) => IGNORED_DIRS.has(p))) return;

        // Skip ignored extensions
        const ext = normalizedPath.includes(".") ? "." + normalizedPath.split(".").pop()! : "";
        if (IGNORED_EXTENSIONS.has(ext)) return;

        // Skip files the AI just wrote
        if (this.aiWrittenFiles.has(normalizedPath)) return;

        // Add to pending changes and debounce
        this.pendingChanges.add(normalizedPath);
        this.scheduleFire();
      });

      this.watcher.on("error", (err) => {
        console.error("[watcher] Error:", err.message);
      });
    } catch (err) {
      console.error("[watcher] Failed to start:", err instanceof Error ? err.message : String(err));
      this._running = false;
    }
  }

  /**
   * Stop watching.
   */
  stop() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.pendingChanges.clear();
    this.aiWrittenFiles.clear();
    this.callback = null;
    this._running = false;
  }

  private scheduleFire() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);

    this.debounceTimer = setTimeout(() => {
      const files = Array.from(this.pendingChanges);
      if (files.length > 0 && this.callback) {
        // Re-index files
        for (const file of files) {
          try {
            indexFile(file, this.cwd);
          } catch (e) {
            // Ignore indexer errors
          }
        }
        
        this.callback({
          files,
          timestamp: Date.now(),
        });
      }
      this.pendingChanges.clear();
      this.debounceTimer = null;
    }, DEBOUNCE_MS);
  }
}

/** Singleton file watcher instance */
let _watcher: FileWatcher | null = null;

export function getFileWatcher(): FileWatcher {
  if (!_watcher) _watcher = new FileWatcher();
  return _watcher;
}

/**
 * Format file change list for display.
 */
export function formatFileChanges(files: string[]): string {
  if (files.length === 0) return "";
  if (files.length === 1) return `📁 ${files[0]} changed externally`;
  if (files.length <= 5) {
    return `📁 ${files.length} files changed externally:\n${files.map((f) => `  • ${f}`).join("\n")}`;
  }
  const shown = files.slice(0, 4);
  return `📁 ${files.length} files changed externally:\n${shown.map((f) => `  • ${f}`).join("\n")}\n  • ... and ${files.length - 4} more`;
}
