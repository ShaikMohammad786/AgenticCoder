import type { Request, Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "./require-auth";

// Simple sliding-window rate limiter per userId
// No external dependencies — uses in-memory Map
const WINDOW_MS = 60_000;     // 1 minute window
const MAX_REQUESTS = 20;       // max requests per window

type WindowEntry = {
  count: number;
  resetAt: number;
};

const windows = new Map<string, WindowEntry>();

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of windows) {
    if (now > entry.resetAt) windows.delete(key);
  }
}, 5 * 60_000);

export const rateLimit = (req: Request, res: Response, next: NextFunction) => {
  const userId = (req as AuthenticatedRequest).userId;
  if (!userId) {
    next();
    return;
  }

  const now = Date.now();
  let entry = windows.get(userId);

  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    windows.set(userId, entry);
  }

  entry.count++;

  if (entry.count > MAX_REQUESTS) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    res.set("Retry-After", String(retryAfter));
    res.status(429).json({ 
      error: `Rate limit exceeded. Try again in ${retryAfter}s.` 
    });
    return;
  }

  next();
};
