/**
 * server.test.js —— 静态服务器集成测试（零依赖，使用 Node 内置 fetch）
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../server.js';

/** 使用原始 http.request 发送未被客户端规范化的路径（fetch/URL 构造都会规范化） */
function rawGet(base, path) {
  const { hostname, port } = new URL(base);
  return new Promise((resolve) => {
    const req = http.request({ hostname, port, path, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.end();
  });
}

async function withServer(fn) {
  const server = createApp();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

test('GET / 返回首页，包含应用标题', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /转账反诈守门工具/);
    assert.match(html, /index\.html|main\.js/);
  });
});

test('静态资源可访问：CSS 与 JS', async () => {
  await withServer(async (base) => {
    const css = await fetch(`${base}/css/style.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type'), /text\/css/);

    const js = await fetch(`${base}/js/engine.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type'), /javascript/);
  });
});

test('不存在的资源返回 404', async () => {
  await withServer(async (base) => {
    const res = await fetch(`${base}/no-such-file.js`);
    assert.equal(res.status, 404);
  });
});

test('路径穿越被拒绝（403）', async () => {
  await withServer(async (base) => {
    // fetch 会在客户端规范化路径，这里用原始请求验证服务端防护
    const res1 = await rawGet(base, '/../package.json');
    assert.equal(res1.status, 403);
    const res2 = await rawGet(base, '/%2e%2e/package.json');
    assert.equal(res2.status, 403);
    const res3 = await rawGet(base, '/..%2fserver.js');
    assert.equal(res3.status, 403);
  });
});
