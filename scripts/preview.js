#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
const port = Number(process.env.PORT) || 4173;

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".zip": "application/zip",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
  let file = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
  if (!file.startsWith(root)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  if (file.endsWith(path.sep) || !path.extname(file)) {
    file = path.join(file, "index.html");
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": mime[path.extname(file)] ?? "application/octet-stream",
    });
    res.end(data);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Preview  http://127.0.0.1:${port}`);
});
