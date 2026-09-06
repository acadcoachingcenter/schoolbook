import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// SchoolBook — Vite config
// Frontend calls the Cloudflare Pages Functions API at /api/* (same origin in prod).
// In dev, proxy /api to `wrangler pages dev` running on port 8788 (see README).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8788",
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    target: "es2020"
  }
});
