import { clearAuth, getAuth } from "./auth";
import { config } from "./config";

/**
 * Authenticated fetch wrapper — adds Bearer token and handles 401.
 */
async function authFetch(
  input: string | URL | globalThis.Request,
  init?: RequestInit
): Promise<Response> {
  const headers = new Headers(init?.headers);
  const auth = getAuth();

  if (auth) {
    headers.set("Authorization", `Bearer ${auth.token}`);
  }

  const response = await fetch(input, { ...init, headers });
  if (response.status === 401) {
    clearAuth();
  }

  return response;
}

/**
 * Simple API client that mirrors the Hono `hc` client interface.
 * Each route has $get, $post, $delete, $patch, and $url methods.
 */
function createApiClient(baseUrl: string) {
  const url = (path: string) => `${baseUrl}${path}`;

  return {
    chat: {
      $url: () => new URL(url("/chat")),
      $post: (opts?: { json: unknown }) =>
        authFetch(url("/chat"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: opts?.json ? JSON.stringify(opts.json) : undefined,
        }),
    },
    sessions: {
      $get: () => authFetch(url("/sessions")),
      $post: (opts?: { json: unknown }) =>
        authFetch(url("/sessions"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: opts?.json ? JSON.stringify(opts.json) : undefined,
        }),
      ":id": new Proxy({} as Record<string, any>, {
        get(_target, idValue: string) {
          // Handle session-specific routes: /sessions/:id
          if (idValue === "$get" || idValue === "$delete" || idValue === "$patch") {
            // This won't be called directly — accessed via [":id"].$get({param: {id}})
            return undefined;
          }
          return undefined;
        },
      }),
    },
    billing: {
      checkout: {
        $post: () =>
          authFetch(url("/billing/checkout"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          }),
      },
      portal: {
        $post: () =>
          authFetch(url("/billing/portal"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
          }),
      },
    },
  };
}

// Build a client that supports both direct calls and parameterized routes
// e.g. apiClient.sessions[":id"].$get({ param: { id: "abc" } })
function createFullApiClient(baseUrl: string) {
  const base = createApiClient(baseUrl);
  const url = (path: string) => `${baseUrl}${path}`;

  // Override sessions to support parameterized routes
  const sessions = {
    $get: base.sessions.$get,
    $post: base.sessions.$post,
    // Proxy to handle sessions[":id"].$get(), .$delete(), .$patch()
    ":id": {
      $get: (opts: { param: { id: string } }) =>
        authFetch(url(`/sessions/${opts.param.id}`)),
      $delete: (opts: { param: { id: string } }) =>
        authFetch(url(`/sessions/${opts.param.id}`), { method: "DELETE" }),
      $patch: (opts: { param: { id: string }; json: unknown }) =>
        authFetch(url(`/sessions/${opts.param.id}`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(opts.json),
        }),
    },
  };

  return {
    chat: base.chat,
    sessions,
    billing: base.billing,
  };
}

export const apiClient = createFullApiClient(config.apiUrl);

// Type for inferring response types (replaces Hono's InferResponseType)
export type ApiResponse<T> = T;