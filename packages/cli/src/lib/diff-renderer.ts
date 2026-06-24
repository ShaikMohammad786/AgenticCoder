/**
 * Diff renderer — generates line-by-line diffs for file edits.
 * No external dependencies, pure TypeScript implementation.
 */

export type DiffLine = {
  type: "add" | "remove" | "context";
  lineNumber: number;
  content: string;
};

export type DiffResult = {
  filePath: string;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
};

export type DiffHunk = {
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
};

const CONTEXT_LINES = 3;

/**
 * Generate a diff between old and new content.
 * Uses a simple LCS-based approach for reasonable quality.
 */
export function generateDiff(oldContent: string, newContent: string, filePath: string): DiffResult {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");

  // Find changed regions using simple line comparison
  const changes = findChanges(oldLines, newLines);

  if (changes.length === 0) {
    return { filePath, hunks: [], additions: 0, deletions: 0 };
  }

  // Group changes into hunks with context
  const hunks = buildHunks(oldLines, newLines, changes);

  let additions = 0;
  let deletions = 0;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.type === "add") additions++;
      if (line.type === "remove") deletions++;
    }
  }

  return { filePath, hunks, additions, deletions };
}

type Change = {
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
};

function findChanges(oldLines: string[], newLines: string[]): Change[] {
  const changes: Change[] = [];
  let oldIdx = 0;
  let newIdx = 0;

  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    // Skip matching lines
    if (oldIdx < oldLines.length && newIdx < newLines.length && oldLines[oldIdx] === newLines[newIdx]) {
      oldIdx++;
      newIdx++;
      continue;
    }

    // Found a difference — find the extent
    const oldStart = oldIdx;
    const newStart = newIdx;

    // Look ahead for the next matching line
    let found = false;
    for (let lookahead = 1; lookahead < 50 && !found; lookahead++) {
      // Check if old[oldIdx + lookahead] matches new[newIdx]
      if (oldIdx + lookahead < oldLines.length && newIdx < newLines.length) {
        if (oldLines[oldIdx + lookahead] === newLines[newIdx]) {
          changes.push({ oldStart, oldEnd: oldIdx + lookahead, newStart, newEnd: newIdx });
          oldIdx = oldIdx + lookahead;
          found = true;
          break;
        }
      }
      // Check if new[newIdx + lookahead] matches old[oldIdx]
      if (newIdx + lookahead < newLines.length && oldIdx < oldLines.length) {
        if (newLines[newIdx + lookahead] === oldLines[oldIdx]) {
          changes.push({ oldStart, oldEnd: oldIdx, newStart, newEnd: newIdx + lookahead });
          newIdx = newIdx + lookahead;
          found = true;
          break;
        }
      }
      // Check diagonal
      if (oldIdx + lookahead < oldLines.length && newIdx + lookahead < newLines.length) {
        if (oldLines[oldIdx + lookahead] === newLines[newIdx + lookahead]) {
          changes.push({ oldStart, oldEnd: oldIdx + lookahead, newStart, newEnd: newIdx + lookahead });
          oldIdx = oldIdx + lookahead;
          newIdx = newIdx + lookahead;
          found = true;
          break;
        }
      }
    }

    if (!found) {
      // Consume remaining as a single change
      changes.push({
        oldStart,
        oldEnd: oldLines.length,
        newStart,
        newEnd: newLines.length,
      });
      break;
    }
  }

  return changes;
}

