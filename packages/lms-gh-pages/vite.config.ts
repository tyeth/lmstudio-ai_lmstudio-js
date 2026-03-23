import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@lmstudio/lms-isomorphic": "@lmstudio/lms-isomorphic/dist/esm/browser.js",
    },
  },
  optimizeDeps: {
    include: ["@lmstudio/sdk"],
  },
});
