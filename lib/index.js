// dsh-pocket 插件入口（单包单插件：手机扫码访问 DSH，全在这一个包里）
//
// 设置页「设置 → 插件 → 手机访问」：
//   - 局域网二维码：自动显示（代理随插件启动）
//   - 公网二维码：点「开启公网」→ cloudflared 隧道 → 扫码即用，人在外面也能访问
//   - Web Push：agent 跑完/出错 → 手机推送通知（需 HTTPS 公网路径或 localhost）
// 手机看到的界面 = 电脑上的 dsh web，实时同步（WebSocket 透传）。

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { createPocketService } from './service.mjs';
import { installPocketRpc } from './web-rpc.js';
import { createPushService } from './push.mjs';

const name = 'dsh-pocket';
const inject = ['connection', 'webServer'];

// 服务 worker 源码（同源提供：/pocket-sw.js）
const SW_SOURCE = new URL('./pocket-sw.js', import.meta.url);
let swCache = null;
async function swScript() {
  if (!swCache) swCache = await readFile(fileURLToPath(SW_SOURCE), 'utf8');
  return swCache;
}

export function apply(ctx, config = {}, internals = {}) {
  const logger = ctx.logger?.(name) ?? console;
  const dshPort = internals.dshPort ?? ctx.webServer?.port;
  if (!dshPort) {
    logger.error('dsh-pocket: webServer port unavailable — cannot start proxy | 拿不到 dsh web 端口，无法启动代理');
    return () => {};
  }

  const service = internals.service ?? createPocketService({
    dshPort,
    port: internals.port ?? config.port ?? 3081,
    internals,
  });

  // Web Push 服务（web-push 库；测试可注入 stub）
  const pushPromise = internals.pushPromise ?? createPushService({ internals });
  pushPromise.catch((err) => logger.error('dsh-pocket: push service init failed | 推送服务初始化失败: %s', err?.message ?? err));

  const disposers = [];
  const disposeRpc = installPocketRpc(ctx, {
    service,
    push: internals.push ?? { vapidPublicKey: () => '', count: () => 0, subscribe: async () => false, unsubscribe: async () => false },
    log: logger,
  });
  disposers.push(disposeRpc);

  // 同源提供 Service Worker（Web Push 必需）
  try {
    const removeSw = ctx.webServer.register({
      kind: 'exact',
      path: '/pocket-sw.js',
      handler: async (req, res) => {
        res.writeHead(200, { 'content-type': 'application/javascript', 'cache-control': 'no-cache' });
        res.end(await swScript());
      },
    });
    disposers.push(removeSw);
  } catch (err) {
    logger.error('dsh-pocket: sw route register failed | SW 路由注册失败: %s', err?.message ?? err);
  }

  // Agent 回合结束/出错 → 推送通知（有订阅才发）
  const onSessionEvent = (session, event) => {
    if (event?.type !== 'turn/end') return;
    const reason = event?.data?.reason ?? event?.reason;
    if (!reason) return;
    void pushPromise.then(async (push) => {
      try {
        if (reason.kind === 'error') {
          await push.notify({ title: '❌ 任务失败 | Task failed', body: String(reason.error?.message ?? '').slice(0, 120) || 'Agent 执行出错', url: '/' });
        } else if (reason.kind === 'completed') {
          await push.notify({ title: '✅ 任务完成 | Task done', body: 'Agent 已完成任务，点开查看结果', url: '/' });
        }
      } catch (err) {
        logger.error('dsh-pocket: push send failed | 推送发送失败: %s', err?.message ?? err);
      }
    });
  };
  const offSession = ctx.on('session/event', onSessionEvent);
  disposers.push(offSession);

  // 代理随插件自动启动（局域网二维码开箱即用，零配置）
  void service.startProxy().then((proxy) => {
    logger.info('dsh-pocket: proxy ready on :%d | 局域网代理已就绪', proxy.port);
  }).catch((err) => {
    logger.error('dsh-pocket: proxy start failed | 代理启动失败: %s', err?.message ?? err);
  });

  ctx.effect(() => async () => {
    for (const d of disposers.reverse()) { try { d(); } catch { /* 忽略 */ } }
    await service.dispose();
  }, 'dsh-pocket: stop proxy, tunnel and push');
}

export { name, inject };
