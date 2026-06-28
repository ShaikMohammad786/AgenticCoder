export async function writeClipboard(text: string): Promise<void> {
  if (process.platform === "win32") {
    await writeClipboardWithProcess(
      ["powershell", "-NoProfile", "-Command", "Set-Clipboard -Value ([Console]::In.ReadToEnd())"],
      text,
    );
    return;
  }

  if (process.platform === "darwin") {
    await writeClipboardWithProcess(["pbcopy"], text);
    return;
  }

  const linuxCommands = [
    ["wl-copy"],
    ["xclip", "-selection", "clipboard"],
    ["xsel", "--clipboard", "--input"],
  ];

  let lastError: unknown;
  for (const command of linuxCommands) {
    try {
      await writeClipboardWithProcess(command, text);
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("No clipboard command found");
}

async function writeClipboardWithProcess(command: string[], text: string): Promise<void> {
  const proc = Bun.spawn(command, { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  const stdin = proc.stdin as unknown;

  if (stdin && typeof (stdin as { getWriter?: unknown }).getWriter === "function") {
    const writer = (stdin as WritableStream<Uint8Array>).getWriter();
    await writer.write(new TextEncoder().encode(text));
    await writer.close();
  } else if (stdin && typeof (stdin as { write?: unknown }).write === "function") {
    await new Promise<void>((resolve, reject) => {
      const writable = stdin as {
        write: (chunk: string) => boolean | number | void;
        end: (callback?: () => void) => void;
        once?: (event: string, callback: (error: Error) => void) => void;
      };
      writable.once?.("error", reject);
      try {
        writable.write(text);
        writable.end(resolve);
      } catch (error) {
        reject(error);
      }
    });
  } else {
    throw new Error("Clipboard process stdin is not writable");
  }

  const [exitCode, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stderr).text(),
  ]);

  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `${command[0]} exited with code ${exitCode}`);
  }
}
