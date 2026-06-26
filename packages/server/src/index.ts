import express from "express";
import * as Sentry from "@sentry/bun";

import { requireAuth } from "./middleware/require-auth";
import { rateLimit } from "./middleware/rate-limit";
import sessions from "./routes/sessions";
import chat from "./routes/chat";
import auth from "./routes/auth";
import billing from "./routes/billing";

// Initialize Sentry
Sentry.init({
  dsn: "https://8c90f2dfdc449517c3d17886f2f5ce28@o4511562725392384.ingest.us.sentry.io/4511562734239744",
  tracesSampleRate: 1.0,
});

const app = express();

// Parse JSON bodies
app.use(express.json({ limit: "10mb" }));

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled server error", err);
  res.status(500).json({ error: "Internal server error" });
});

// Apply auth middleware to protected routes
app.use("/sessions", requireAuth);
app.use("/chat", requireAuth);
app.use("/chat", rateLimit);
app.use("/billing/checkout", requireAuth);
app.use("/billing/portal", requireAuth);

// Mount routes
app.use("/auth", auth);
app.use("/billing", billing);
app.use("/sessions", sessions);
app.use("/chat", chat);

const PORT = 3000;

app.listen(PORT, () => {
  console.log(`AgenticCoder server running on port ${PORT}`);
});

export default app;