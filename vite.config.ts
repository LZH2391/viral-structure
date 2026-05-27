import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [workbenchRoutePlugin(), react()],
  root: "Apps/Workbench",
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: "Apps/Workbench/index.html",
        fullAnalysis: "Apps/Workbench/full-analysis.html",
        debug: "Apps/Workbench/debug.html",
        library: "Apps/Workbench/library.html",
        functionSlotGraph: "Apps/Workbench/function-slot-graph.html",
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

function workbenchRoutePlugin(): Plugin {
  return {
    name: "workbench-route",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const request = req as { url?: string };
        const pathname = String(request.url ?? "").split("?")[0];
        if (pathname === "/function-slot-graph" || pathname === "/function-slot-graph/") request.url = "/function-slot-graph.html";
        else if (isWorkbenchRoute(pathname)) request.url = "/index.html";
        next();
      });
    },
  };
}

function isWorkbenchRoute(pathname: string) {
  return ["/full-analysis", "/full-analysis/", "/library", "/library/", "/function-slot-graph", "/function-slot-graph/", "/threadpool", "/threadpool/"].includes(pathname);
}