function buildHunks(oldLines: string[], newLines: string[], changes: Change[]): DiffHunk[] {
  const hunks: DiffHunk[] = [];

  for (const change of changes) {
    const lines: DiffLine[] = [];

    // Context before
    const contextStart = Math.max(0, change.oldStart - CONTEXT_LINES);
    for (let i = contextStart; i < change.oldStart; i++) {
      lines.push({ type: "context", lineNumber: i + 1, content: oldLines[i]! });
    }

    // Removed lines
    for (let i = change.oldStart; i < change.oldEnd; i++) {
      lines.push({ type: "remove", lineNumber: i + 1, content: oldLines[i]! });
    }

    // Added lines
    for (let i = change.newStart; i < change.newEnd; i++) {
      lines.push({ type: "add", lineNumber: i + 1, content: newLines[i]! });
    }

    // Context after
    const contextEnd = Math.min(oldLines.length, change.oldEnd + CONTEXT_LINES);
    for (let i = change.oldEnd; i < contextEnd; i++) {
      lines.push({ type: "context", lineNumber: i + 1, content: oldLines[i]! });
    }

    if (lines.length > 0) {
      hunks.push({
        oldStart: change.oldStart + 1,
        newStart: change.newStart + 1,
        lines,
      });
    }
  }

  // Merge overlapping hunks
  return mergeHunks(hunks);
}

function mergeHunks(hunks: DiffHunk[]): DiffHunk[] {
  if (hunks.length <= 1) return hunks;

  const merged: DiffHunk[] = [hunks[0]!];

  for (let i = 1; i < hunks.length; i++) {
    const prev = merged[merged.length - 1]!;
    const curr = hunks[i]!;

    // If hunks overlap or are adjacent, merge them
    const prevEnd = prev.lines[prev.lines.length - 1]?.lineNumber ?? 0;
    const currStart = curr.lines[0]?.lineNumber ?? 0;

    if (currStart <= prevEnd + 1) {
      // Remove duplicate context lines
      const existingLineNums = new Set(prev.lines.map((l) => `${l.type}:${l.lineNumber}`));
      for (const line of curr.lines) {
        const key = `${line.type}:${line.lineNumber}`;
        if (!existingLineNums.has(key)) {
          prev.lines.push(line);
        }
      }
    } else {
      merged.push(curr);
    }
  }

  return merged;
}

/**
 * Format a diff result for terminal display with ANSI colors.
 */
export function formatDiffForTerminal(diff: DiffResult): string {
  if (diff.hunks.length === 0) return "";

  const lines: string[] = [];
  lines.push(`\x1b[1m${diff.filePath}\x1b[0m  \x1b[32m+${diff.additions}\x1b[0m \x1b[31m-${diff.deletions}\x1b[0m`);

  for (const hunk of diff.hunks) {
    lines.push(`\x1b[36m@@ -${hunk.oldStart} +${hunk.newStart} @@\x1b[0m`);

    for (const line of hunk.lines) {
      const num = String(line.lineNumber).padStart(4);
      switch (line.type) {
        case "add":
          lines.push(`\x1b[32m${num} + ${line.content}\x1b[0m`);
          break;
        case "remove":
          lines.push(`\x1b[31m${num} - ${line.content}\x1b[0m`);
          break;
        case "context":
          lines.push(`\x1b[90m${num}   ${line.content}\x1b[0m`);
          break;
      }
    }
  }

  return lines.join("\n");
}

/**
 * Format diff as plain text (no ANSI colors, for bot messages).
 */
export function formatDiffPlain(diff: DiffResult): string {
  if (diff.hunks.length === 0) return "No changes";

  const lines: string[] = [];
  lines.push(`${diff.filePath}  +${diff.additions} -${diff.deletions}`);

  for (const hunk of diff.hunks) {
    lines.push(`@@ -${hunk.oldStart} +${hunk.newStart} @@`);
    for (const line of hunk.lines) {
      switch (line.type) {
        case "add":    lines.push(`+ ${line.content}`); break;
        case "remove": lines.push(`- ${line.content}`); break;
        case "context": lines.push(`  ${line.content}`); break;
      }
    }
  }

  return lines.join("\n");
}

/**
 * Generate a simple unified diff string for editFile operations.
 */
export function quickDiff(oldStr: string, newStr: string, filePath: string): string {
  const diff = generateDiff(oldStr, newStr, filePath);
  return formatDiffPlain(diff);
}
