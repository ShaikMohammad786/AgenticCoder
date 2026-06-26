import { Router } from "express";
import type { Request, Response } from "express";

const router = Router();

router.get("/callback", (req: Request, res: Response) => {
  const code = req.query.code as string | undefined;
  const state = req.query.state as string | undefined;
  const error = req.query.error as string | undefined;
  const errorDescription = req.query.error_description as string | undefined;

  if (error) {
    res.status(400).send(errorDescription ?? error);
    return;
  }

  if (!code || !state) {
    res.status(400).send("Missing authorization code or state");
    return;
  }

  try {
    const [encoded] = state.split(".");
    if (!encoded) throw new Error("Invalid state");

    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString());
    const port = payload.port;

    if (!port || typeof port !== "number") {
      throw new Error("Invalid port in state");
    }

    const redirectUrl = `http://localhost:${port}/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;

    res.redirect(redirectUrl);
  } catch {
    res.status(400).send("Invalid authentication state");
  }
});

export default router;