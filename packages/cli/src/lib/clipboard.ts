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
  const writer = proc.stdin.getWriter();
  await writer.write(new TextEncoder().encode(text));
  await writer.close();

  const [exitCode, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stderr).text(),
  ]);

  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `${command[0]} exited with code ${exitCode}`);
  }
}
