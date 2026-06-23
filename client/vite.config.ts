import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The frontend never talks to Google directly — all data comes from our Express
// backend. In dev we proxy /api to it so the app is same-origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
      },
    },
  },
});
