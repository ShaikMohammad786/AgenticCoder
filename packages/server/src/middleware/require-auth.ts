import type { Request, Response, NextFunction } from "express";
import { authenticateOAuthRequest } from "../lib/auth";

// Extend Express Request to include userId
export interface AuthenticatedRequest extends Request {
  userId: string;
}

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const auth = await authenticateOAuthRequest(req);
    if (!auth) {
      res.status(401).json({ error: "Unauthorized. Run /login to continue." });
      return;
    }

    (req as AuthenticatedRequest).userId = auth.userId;
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized. Run /login to continue." });
  }
};