// Git-based checkpoint system

/**
 * Git-based checkpoint system for undo/redo of AI changes.
 * Creates tagged stashes before each AI interaction so users can revert.
 */

const CHECKPOINT_PREFIX = "agenticcoder-checkpoint-";

// Cache git availability check
let _gitAvailable: boolean | null = null;
async function isGitAvailable(): Promise<boolean> {
  if (_gitAvailable !== null) return _gitAvailable;
  try {
    const proc = Bun.spawn(["git", "rev-parse", "--git-dir"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    _gitAvailable = exitCode === 0;
  } catch {
    _gitAvailable = false;
  }
  return _gitAvailable;
}

/**
 * Create a checkpoint (stash) of the current working tree state.
 * Called automatically before each AI response.
 */
export async function createCheckpoint(): Promise<string | null> {
  try {
    if (!await isGitAvailable()) return null;
    // Check if there are any changes to stash
    const statusProc = Bun.spawn(["git", "status", "--porcelain"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    const statusOutput = await new Response(statusProc.stdout).text();
    await statusProc.exited;

    if (!statusOutput.trim()) {
      return null; // Nothing to checkpoint
    }

    // Create stash with a tagged name
    const checkpointId = `${CHECKPOINT_PREFIX}${Date.now()}`;
    const stashProc = Bun.spawn(
      ["git", "stash", "push", "-m", checkpointId, "--include-untracked"],
      {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
      }
    );
    const stashOutput = await new Response(stashProc.stdout).text();
    await stashProc.exited;

    if (stashOutput.includes("No local changes")) {
      return null;
    }

    // Immediately apply the stash back so the working tree is unchanged.
    // Use apply instead of pop so the checkpoint remains available.
    const applyProc = Bun.spawn(["git", "stash", "apply", "--index", "stash@{0}"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    const applyCode = await applyProc.exited;

    if (applyCode !== 0) {
      const fallbackApplyProc = Bun.spawn(["git", "stash", "apply", "stash@{0}"], {
        cwd: process.cwd(),
        stdout: "pipe",
        stderr: "pipe",
      });
      const fallbackApplyCode = await fallbackApplyProc.exited;
      if (fallbackApplyCode !== 0) {
        return null;
      }
    }

    return checkpointId;
  } catch {
    return null;
  }
}

/**
 * Undo all changes since the last checkpoint by restoring the stashed state.
 */
export async function undoToLastCheckpoint(): Promise<{
  success: boolean;
  message: string;
}> {
  if (!await isGitAvailable()) {
    return { success: false, message: "Git is not available in this directory" };
  }
  try {
    // List stashes and find the latest checkpoint
    const listProc = Bun.spawn(["git", "stash", "list"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    const stashList = await new Response(listProc.stdout).text();
    await listProc.exited;

    const lines = stashList.trim().split("\n").filter(Boolean);
    const checkpointLine = lines.find((line) =>
      line.includes(CHECKPOINT_PREFIX)
    );

    if (!checkpointLine) {
      return {
        success: false,
        message: "No checkpoint found. Nothing to undo.",
      };
    }

    // Extract stash ref (e.g., "stash@{0}")
    const stashRef = checkpointLine.match(/stash@\{\d+\}/)?.[0];
    if (!stashRef) {
      return { success: false, message: "Could not parse checkpoint ref." };
    }

    // Hard reset working tree, then apply the checkpoint stash
    const resetProc = Bun.spawn(["git", "checkout", "--", "."], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    await resetProc.exited;

    // Clean untracked files
    const cleanProc = Bun.spawn(["git", "clean", "-fd"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    await cleanProc.exited;

    // Apply the checkpoint stash
    const applyProc = Bun.spawn(["git", "stash", "apply", stashRef], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    const applyCode = await applyProc.exited;

    if (applyCode !== 0) {
      return {
        success: false,
        message: "Failed to apply checkpoint — conflicts may exist.",
      };
    }

    return {
      success: true,
      message: "Reverted to last checkpoint successfully.",
    };
  } catch (error) {
    return {
      success: false,
      message:
        error instanceof Error ? error.message : "Unknown error during undo.",
    };
  }
}

/**
 * Remove old checkpoint stashes to prevent accumulation.
 * Keeps the most recent N checkpoints and drops the rest.
 */
export async function cleanupCheckpoints(keepCount: number = 5): Promise<void> {
  try {
    const listProc = Bun.spawn(["git", "stash", "list"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    const stashList = await new Response(listProc.stdout).text();
    await listProc.exited;

    const lines = stashList.trim().split("\n").filter(Boolean);
    const checkpointLines = lines.filter((line) =>
      line.includes(CHECKPOINT_PREFIX)
    );

    // Drop old checkpoints beyond keepCount
    const toDrop = checkpointLines.slice(keepCount);
    for (const line of toDrop) {
      const stashRef = line.match(/stash@\{\d+\}/)?.[0];
      if (stashRef) {
        const dropProc = Bun.spawn(["git", "stash", "drop", stashRef], {
          cwd: process.cwd(),
          stdout: "pipe",
          stderr: "pipe",
        });
        await dropProc.exited;
      }
    }
  } catch {
    // Ignore cleanup failures
  }
}

/**
 * List all checkpoints with their timestamps and stash refs.
 */
export async function listCheckpoints(): Promise<{
  checkpoints: { index: number; id: string; timeAgo: string; stashRef: string }[];
  message?: string;
}> {
  if (!await isGitAvailable()) {
    return { checkpoints: [], message: "Git is not available in this directory" };
  }

  try {
    const listProc = Bun.spawn(["git", "stash", "list"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    const stashList = await new Response(listProc.stdout).text();
    await listProc.exited;

    const lines = stashList.trim().split("\n").filter(Boolean);
    const checkpoints: { index: number; id: string; timeAgo: string; stashRef: string }[] = [];

    let idx = 0;
    for (const line of lines) {
      if (!line.includes(CHECKPOINT_PREFIX)) continue;

      const stashRef = line.match(/stash@\{\d+\}/)?.[0] ?? "";
      // Extract timestamp from checkpoint id
      const tsMatch = line.match(new RegExp(`${CHECKPOINT_PREFIX}(\\d+)`));
      const ts = tsMatch ? Number(tsMatch[1]) : 0;
      const timeAgo = ts > 0 ? formatTimeAgo(ts) : "unknown";

      checkpoints.push({
        index: idx++,
        id: `${CHECKPOINT_PREFIX}${ts}`,
        timeAgo,
        stashRef,
      });
    }

    return { checkpoints };
  } catch {
    return { checkpoints: [], message: "Failed to list checkpoints" };
  }
}

/**
 * Restore a specific checkpoint by index.
 */
export async function restoreCheckpoint(index: number): Promise<{
  success: boolean;
  message: string;
}> {
  if (!await isGitAvailable()) {
    return { success: false, message: "Git is not available in this directory" };
  }

  const { checkpoints } = await listCheckpoints();

  if (checkpoints.length === 0) {
    return { success: false, message: "No checkpoints found." };
  }

  const checkpoint = checkpoints[index];
  if (!checkpoint) {
    return { success: false, message: `Checkpoint #${index} not found. Available: 0-${checkpoints.length - 1}` };
  }

  try {
    // Hard reset working tree
    const resetProc = Bun.spawn(["git", "checkout", "--", "."], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    await resetProc.exited;

    // Clean untracked files
    const cleanProc = Bun.spawn(["git", "clean", "-fd"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    await cleanProc.exited;

    // Apply the checkpoint stash
    const applyProc = Bun.spawn(["git", "stash", "apply", checkpoint.stashRef], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    const applyCode = await applyProc.exited;

    if (applyCode !== 0) {
      return { success: false, message: "Failed to apply checkpoint — conflicts may exist." };
    }

    return { success: true, message: `Restored checkpoint #${index} (${checkpoint.timeAgo})` };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "Unknown error during restore.",
    };
  }
}

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

