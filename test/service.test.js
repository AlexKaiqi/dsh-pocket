// dsh-pocket 服务 + RPC 测试（stub 隧道/代理，无网络）

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createPocketService } from '../lib/service.mjs';
import { installPocketRpc } from '../lib/web-rpc.js';
import { POCKET_RPC_CHANNEL, POCKET_ENDPOINTS } from '../client/api.js';

function fakeCtxConnection() {
  let handler = null;
  const handle = (channel, fn, opts) => {
    assert.equal(channel, POCKET_RPC_CHANNEL);
    assert.deepEqual(opts, { authority: 'loopback' });
    handler = fn;
    return () => { handler = null; };
  };
  return { rpc: { handle }, get handler() { return handler; } };
}

function stubInternals() {
  const started = [];
  let tunnelUrl = null;
  return {
    started,
    lanIPv4: () => '192.168.1.50',
    encodeQr: async (text) => `data:qr;${text}`,
    createProxy: async ({ port }) => ({
      port,
      close: async () => { started.push('closed'); },
    }),
    startTunnel: async ({ port }) => {
      started.push(`tunnel:${port}`);
      tunnelUrl = 'https://abc-123.trycloudflare.com';
      return tunnelUrl;
    },
    get tunnelUrl() { return tunnelUrl; },
  };
}

test('service：startProxy → 局域网状态（含二维码）；startTunnel → 公网状态', async () => {
  const internals = stubInternals();
  const service = createPocketService({ dshPort: 3080, port: 3081, internals });

  const before = await service.status();
  assert.equal(before.proxyRunning, false);

  const proxy = await service.startProxy();
  assert.equal(proxy.port, 3081);
  const lan = await service.status();
  assert.equal(lan.lanUrl, 'http://192.168.1.50:3081');
  assert.equal(lan.lanQr, 'data:qr;http://192.168.1.50:3081');
  assert.equal(lan.tunnelRunning, false);

  const url = await service.startTunnel();
  assert.equal(url, 'https://abc-123.trycloudflare.com');
  const pub = await service.status();
  assert.equal(pub.tunnelRunning, true);
  assert.equal(pub.tunnelQr, 'data:qr;https://abc-123.trycloudflare.com');
  assert.deepEqual(internals.started, ['tunnel:3081'], '隧道指向代理端口');

  service.stopTunnel();
  const stopped = await service.status();
  assert.equal(stopped.tunnelRunning, false);
  assert.equal(stopped.lanUrl, 'http://192.168.1.50:3081', '停隧道不影响局域网代理');

  await service.dispose();
});

test('RPC：status / tunnel.start / tunnel.stop / 未知端点', async () => {
  const internals = stubInternals();
  const service = createPocketService({ dshPort: 3080, port: 3081, internals });
  const conn = fakeCtxConnection();
  installPocketRpc({ connection: conn }, { service, log: { error() {}, warn() {} } });

  // 先让代理跑起来（插件 apply 里会自动启动）
  await service.startProxy();

  const s1 = await conn.handler(POCKET_ENDPOINTS.status, {});
  assert.equal(s1.ok, true);
  assert.equal(s1.value.lanUrl, 'http://192.168.1.50:3081');
  assert.ok(s1.value.lanQr.startsWith('data:qr;'), '局域网二维码 data URL');

  const started = await conn.handler(POCKET_ENDPOINTS.tunnelStart, {});
  assert.equal(started.ok, true);
  assert.equal(started.value.tunnelRunning, true);
  assert.equal(started.value.tunnelUrl, 'https://abc-123.trycloudflare.com');

  const stopped = await conn.handler(POCKET_ENDPOINTS.tunnelStop, {});
  assert.equal(stopped.ok, true);
  assert.equal(stopped.value.tunnelRunning, false);

  const unknown = await conn.handler('nope', {});
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, 'bad-request');

  await service.dispose();
});

test('隧道进度：startTunnel 阶段透出到 status.tunnelState', async () => {
  const internals = {
    ...stubInternals(),
    startTunnel: async ({ onPhase }) => {
      onPhase('downloading');
      onPhase('registering');
      onPhase('ready');
      return { url: 'https://x.trycloudflare.com', kill: () => {} };
    },
  };
  const service = createPocketService({ dshPort: 3080, port: 3081, internals });
  await service.startProxy();
  await service.startTunnel();
  const s = await service.status();
  assert.equal(s.tunnelState.phase, 'ready');
  assert.ok(s.tunnelState.startedAt > 0, '开始时间已记录');
  assert.ok(s.tunnelState.detail.length > 0);
  service.stopTunnel();
  const after = await service.status();
  assert.equal(after.tunnelState.phase, 'idle');
});

test('自重启：restartHost 用当前 argv 拉起 detached 新进程并退出旧进程', async () => {
  const { restartHost } = await import('../lib/restart.js');
  let spawned = null;
  const calls = [];
  const result = restartHost({
    exitDelayMs: 10,
    internals: {
      spawn: (file, args, opts) => { spawned = { file, args, detached: opts.detached }; calls.push('spawn'); return { unref: () => {} }; },
      exit: (code) => calls.push('exit:' + code),
    },
  });
  assert.equal(result.spawned, true);
  assert.equal(spawned.file, process.argv[0], '用 node 重启');
  assert.deepEqual(spawned.args, [process.argv[1], ...process.argv.slice(2)], '重放启动参数');
  assert.equal(spawned.detached, true, 'detached 脱离父进程');
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(calls.includes('exit:0'), '短暂等待后旧进程退出');
});

test('自重启失败：spawn 抛错 → 返回 spawned:false', async () => {
  const { restartHost } = await import('../lib/restart.js');
  const result = restartHost({
    internals: {
      spawn: () => { throw new Error('boom'); },
      exit: () => {},
    },
  });
  assert.equal(result.spawned, false);
  assert.match(result.error, /boom/);
});
