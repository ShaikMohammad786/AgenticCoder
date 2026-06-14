/**
 * Central config for the CLI — all environment-driven values in one place.
 * 
 * Usage:
 *   import { config } from "../lib/config";
 *   fetch(`${config.apiUrl}/sessions`);
 */

export const config = {
  /** Backend API base URL (no trailing slash) */
  apiUrl: (process.env.API_URL ?? "http://localhost:3000").replace(/\/+$/, ""),
} as const;
