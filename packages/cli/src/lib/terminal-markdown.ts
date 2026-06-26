/**
 * Markdown renderer for terminal — wraps marked + marked-terminal.
 * Converts markdown text → ANSI-styled terminal string.
 */

import { Marked } from "marked";
import TerminalRenderer from "marked-terminal";

// Create a dedicated marked instance with terminal renderer
const terminalMarked = new Marked();

terminalMarked.setOptions({
  renderer: new TerminalRenderer({
    // Code blocks
    code: (code: string) => code,
    // Styling
    showSectionPrefix: false,
    reflowText: true,
    width: 80,
    // Colors — match our terminal aesthetic
    tab: 2,
    emoji: true,
  }) as any,
});

/**
 * Render markdown text to ANSI-styled terminal string.
 * Falls back to raw text if parsing fails.
 */
export function renderMarkdown(text: string): string {
  if (!text || !text.trim()) return text;

  try {
    const rendered = terminalMarked.parse(text);
    if (typeof rendered === "string") {
      // Trim trailing whitespace/newlines that marked adds
      return rendered.replace(/\n{3,}/g, "\n\n").trimEnd();
    }
    // If marked returns a Promise (async mode), fall back
    return text;
  } catch {
    return text;
  }
}

/**
 * Check if text contains any markdown syntax worth rendering.
 * Simple heuristic to avoid processing plain text.
 */
export function hasMarkdownSyntax(text: string): boolean {
  if (!text) return false;
  return /[#*`\[\]>\-]/.test(text) && (
    /^#{1,6}\s/m.test(text) ||       // Headers
    /\*\*.+\*\*/m.test(text) ||       // Bold
    /`.+`/m.test(text) ||             // Inline code
    /^```/m.test(text) ||             // Code block
    /^[-*]\s/m.test(text) ||          // Lists
    /^\d+\.\s/m.test(text) ||         // Numbered lists
    /^>/m.test(text)                   // Blockquotes
  );
}
