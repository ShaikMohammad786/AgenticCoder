import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { sentry } from "@sentry/hono/bun";

import { requireAuth } from "./middleware/require-auth";
import { rateLimit } from "./middleware/rate-limit";
import sessions from "./routes/sessions";
import chat from "./routes/chat";
import auth from "./routes/auth";
import billing from "./routes/billing";

const app = new Hono();

app.use(
  sentry(app, {
    dsn: "https://8c90f2dfdc449517c3d17886f2f5ce28@o4511562725392384.ingest.us.sentry.io/4511562734239744",
    tracesSampleRate: 1.0,
    enableLogs: true,
    // To disable sending user data, uncomment the line below. For more info visit:
    // https://docs.sentry.io/platforms/javascript/guides/hono/configuration/options/#dataCollection
    // dataCollection: { userInfo: false },
  }),
);


app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ 
      error: error.message || "Request failed",
    }, error.status);
  };

  console.error("Unhandled server error", error);
  return c.json({ error: "Internal server error" }, 500);
});

app.use("/sessions/*", requireAuth);
app.use("/chat/*", requireAuth);
app.use("/chat/*", rateLimit);
app.use("/billing/checkout", requireAuth);
app.use("/billing/portal", requireAuth);

const routes = app
  .route("/auth", auth)
  .route("/billing", billing)
  .route("/sessions", sessions)
  .route("/chat", chat);

export type AppType = typeof routes;
// idleTimeout must be high, otherwise LLM tool calls might not complete
export default { port: 3000, fetch: app.fetch, idleTimeout: 255 };