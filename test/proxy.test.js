// dsh-pocket 代理测试（假上游，验证 Host/Origin 改写 + WebSocket 透传）

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';

import { createPocketProxy } from '../lib/proxy.mjs';

/** 构造一个带掩码的 WS 文本帧（浏览器在握手后立即发的首帧，会进 upgrade 的 head）。 */
function maskedTextFrame(text) {
  const payload = Buffer.from(text);
  const mask = Buffer.from([1, 2, 3, 4]);
  const header = Buffer.alloc(2);
  header[0] = 0x81; // FIN + text
  header[1] = 0x80 | payload.length; // MASK + len
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

/** 假上游：记录收到的 Host/Origin，回显请求路径。 */
async function fakeUpstream() {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({ host: req.headers.host, origin: req.headers.origin, path: req.url });
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`path=${req.url}`);
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.on('message', (m) => ws.send(`echo:${m}`));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { port: server.address().port, seen, server };
}

test('HTTP：Host/Origin 被改写成 loopback 权威，响应原样返回', async () => {
  const up = await fakeUpstream();
  const proxy = await createPocketProxy({ port: 0, host: '127.0.0.1', upstream: { host: '127.0.0.1', port: up.port } });
  try {
    const res = await fetch(`http://127.0.0.1:${proxy.port}/api/hello`, {
      headers: { Host: 'my-lan-ip:3081', Origin: 'http://my-lan-ip:3081' },
    });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'path=/api/hello');
    assert.equal(up.seen[0].host, `127.0.0.1:${up.port}`, 'Host 已改写为 loopback 权威');
    assert.equal(up.seen[0].origin, `http://127.0.0.1:${up.port}`, 'Origin 已改写');
  } finally {
    await proxy.close();
    await new Promise((r) => up.server.close(r));
  }
});

test('WebSocket upgrade：原样透传（DSH 流式通道的前提）', async () => {
  const up = await fakeUpstream();
  const proxy = await createPocketProxy({ port: 0, host: '127.0.0.1', upstream: { host: '127.0.0.1', port: up.port } });
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${proxy.port}/api/events.host`, [], {
      headers: { Origin: 'http://whatever.trycloudflare.com' },
    });
    const reply = await new Promise((resolve, reject) => {
      ws.on('message', (m) => resolve(String(m)));
      ws.on('error', reject);
      ws.on('open', () => ws.send('ping'));
      setTimeout(() => reject(new Error('ws timeout')), 3000);
    });
    assert.equal(reply, 'echo:ping');
    ws.close();
  } finally {
    await proxy.close();
    await new Promise((r) => up.server.close(r));
  }
});

test('上游未启动：返回 502 且给出提示', async () => {
  const proxy = await createPocketProxy({ port: 0, host: '127.0.0.1', upstream: { host: '127.0.0.1', port: 1 } });
  try {
    const res = await fetch(`http://127.0.0.1:${proxy.port}/`);
    assert.equal(res.status, 502);
    assert.match(await res.text(), /无法连接上游 dsh web/);
  } finally {
    await proxy.close();
  }
});

test('WS 首帧（握手后立即发出，进 upgrade head）必须送达上游——回归：connection lost 根因', async () => {
  const up = await fakeUpstream();
  const proxy = await createPocketProxy({ port: 0, host: '127.0.0.1', upstream: { host: '127.0.0.1', port: up.port } });
  try {
    const received = await new Promise((resolve, reject) => {
      const sock = connect(proxy.port, '127.0.0.1', () => {
        sock.write(
          `GET /api/events.host HTTP/1.1\r\n` +
          `Host: whatever:3081\r\n` +
          `Upgrade: websocket\r\n` +
          `Connection: Upgrade\r\n` +
          `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n` + // 规范 16 字节 key
          `Sec-WebSocket-Version: 13\r\n\r\n`,
        );
        // 不等 101，立即发出首帧（浏览器就是这么干的）
        sock.write(maskedTextFrame('hello-head'));
      });
      let buf = '';
      const timer = setTimeout(() => reject(new Error('timeout waiting for echo')), 4000);
      sock.on('data', (chunk) => {
        buf += chunk.toString('latin1');
        // 上游把帧回显成 echo:hello-head（文本帧 payload 直接可读）
        if (buf.includes('hello-head')) {
          clearTimeout(timer);
          sock.destroy();
          resolve(true);
        }
      });
      sock.on('error', reject);
    });
    assert.equal(received, true, '上游必须收到握手后立即发出的首帧');
  } finally {
    await proxy.close();
    await new Promise((r) => up.server.close(r));
  }
});

test('HTML 注入：非安全上下文 polyfill 只注入 HTML 文档，不碰 JS/CSS', async () => {
  // 假上游：HTML 文档 + JS 资源
  const up = createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><head><title>x</title></head><body>app</body>');
    } else {
      res.writeHead(200, { 'content-type': 'application/javascript' });
      res.end('console.log("asset");');
    }
  });
  await new Promise((r) => up.listen(0, '127.0.0.1', r));
  const proxy = await createPocketProxy({ port: 0, host: '127.0.0.1', upstream: { host: '127.0.0.1', port: up.address().port } });
  try {
    const html = await (await fetch(`http://127.0.0.1:${proxy.port}/`)).text();
    assert.ok(html.includes('randomUUID'), 'HTML 注入 polyfill');
    assert.ok(html.indexOf('randomUUID') < html.indexOf('</head>'), '注入在 head 内、app 脚本之前');
    const js = await (await fetch(`http://127.0.0.1:${proxy.port}/app.js`)).text();
    assert.ok(!js.includes('randomUUID'), 'JS 资源不注入');
  } finally {
    await proxy.close();
    await new Promise((r) => up.close(r));
  }
});

test('移动端适配注入：HTML 里包含抽屉 CSS 与引导 JS', async () => {
  const up = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><head><title>x</title></head><body></body>');
  });
  await new Promise((r) => up.listen(0, '127.0.0.1', r));
  const proxy = await createPocketProxy({ port: 0, host: '127.0.0.1', upstream: { host: '127.0.0.1', port: up.address().port } });
  try {
    const html = await (await fetch(`http://127.0.0.1:${proxy.port}/`)).text();
    assert.ok(html.includes('data-mobile-nav="frame"'), '移动端 CSS 注入');
    assert.ok(html.includes('randomUUID'), 'polyfill 仍在');
    assert.ok(html.includes('viewport-fit'), 'viewport 适配脚本注入');
  } finally {
    await proxy.close();
    await new Promise((r) => up.close(r));
  }
});
