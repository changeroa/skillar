import type { Express } from "express";
import { z } from "zod";
import { CAPTURE_RUNTIMES, type CaptureDiagnostics } from "../diagnostics/capture.js";
import { deny } from "./security.js";

const probeSchema = z.object({ runtime: z.enum(CAPTURE_RUNTIMES) }).strict();

export function registerCaptureRoutes(app: Express, diagnostics: CaptureDiagnostics): void {
  app.get("/api/diagnostics/capture", (_req, res) => res.json(diagnostics.health()));
  app.post("/api/diagnostics/capture", async (req, res) => {
    const body = probeSchema.safeParse(req.body);
    if (!body.success) return deny(res, 400, "bad_capture_probe");
    res.json(await diagnostics.run(body.data.runtime));
  });
}
