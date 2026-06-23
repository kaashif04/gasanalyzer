import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { store } from "./store.js";
import { api } from "./routes.js";

const app = express();
app.use(cors());
app.use(express.json());
app.use("/api", api);

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
