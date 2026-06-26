import { createClerkClient } from "@clerk/backend";
import type { Request as ExpressRequest } from "express";

if (!process.env.CLERK_SECRET_KEY) {
  throw new Error("CLERK_SECRET_KEY environment variable is required");
}

if (!process.env.CLERK_PUBLISHABLE_KEY) {
  throw new Error("CLERK_PUBLISHABLE_KEY environment variable is required");
}

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY,
  publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
});

/**
 * Convert an Express request to a Web Fetch Request for Clerk authentication.
 * Clerk's authenticateRequest expects the Web Fetch API Request type.
 */
function toWebRequest(req: ExpressRequest): globalThis.Request {
  const protocol = req.protocol;
  const host = req.get("host") || "localhost:3000";
  const url = `${protocol}://${host}${req.originalUrl}`;

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value) {
      if (Array.isArray(value)) {
        value.forEach((v) => headers.append(key, v));
      } else {
        headers.set(key, value);
      }
    }
  }

  return new globalThis.Request(url, {
    method: req.method,
    headers,
  });
}

export async function authenticateOAuthRequest(req: ExpressRequest) {
  const webRequest = toWebRequest(req);
  const requestState = await clerkClient.authenticateRequest(webRequest, {
    acceptsToken: "oauth_token",
  });

  if (!requestState.isAuthenticated) {
    return null;
  }

  const auth = requestState.toAuth();
  if (auth.tokenType !== "oauth_token" || !auth.userId) {
    return null;
  }

  return { userId: auth.userId };
};