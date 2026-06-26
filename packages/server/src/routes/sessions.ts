import { Router } from "express";
import type { Request, Response } from "express";
import { z } from "zod";
import { db } from "@agenticcoder/database/client";
import type { AuthenticatedRequest } from "../middleware/require-auth";
import { requireCreditsBalance } from "../middleware/require-credits-balance";

const createSessionSchema = z.object({
  title: z.string(),
});

const updateTitleSchema = z.object({
  title: z.string().min(1).max(200),
});

const router = Router();

// GET / — List all sessions
router.get("/", async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;

  const sessions = await db.session.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  res.json(sessions);
});

// GET /:id — Get single session
router.get("/:id", async (req: Request, res: Response) => {
  const id = req.params.id;
  const userId = (req as AuthenticatedRequest).userId;
  
  const session = await db.session.findUnique({
    where: { id, userId },
  });

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  res.json(session);
});

// POST / — Create new session
router.post("/", requireCreditsBalance, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = createSessionSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body" });
    return;
  }

  const session = await db.session.create({
    data: {
      ...parsed.data,
      userId,
    },
  });

  res.status(201).json(session);
});

// DELETE /:id — Delete session
router.delete("/:id", async (req: Request, res: Response) => {
  const id = req.params.id;
  const userId = (req as AuthenticatedRequest).userId;

  const session = await db.session.findUnique({
    where: { id, userId },
  });

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  await db.session.delete({
    where: { id, userId },
  });

  res.json({ success: true });
});

// PATCH /:id — Update session title
router.patch("/:id", async (req: Request, res: Response) => {
  const id = req.params.id;
  const userId = (req as AuthenticatedRequest).userId;
  const parsed = updateTitleSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Invalid title" });
    return;
  }

  const session = await db.session.findUnique({
    where: { id, userId },
  });

  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const updated = await db.session.update({
    where: { id, userId },
    data: { title: parsed.data.title },
  });

  res.json(updated);
});

export default router;