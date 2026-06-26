import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // Forward API + WebSocket calls to the FastAPI backend during dev.
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Split rarely-changing vendor code into its own long-cached chunks so
        // the main bundle is smaller and repeat visits reuse the cache. echarts
        // is large and only used by Profile/Progress, so isolate it too.
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          echarts: ["echarts/core", "echarts/charts", "echarts/components", "echarts/renderers"],
        },
      },
    },
  },
});
