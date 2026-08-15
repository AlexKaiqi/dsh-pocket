// dsh-pocket 代理测试（假上游，验证 Host/Origin 改写 + WebSocket 透传）

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

import { createPocketProxy } from '../lib/proxy.mjs';

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
