/**
 * server.js —— 零依赖静态文件服务器（开发/本地部署用）
 *
 * 生产环境可直接用 Nginx / 任意静态托管（见 DEPLOY.md），
 * 本服务器仅用于本地快速启动与测试。
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, 'src');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

/** 创建 HTTP 服务器实例（便于测试注入端口） */
export function createApp() {
  return http.createServer((req, res) => {
    // 注意：不要用 new URL() 解析路径——它会先把 ".." 规范化掉，绕过穿越防护
    const rawPath = req.url.split('?')[0];
    let pathname;
    try {
      pathname = decodeURIComponent(rawPath);
    } catch {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Bad Request');
      return;
    }

    if (pathname === '/') pathname = '/index.html';

    // 路径穿越防护
    const filePath = path.normalize(path.join(ROOT, pathname));
    if (pathname.includes('..') || !filePath.startsWith(ROOT + path.sep)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      fs.createReadStream(filePath).pipe(res);
    });
  });
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => {
    console.log(`转账反诈守门工具已启动：http://localhost:${port}`);
  });
}
