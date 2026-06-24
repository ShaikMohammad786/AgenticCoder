/**
 * Ollama local model integration.
 * Auto-detects Ollama on localhost:11434 and provides model listing.
 */

const DEFAULT_OLLAMA_URL = "http://localhost:11434";

export type OllamaModel = {
  name: string;
  size: number;
  modifiedAt: string;
  digest: string;
};

let _ollamaUrl: string = DEFAULT_OLLAMA_URL;
let _ollamaAvailable: boolean | null = null;

/** Set custom Ollama base URL */
export function setOllamaUrl(url: string) {
  _ollamaUrl = url;
  _ollamaAvailable = null; // reset cache
}

/** Get current Ollama base URL */
export function getOllamaUrl(): string {
  return _ollamaUrl;
}

/**
 * Check if Ollama is running and accessible.
 * Result is cached until `setOllamaUrl` is called.
 */
export async function isOllamaAvailable(): Promise<boolean> {
  if (_ollamaAvailable !== null) return _ollamaAvailable;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${_ollamaUrl}/api/tags`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    _ollamaAvailable = res.ok;
  } catch {
    _ollamaAvailable = false;
  }

  return _ollamaAvailable;
}

/** Reset the availability cache (useful after starting Ollama) */
export function resetOllamaCache() {
  _ollamaAvailable = null;
}

/**
 * List all locally available Ollama models.
 * Returns empty array if Ollama is not running.
 */
export async function listOllamaModels(): Promise<OllamaModel[]> {
  if (!await isOllamaAvailable()) return [];

  try {
    const res = await fetch(`${_ollamaUrl}/api/tags`);
    if (!res.ok) return [];

    const data = await res.json() as { models?: Array<{
      name: string;
      size: number;
      modified_at: string;
      digest: string;
    }> };

    return (data.models ?? []).map((m) => ({
      name: m.name,
      size: m.size,
      modifiedAt: m.modified_at,
      digest: m.digest,
    }));
  } catch {
    return [];
  }
}

/**
 * Pull an Ollama model (streaming progress).
 * Returns true on success, false on failure.
 */
export async function pullOllamaModel(
  modelName: string,
  onProgress?: (status: string, completed?: number, total?: number) => void,
): Promise<boolean> {
  if (!await isOllamaAvailable()) return false;

  try {
    const res = await fetch(`${_ollamaUrl}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelName, stream: true }),
    });

    if (!res.ok || !res.body) return false;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const lines = decoder.decode(value, { stream: true }).split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const data = JSON.parse(line) as {
            status?: string;
            completed?: number;
            total?: number;
            error?: string;
          };
          if (data.error) return false;
          onProgress?.(data.status ?? "", data.completed, data.total);
        } catch {}
      }
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Format model size for display (e.g., "4.1 GB")
 */
export function formatModelSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

/**
 * Check if a model ID is an Ollama model.
 * Ollama models use the "ollama:" prefix.
 */
export function isOllamaModelId(modelId: string): boolean {
  return modelId.startsWith("ollama:");
}

/**
 * Extract the actual model name from an Ollama model ID.
 * e.g., "ollama:codellama:7b" → "codellama:7b"
 */
export function getOllamaModelName(modelId: string): string {
  return modelId.replace(/^ollama:/, "");
}
