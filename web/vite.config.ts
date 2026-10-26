import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { env } from "node:process";

const apiTarget = env.API_PROXY_TARGET ?? "http://127.0.0.1:3000";

export default defineConfig({
  root: "web",
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
      },
      "/health": {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
});
