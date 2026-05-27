const fs = require("fs");
const path = require("path");

function createWorkbenchStaticHandler(rootDir) {
  const workbenchRoot = path.join(rootDir, "Apps", "Workbench");
  const distRoot = path.join(workbenchRoot, "dist");

  function handle(req, res, pathname) {
    const filePath = resolveWorkbenchPath(fs.existsSync(distRoot) ? distRoot : workbenchRoot, pathname);
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
    res.writeHead(200, {
      "content-type": contentType(filePath),
      "access-control-allow-origin": "*",
    });
    fs.createReadStream(filePath).pipe(res);
    return true;
  }

  return { handle };
}

function resolveWorkbenchPath(workbenchRoot, pathname) {
  const cleanPath = decodeURIComponent(pathname);
  const relative = routeToFile(cleanPath);
  if (!relative) return null;
  const filePath = path.resolve(workbenchRoot, relative);
  if (!filePath.startsWith(path.resolve(workbenchRoot))) return null;
  return filePath;
}

function routeToFile(pathname) {
  if (pathname === "/" || pathname === "/index.html") return "index.html";
  if (pathname === "/threadpool" || pathname === "/threadpool/") return "index.html";
  if (pathname === "/full-analysis" || pathname === "/full-analysis/") return "index.html";
  if (pathname === "/library" || pathname === "/library/") return "index.html";
  if (pathname === "/function-slot-graph" || pathname === "/function-slot-graph/") return "function-slot-graph.html";
  if (pathname === "/debug" || pathname === "/debug/") return "debug.html";
  if (pathname === "/full-analysis.html") return "full-analysis.html";
  if (pathname === "/library.html") return "library.html";
  if (pathname === "/function-slot-graph.html") return "function-slot-graph.html";
  if (pathname === "/threadpool.html") return "threadpool.html";
  if (/^\/assets\//.test(pathname)) return pathname.slice(1);
  if (/^\/styles\//.test(pathname)) return pathname.slice(1);
  if (/^\/src\//.test(pathname)) return pathname.slice(1);
  if (pathname === "/styles.css") return "styles.css";
  if (pathname === "/favicon.ico") return null;
  return null;
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "application/octet-stream";
}

module.exports = { createWorkbenchStaticHandler, resolveWorkbenchPath, contentType };
