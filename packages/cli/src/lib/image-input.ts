/**
 * Image Input — detect and inline images from user messages.
 * Supports @file.png syntax for attaching screenshots/images to prompts.
 * 
 * Converts images to base64 data URIs for inclusion in AI messages.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";

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
} {
  const root = cwd ?? process.cwd();
  const images: ImageAttachment[] = [];
  const matches = [...message.matchAll(IMAGE_MENTION_REGEX)];

  if (matches.length === 0) {
    return { cleanedMessage: message, images: [] };
  }

  let cleanedMessage = message;

  for (const match of matches) {
    const filePath = match[1]!;
    const absPath = resolve(root, filePath);

    if (!existsSync(absPath)) continue;

    try {
      const ext = extname(absPath).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(ext)) continue;

      const mimeType = getMimeType(ext);
      const buffer = readFileSync(absPath);
      const base64 = buffer.toString("base64");

      images.push({ path: absPath, mimeType, base64 });
      cleanedMessage = cleanedMessage.replace(match[0], `[image: ${filePath}]`);
    } catch {
      // Skip unreadable files
    }
  }

  return { cleanedMessage, images };
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
): Promise<{ text: string; images: ImageAttachment[] }> {
  const result = extractImageAttachments(message, cwd);
  return { text: result.cleanedMessage, images: result.images };
}
