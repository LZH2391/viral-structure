import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: "Apps/Workbench",
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: "Apps/Workbench/index.html",
        debug: "Apps/Workbench/debug.html",
        library: "Apps/Workbench/library.html",
        threadpool: "Apps/Workbench/threadpool.html",
      },
    },
  },
  server: {
    port: 5178,
    proxy: {
      "/api": "http://127.0.0.1:5177",
      "/runtime": "http://127.0.0.1:5177",
    },
  },
});
