import { Router } from "express";
import type { Request, Response } from "express";
import type { AuthenticatedRequest } from "../middleware/require-auth";
import { createCheckoutUrl, createCustomerPortalUrl } from "../lib/polar";

const router = Router();

router.post("/checkout", async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;

  try {
    const fullUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
    const url = await createCheckoutUrl({ customerExternalId: userId, requestUrl: fullUrl });
    res.json({ url });
  } catch (error) {
    console.error("Polar checkout error:", error);
    const message = error instanceof Error ? error.message : "Failed to create checkout";
    res.status(500).json({ error: message });
  }
});

router.post("/portal", async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;

  try {
    const fullUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
    const url = await createCustomerPortalUrl({ customerExternalId: userId, requestUrl: fullUrl });
    res.json({ url });
  } catch (error) {
    console.error("Polar portal error:", error);
    const message = error instanceof Error ? error.message : "Failed to open portal";
    res.status(500).json({ error: message });
  }
});

router.get("/success", (_req: Request, res: Response) => {
  res.send("Done. You can close this tab and return to AgenticCoder.");
});

export default router;