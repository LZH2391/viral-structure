const fs = require("fs");
const path = require("path");

function createWorkbenchStaticHandler(rootDir) {
  const workbenchRoot = path.join(rootDir, "Apps", "Workbench");

  function handle(req, res, pathname) {
    const filePath = resolveWorkbenchPath(workbenchRoot, pathname);
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
  if (pathname === "/debug" || pathname === "/debug/") return "debug.html";
  if (/^\/(scripts|styles)\//.test(pathname)) return pathname.slice(1);
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
