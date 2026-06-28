type ErrorResponse = {
  json: () => Promise<unknown>;
  status: number;
  statusText: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getPayloadErrorMessage(data: unknown): string | undefined {
  if (typeof data === "string" && data.length > 0) return data;

  if (!isPlainObject(data)) return undefined;

  const error = data.error;
  if (typeof error === "string" && error.length > 0) return error;
  if (isPlainObject(error)) {
    const nestedMessage = error.message;
    if (typeof nestedMessage === "string" && nestedMessage.length > 0) {
      return nestedMessage;
    }
  }

  const message = data.message;
  if (typeof message === "string" && message.length > 0) return message;

  return undefined;
}

export async function getErrorMessage(response: ErrorResponse) {
  try {
    const message = getPayloadErrorMessage(await response.json());
    if (message) return message;
  } catch {
    // Ignore invalid error payloads and fall back to the status text below.
  }

  return response.statusText || `Request failed with status ${response.status}`;
};
