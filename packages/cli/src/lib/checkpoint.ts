// Git-based checkpoint system

/**
 * Git-based checkpoint system for undo/redo of AI changes.
 * Creates tagged stashes before each AI interaction so users can revert.
 */

const CHECKPOINT_PREFIX = "agenticcoder-checkpoint-";

/**
 * Create a checkpoint (stash) of the current working tree state.
 * Called automatically before each AI response.
 */
export async function createCheckpoint(): Promise<string | null> {
  try {
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

    // Stage all changes
    const addProc = Bun.spawn(["git", "add", "-A"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    await addProc.exited;

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

    // Immediately pop the stash so the working tree is unchanged
    // but the stash ref remains in the reflog
    const popProc = Bun.spawn(["git", "stash", "pop"], {
      cwd: process.cwd(),
      stdout: "pipe",
      stderr: "pipe",
    });
    await popProc.exited;

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
