import { Hono } from "hono";
import type { AuthenticatedEnv } from "../middleware/require-auth";
import { createCheckoutUrl, createCustomerPortalUrl } from "../lib/polar";

const app = new Hono<AuthenticatedEnv>()
  .post("/checkout", async (c) => {
    const userId = c.get("userId");

    try {
      const url = await createCheckoutUrl({ customerExternalId: userId, requestUrl: c.req.url });
      return c.json({ url });
    } catch (error) {
      console.error("Polar checkout error:", error);
      const message = error instanceof Error ? error.message : "Failed to create checkout";
      return c.json({ error: message }, 500);
    }
  })
  .post("/portal", async (c) => {
    const userId = c.get("userId");

    try {
      const url = await createCustomerPortalUrl({ customerExternalId: userId, requestUrl: c.req.url });
      return c.json({ url });
    } catch (error) {
      console.error("Polar portal error:", error);
      const message = error instanceof Error ? error.message : "Failed to open portal";
      return c.json({ error: message }, 500);
    }
  })
  .get("/success", (c) => c.text("Done. You can close this tab and return to AgenticCoder."));

export default app;