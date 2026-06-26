/**
 * Diff Dialog — Shows git diff with colored +/- lines in a scrollable dialog.
 * Similar to how Claude Code shows diffs.
 */

import { useState, useEffect } from "react";
import { TextAttributes } from "@opentui/core";
import { useTheme } from "../../providers/theme";

type DiffFile = {
  path: string;
  additions: number;
  deletions: number;
  lines: { type: "add" | "del" | "context" | "header" | "hunk"; text: string }[];
};

function parseDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;

  for (const line of raw.split("\n")) {
    if (line.startsWith("diff --git")) {
      const match = line.match(/b\/(.+)$/);
      current = {
        path: match?.[1] ?? "unknown",
        additions: 0,
        deletions: 0,
        lines: [],
      };
      files.push(current);
      continue;
    }

    if (!current) continue;

    if (line.startsWith("@@")) {
      current.lines.push({ type: "hunk", text: line });
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      current.additions++;
      current.lines.push({ type: "add", text: line });
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      current.deletions++;
      current.lines.push({ type: "del", text: line });
    } else if (line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++") || line.startsWith("new file") || line.startsWith("deleted file")) {
      current.lines.push({ type: "header", text: line });
    } else {
      current.lines.push({ type: "context", text: line });
    }
  }

  return files;
}

export const DiffDialogContent = () => {
  const { colors } = useTheme();
  const [files, setFiles] = useState<DiffFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const proc = Bun.spawn(["git", "diff"], {
          cwd: process.cwd(),
          stdout: "pipe",
          stderr: "pipe",
        });

        const output = await new Response(proc.stdout).text();
        const errOutput = await new Response(proc.stderr).text();
        const exitCode = await proc.exited;

        if (ignore) return;

        if (exitCode !== 0) {
          setError(errOutput.trim() || "git diff failed");
          setLoading(false);
          return;
        }

        const parsed = parseDiff(output);
        setFiles(parsed);
        setLoading(false);
      } catch (err) {
        if (!ignore) {
          setError(err instanceof Error ? err.message : "Failed to run git diff");
          setLoading(false);
        }
      }
    })();
    return () => { ignore = true; };
  }, []);

  if (loading) {
    return (
      <box paddingX={1} paddingY={1}>
        <text attributes={TextAttributes.DIM}>Running git diff...</text>
      </box>
    );
  }

  if (error) {
    return (
      <box paddingX={1} paddingY={1}>
        <text fg={colors.error}>Error: {error}</text>
      </box>
    );
  }

  if (files.length === 0) {
    return (
      <box paddingX={1} paddingY={1} flexDirection="column" gap={1}>
        <text fg={colors.success}>✓ No changes detected</text>
        <text attributes={TextAttributes.DIM}>Working tree is clean</text>
      </box>
    );
  }

  // Summary line
  const totalAdd = files.reduce((s, f) => s + f.additions, 0);
  const totalDel = files.reduce((s, f) => s + f.deletions, 0);

  return (
    <box flexDirection="column" gap={0}>
      {/* Summary */}
      <box paddingBottom={1}>
        <text attributes={TextAttributes.DIM}>
          {files.length} file{files.length > 1 ? "s" : ""} changed
          {"  "}
        </text>
        <text fg="#82E0AA">+{totalAdd} </text>
        <text fg="#E74C5E">-{totalDel}</text>
      </box>

      {/* File list with diffs */}
      <scrollbox height={16}>
        {files.map((file, fi) => (
          <box key={file.path} flexDirection="column" paddingBottom={1}>
            {/* File header */}
            <box>
              <text attributes={TextAttributes.BOLD} fg={colors.info}>
                {"  "}{file.path}
              </text>
              <text attributes={TextAttributes.DIM}>
                {"  "}
              </text>
              <text fg="#82E0AA">+{file.additions}</text>
              <text attributes={TextAttributes.DIM}> </text>
              <text fg="#E74C5E">-{file.deletions}</text>
            </box>

            {/* Diff lines — show max 30 lines per file */}
            {file.lines.slice(0, 30).map((line, li) => {
              const fg =
                line.type === "add" ? "#82E0AA" :
                line.type === "del" ? "#E74C5E" :
                line.type === "hunk" ? "#89B4FA" :
                line.type === "header" ? colors.info :
                undefined;
              const bg =
                line.type === "add" ? "#1a2e1a" :
                line.type === "del" ? "#2e1a1a" :
                undefined;
              const attrs = line.type === "context" ? TextAttributes.DIM : undefined;

              return (
                <box key={`${fi}-${li}`} height={1} overflow="hidden">
                  <text
                    fg={fg}
                    backgroundColor={bg}
                    attributes={attrs}
                  >
                    {"  "}{line.text}
                  </text>
                </box>
              );
            })}
            {file.lines.length > 30 && (
              <text attributes={TextAttributes.DIM}>
                {"    "}... {file.lines.length - 30} more lines
              </text>
            )}
          </box>
        ))}
      </scrollbox>
    </box>
  );
};
