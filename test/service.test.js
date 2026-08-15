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
  assert.equal(s1.value.restartNotice, null, '无重启标记时 restartNotice 为 null');

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

test('RPC：status 携带重启提示（restartNotice）', async () => {
  const internals = stubInternals();
  const service = createPocketService({ dshPort: 3080, port: 3081, internals });
  const conn = fakeCtxConnection();
  installPocketRpc({ connection: conn }, {
    service,
    restartNotice: () => ({ at: Date.now(), pid: 12345 }),
    log: { error() {}, warn() {} },
  });

  const s = await conn.handler(POCKET_ENDPOINTS.status, {});
  assert.equal(s.ok, true);
  assert.equal(s.value.restartNotice.pid, 12345, '重启标记随 status 返回');

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

test('自重启：restartHost 用 detached 辅助进程交接，旧进程随后退出', async () => {
  const { restartHost } = await import('../lib/restart.js');
  const calls = [];
  const result = restartHost({
    internals: {
      spawn: (file, args, opts) => { calls.push({ file, args, detached: opts?.detached }); return { pid: 4242, unref: () => {} }; },
      kill: (pid) => calls.push('kill:' + pid),
    },
  });
  assert.equal(result.helperPid, 4242, '返回辅助进程 pid');
  assert.ok(result.logOut.endsWith('.out.log'), '输出日志路径');
  assert.ok(result.logErr.endsWith('.err.log'), '错误日志路径');
  // 辅助进程：node -e <helperCode>，detached，代码内含新 dsh 的启动命令
  assert.equal(calls.length, 1, '只拉起一个辅助进程');
  const helper = calls[0];
  assert.equal(helper.file, process.execPath, '用 node 拉起辅助进程');
  assert.equal(helper.args[0], '-e');
  assert.equal(helper.detached, true, '辅助进程 detached');
  const code = helper.args[1];
  assert.ok(code.includes(JSON.stringify(process.argv[0])), '辅助代码含 node 路径');
  assert.ok(code.includes('waitPort'), '辅助代码含端口释放探测（替代固定延时）');
  assert.ok(code.includes('setTimeout'), '辅助代码含轮询延时');
  // helper 代码必须是可执行的有效 JS（防拼接语法错误 → 重启静默失败）
  const vm = await import('node:vm');
  try {
    vm.compileFunction(code, [], { filename: 'restart-helper.js' });
  } catch (e) {
    assert.fail('helper 代码语法错误: ' + e.message);
  }
  await new Promise((r) => setTimeout(r, 600));
  assert.ok(calls.some((c) => typeof c === 'string' && c.startsWith('kill:')), '短暂等待后旧进程退出');
});

test('自重启失败：spawn 抛错 → 返回 helperPid:null 和错误', async () => {
  const { restartHost } = await import('../lib/restart.js');
  const result = restartHost({
    internals: {
      spawn: () => { throw new Error('boom'); },
      kill: () => {},
    },
  });
  assert.equal(result.helperPid, null);
  assert.match(result.error, /boom/);
});

test('readRestartNotice：真实文件系统（无文件/坏 JSON/过期/有效）', async () => {
  const os = await import('node:os');
  const fsp = await import('node:fs/promises');
  const path = await import('node:path');
  const { readRestartNotice } = await import('../lib/index.js');

  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-pocket-test-'));
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = dir;
  try {
    // 1. 无文件（ENOENT）→ null，且不得产生未处理的 promise rejection（曾导致启动崩溃）
    assert.equal(await readRestartNotice(), null, '无标记文件返回 null');

    // 2. 坏 JSON → null
    await fsp.mkdir(path.join(dir, 'dsh-pocket'), { recursive: true });
    await fsp.writeFile(path.join(dir, 'dsh-pocket', 'restarted.json'), 'not-json');
    assert.equal(await readRestartNotice(), null, '坏 JSON 返回 null');

    // 3. 过期标记（31 分钟前）→ null
    await fsp.writeFile(path.join(dir, 'dsh-pocket', 'restarted.json'), JSON.stringify({ at: Date.now() - 31 * 60 * 1000, pid: 1 }));
    assert.equal(await readRestartNotice(), null, '过期标记返回 null');

    // 4. 有效标记 → 返回内容
    await fsp.writeFile(path.join(dir, 'dsh-pocket', 'restarted.json'), JSON.stringify({ at: Date.now(), pid: 4242 }));
    const n = await readRestartNotice();
    assert.equal(n.pid, 4242, '有效标记返回 pid');
  } finally {
    process.env.DSH_HOME = prev;
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('RPC：restartNotice 读取抛错时 status 优雅降级为 null', async () => {
  const internals = stubInternals();
  const service = createPocketService({ dshPort: 3080, port: 3081, internals });
  const conn = fakeCtxConnection();
  installPocketRpc({ connection: conn }, {
    service,
    restartNotice: async () => { throw new Error('ENOENT'); },
    log: { error() {}, warn() {} },
  });
  await service.startProxy();
  const s = await conn.handler(POCKET_ENDPOINTS.status, {});
  assert.equal(s.ok, true);
  assert.equal(s.value.restartNotice, null, '读取失败不阻塞 status');
  await service.dispose();
});

test('RPC：version 返回磁盘版本 current 与启动版本 loaded', async () => {
  const internals = stubInternals();
  const service = createPocketService({ dshPort: 3080, port: 3081, internals });
  const conn = fakeCtxConnection();
  installPocketRpc({ connection: conn }, {
    service,
    runUpdate: { currentVersion: () => '1.0.15', loadedVersion: () => '1.0.14', perform: async () => ({ ok: true }) },
    log: { error() {}, warn() {} },
  });

  const v = await conn.handler(POCKET_ENDPOINTS.version, {});
  assert.equal(v.ok, true);
  assert.equal(v.value.current, '1.0.15', 'current 是磁盘实时版本');
  assert.equal(v.value.loaded, '1.0.14', 'loaded 是进程启动版本');

  await service.dispose();
});

test('RPC：push 传 promise（插件启动早期）也能正常调用', async () => {
  const internals = stubInternals();
  const service = createPocketService({ dshPort: 3080, port: 3081, internals });
  const conn = fakeCtxConnection();
  installPocketRpc({ connection: conn }, {
    service,
    push: Promise.resolve({
      vapidPublicKey: () => 'pub',
      count: () => 2,
      subscribe: async () => true,
      unsubscribe: async () => true,
      isEnabled: () => true,
      setEnabled: async () => true,
    }),
    log: { error() {}, warn() {} },
  });

  const st = await conn.handler(POCKET_ENDPOINTS.pushStatus, {});
  assert.equal(st.ok, true);
  assert.equal(st.value.enabled, true, 'promise resolve 后可用');
  assert.equal(st.value.count, 2);

  const key = await conn.handler(POCKET_ENDPOINTS.pushVapidKey, {});
  assert.equal(key.ok, true);
  assert.equal(key.value.publicKey, 'pub');

  await service.dispose();
});

test('lib/index.js 模块可加载，apply 可调用（防模块级 ReferenceError 回归）', async () => {
  // 回归：pocketRestart 曾引用 apply 参数里的 internals，点「重启」抛 ReferenceError
  const mod = await import('../lib/index.js');
  assert.equal(typeof mod.apply, 'function');
  assert.equal(typeof mod.readRestartNotice, 'function');
  assert.equal(typeof mod.name, 'string');

  // apply 用最小 fake ctx 调用不应抛错（不启动真实代理：注入 stub service）
  const ctx = {
    logger: () => ({ error() {}, info() {}, warn() {} }),
    webServer: { port: 3080 },
    on: () => () => {},
    effect: () => {},
  };
  const stubService = {
    startProxy: async () => ({}), dispose: async () => {}, status: async () => ({}),
    startTunnel: async () => 'https://x.trycloudflare.com', stopTunnel: () => {},
  };
  // apply 内部用 ctx.effect 注册清理，返回值不是契约；这里只验证不抛错
  mod.apply(ctx, {}, {
    service: stubService,
    pushPromise: Promise.resolve({
      vapidPublicKey: () => 'pub', count: () => 0, subscribe: async () => true,
      unsubscribe: async () => true, isEnabled: () => true, setEnabled: async () => true,
      notify: async () => 0,
    }),
    runUpdate: { currentVersion: () => '1.0.19', loadedVersion: () => '1.0.19', perform: async () => ({ ok: true }) },
    restart: () => ({ helperPid: 1, logOut: '', logErr: '' }),
    restartNotice: async () => null,
  });
  assert.ok(true, 'apply 正常路径不抛错');
});
