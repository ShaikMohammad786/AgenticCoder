/**
 * Image Input — detect and inline images from user messages.
 * Supports @file.png syntax for attaching screenshots/images to prompts.
 * 
 * Converts images to base64 data URIs for inclusion in AI messages.
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, extname } from "node:path";

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB limit

const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg",
]);

const IMAGE_MENTION_REGEX = /@([\w.\/\\-]+\.(png|jpg|jpeg|gif|webp|bmp|svg))/gi;

interface ImageAttachment {
  path: string;
  mimeType: string;
  base64: string;
}

/**
 * Extract image references from a message (e.g., @screenshot.png).
 * Returns the cleaned message text and any image attachments found.
 */
export function extractImageAttachments(
  message: string,
  cwd?: string,
): {
  cleanedMessage: string;
  images: ImageAttachment[];
  warnings: string[];
} {
  const root = cwd ?? process.cwd();
  const images: ImageAttachment[] = [];
  const warnings: string[] = [];
  const matches = [...message.matchAll(IMAGE_MENTION_REGEX)];

  if (matches.length === 0) {
    return { cleanedMessage: message, images: [], warnings: [] };
  }

  let cleanedMessage = message;

  for (const match of matches) {
    const filePath = match[1]!;
    const absPath = resolve(root, filePath);

    if (!existsSync(absPath)) {
      warnings.push(`File not found: ${filePath}`);
      continue;
    }

    try {
      const ext = extname(absPath).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(ext)) continue;

      // Check file size before reading
      const fileSize = statSync(absPath).size;
      if (fileSize > MAX_IMAGE_SIZE) {
        warnings.push(`Image too large (${(fileSize / 1024 / 1024).toFixed(1)}MB): ${filePath}`);
        continue;
      }

      const mimeType = getMimeType(ext);
      const buffer = readFileSync(absPath);
      const base64 = buffer.toString("base64");

      images.push({ path: absPath, mimeType, base64 });
      cleanedMessage = cleanedMessage.replace(match[0], `[image: ${filePath}]`);
    } catch {
      warnings.push(`Could not read: ${filePath}`);
    }
  }

  return { cleanedMessage, images, warnings };
}

function getMimeType(ext: string): string {
  const map: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
  };
  return map[ext] ?? "image/png";
}

/**
 * Check if a message contains any image references.
 */
export function hasImageReferences(message: string): boolean {
  return IMAGE_MENTION_REGEX.test(message);
}

/**
 * Alias for extractImageAttachments with the return shape expected by use-chat.ts
 */
export async function extractImageMentions(
  message: string,
  cwd?: string,
): Promise<{ text: string; images: ImageAttachment[]; warnings: string[] }> {
  const result = extractImageAttachments(message, cwd);
  return { text: result.cleanedMessage, images: result.images, warnings: result.warnings };
}

/**
 * Capture a screenshot and return it as a base64 image attachment.
 * Works on Windows (PowerShell), macOS (screencapture), and Linux (gnome-screenshot).
 */
export async function captureScreenshot(): Promise<{
  image: ImageAttachment | null;
  error?: string;
}> {
  const { join } = await import("path");
  const { tmpdir } = await import("os");
  const { readFileSync, unlinkSync, existsSync } = await import("fs");

  const tmpPath = join(tmpdir(), `agenticcoder-screenshot-${Date.now()}.png`);

  try {
    let cmd: string[];
    const platform = process.platform;

    if (platform === "win32") {
      // PowerShell screenshot using .NET
      cmd = [
        "powershell", "-NoProfile", "-Command",
        `Add-Type -AssemblyName System.Windows.Forms; ` +
        `$screen = [System.Windows.Forms.Screen]::PrimaryScreen; ` +
        `$bitmap = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height); ` +
        `$graphics = [System.Drawing.Graphics]::FromImage($bitmap); ` +
        `$graphics.CopyFromScreen($screen.Bounds.Location, [System.Drawing.Point]::Empty, $screen.Bounds.Size); ` +
        `$bitmap.Save('${tmpPath.replace(/'/g, "''")}'); ` +
        `$graphics.Dispose(); $bitmap.Dispose();`,
      ];
    } else if (platform === "darwin") {
      cmd = ["screencapture", "-x", tmpPath];
    } else {
      // Linux — try gnome-screenshot, fallback to scrot
      cmd = ["gnome-screenshot", "-f", tmpPath];
    }

    const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
    const exitCode = await proc.exited;

    if (exitCode !== 0 || !existsSync(tmpPath)) {
      return { image: null, error: "Screenshot capture failed" };
    }

    const buffer = readFileSync(tmpPath);
    const base64 = buffer.toString("base64");

    // Cleanup temp file
    try { unlinkSync(tmpPath); } catch {}

    return {
      image: {
        path: "screenshot.png",
        mimeType: "image/png",
        base64,
      },
    };
  } catch (err) {
    try { unlinkSync(tmpPath); } catch {}
    return {
      image: null,
      error: err instanceof Error ? err.message : "Screenshot failed",
    };
  }
}

/**
 * Capture image from clipboard (if available).
 */
export async function captureClipboardImage(): Promise<{
  image: ImageAttachment | null;
  error?: string;
}> {
  const { join } = await import("path");
  const { tmpdir } = await import("os");
  const { readFileSync, unlinkSync, existsSync } = await import("fs");

  const tmpPath = join(tmpdir(), `agenticcoder-clipboard-${Date.now()}.png`);

  try {
    const platform = process.platform;
    let cmd: string[];

    if (platform === "win32") {
      cmd = [
        "powershell", "-NoProfile", "-Command",
        `$img = Get-Clipboard -Format Image; ` +
        `if ($img) { $img.Save('${tmpPath.replace(/'/g, "''")}') } ` +
        `else { exit 1 }`,
      ];
    } else if (platform === "darwin") {
      cmd = ["bash", "-c", `osascript -e 'set the clipboard to (the clipboard as «class PNGf»)' && pbpaste > '${tmpPath}'`];
    } else {
      cmd = ["xclip", "-selection", "clipboard", "-t", "image/png", "-o", tmpPath];
    }

    const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
    const exitCode = await proc.exited;

    if (exitCode !== 0 || !existsSync(tmpPath)) {
      return { image: null, error: "No image in clipboard" };
    }

    const buffer = readFileSync(tmpPath);
    if (buffer.length < 100) {
      try { unlinkSync(tmpPath); } catch {}
      return { image: null, error: "No image in clipboard" };
    }

    const base64 = buffer.toString("base64");
    try { unlinkSync(tmpPath); } catch {}

    return {
      image: {
        path: "clipboard.png",
        mimeType: "image/png",
        base64,
      },
    };
  } catch (err) {
    try { unlinkSync(tmpPath); } catch {}
    return {
      image: null,
      error: err instanceof Error ? err.message : "Clipboard capture failed",
    };
  }
}
