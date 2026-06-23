import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { config } from "./config.js";
import { store } from "./store.js";
import { api } from "./routes.js";

const app = express();

// Safety net only: the production path is the Vercel rewrite in
// client/vercel.json, which makes /api/* requests same-origin from the
// browser's point of view (no CORS involved at all). This allowlist covers
// any direct/absolute call straight to this Render domain — e.g. someone
// linking the CSV export URL directly, or hitting the API from a Vercel
// preview deployment. All endpoints here are read-only with no auth/cookies,
// so this is about being deliberate rather than guarding sensitive data.
const ALLOWED_ORIGINS: (string | RegExp)[] = [
  "https://gasanalyzer.vercel.app",
  /^https:\/\/gasanalyzer-[a-z0-9-]+\.vercel\.app$/, // Vercel preview deployments
  "http://localhost:5173", // local dev
];

app.use(
  cors({
    origin(origin, callback) {
      // No Origin header at all = non-browser client (curl, server-to-server,
      // Vercel's own rewrite proxy) — nothing to enforce here.
      if (!origin) return callback(null, true);
      const allowed = ALLOWED_ORIGINS.some((o) =>
        typeof o === "string" ? o === origin : o.test(origin)
      );
      callback(allowed ? null : new Error(`Origin not allowed: ${origin}`), allowed);
    },
  })
);
app.use(express.json());
app.use("/api", api);

// Clean JSON 403 for blocked CORS origins instead of Express's default error
// page (which can include a stack trace unless NODE_ENV=production is set).
app.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
  if (err.message?.startsWith("Origin not allowed")) {
    return res.status(403).json({ error: "Origin not allowed" });
  }
  next(err);
});

app.get("/health", (_req, res) => res.json({ ok: true }));

store.start();

app.listen(config.port, () => {
  console.log(`[biogas-monitor] API listening on http://localhost:${config.port}`);
  if (config.useMock) {
    console.log(
      `[biogas-monitor] running in MOCK mode (${config.mockReason}). ` +
        `Fill in server/.env to use the real sheet.`
    );
  }
});
