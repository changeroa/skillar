import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { distAsset, standalone } from "../runtime.js";
import express, { type Express, type Request, type Response } from "express";
import { DASH_COOKIE, dashCookieValue, deny, safeEqual } from "./security.js";

export function defaultDashboardDir(): string {
  return distAsset("dashboard");
}

/**
 * `GET /?token=<token>` trades the bearer token for the HttpOnly dashboard cookie and redirects to `/`;
 * `GET /` serves index.html uncached; `/assets/*` serves the built bundle.
 */
export function registerStatic(app: Express, opts: { token: string; dir?: string }): void {
  const dir = opts.dir ?? defaultDashboardDir();
  const cookie = dashCookieValue(opts.token);

  app.get("/", (req: Request, res: Response) => {
    const presented = req.query.token;
    if (presented !== undefined) {
      if (typeof presented !== "string" || !safeEqual(presented, opts.token)) return deny(res, 401, "unauthorized");
      // Persistent (400 days, the browser maximum) so the dashboard still opens after a browser restart.
      res.setHeader("Set-Cookie", `${DASH_COOKIE}=${cookie}; HttpOnly; SameSite=Strict; Path=/; Max-Age=34560000`);
      res.setHeader("Cache-Control", "no-store");
      return res.redirect(302, "/");
    }
    const index = join(dir, "index.html");
    if (!existsSync(index)) return deny(res, 503, "dashboard_not_built", { hint: "run bun run build in the skillar package" });
    res.setHeader("Cache-Control", "no-store");
    if (standalone && opts.dir === undefined) return res.type("html").send(readFileSync(index));
    res.sendFile(index);
  });

  if (standalone && opts.dir === undefined) {
    // Express's send/sendFile attempts to open real file descriptors; embedded assets have none.
    app.get("/assets/:file", (req, res) => {
      const name = req.params.file;
      if (!/^[\w-]+\.(?:js|css|svg|woff2)$/.test(name)) return res.sendStatus(404);
      const asset = join(dir, "assets", name);
      if (!existsSync(asset)) return res.sendStatus(404);
      return res.type(name).send(readFileSync(asset));
    });
    return;
  }
  app.use("/assets", express.static(join(dir, "assets"), { index: false, fallthrough: false }));
}
