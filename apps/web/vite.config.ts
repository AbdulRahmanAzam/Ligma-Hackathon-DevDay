import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const SERVER = process.env.VITE_LIGMA_SERVER ?? "http://localhost:10000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": SERVER,
      "/ligma-sync": { target: SERVER.replace("http", "ws"), ws: true },
      "/healthz": SERVER,
      "/health": SERVER,
    },
  },
  optimizeDeps: {
    exclude: ["@huggingface/transformers"],
  },
  build: {
    target: "es2022",
  },
});
