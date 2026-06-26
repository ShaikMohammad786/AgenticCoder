import type { Request, Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "./require-auth";
import { getAvailableCreditsBalance } from "../lib/polar";

export const requireCreditsBalance = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as AuthenticatedRequest).userId;
    const creditsBalance = await getAvailableCreditsBalance(userId);

    // This is a simple launch-time gate: only start new work when the customer
    // still has credits left. It does not reserve the full eventual cost of the
    // request, so low-volume apps may tolerate small overspend on edge cases.
    if (creditsBalance <= 0) {
      res.status(402).json({ error: "No credits remaining. Run /upgrade to buy more credits." });
      return;
    }

    next();
  } catch (error) {
    console.error("Credits balance check failed:", error);
    res.status(503).json({ error: "Unable to verify credits balance right now." });
  }
};