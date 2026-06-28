function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseErrorBody(body: unknown): string | undefined {
  if (typeof body !== "string" || body.trim().length === 0) return undefined;

  try {
    return formatErrorMessage(JSON.parse(body) as unknown);
  } catch {
    return body;
  }
}

export function formatErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;

  if (error instanceof Error && error.message && error.message !== "[object Object]") {
    return error.message;
  }

  if (isPlainObject(error)) {
    const bodyMessage = parseErrorBody(error.responseBody);
    if (bodyMessage) return bodyMessage;

    const message = error.message;
    if (typeof message === "string" && message && message !== "[object Object]") {
      return message;
    }

    const nestedError = error.error;
    if (typeof nestedError === "string" && nestedError) return nestedError;
    if (isPlainObject(nestedError)) {
      const nestedMessage = nestedError.message;
      if (typeof nestedMessage === "string" && nestedMessage) return nestedMessage;
    }

    const cause = error.cause;
    if (cause != null && cause !== error) {
      const causeMessage = formatErrorMessage(cause);
      if (causeMessage && causeMessage !== "[object Object]") return causeMessage;
    }

    const statusCode = error.statusCode ?? error.status;
    if (statusCode != null) {
      return `Request failed with status ${String(statusCode)}`;
    }

    try {
      return JSON.stringify(error);
    } catch {
      return "Unknown object error";
    }
  }

  if (error instanceof Error) {
    return error.message || "Unknown error";
  }

  return String(error);
}
