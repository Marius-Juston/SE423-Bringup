import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so the build also works from the Tauri asset protocol.
export default defineConfig({
  base: "./",
  plugins: [react()],
  clearScreen: false,
  server: { port: 5183, strictPort: true },
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
});
