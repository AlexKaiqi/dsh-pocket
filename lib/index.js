// dsh-pocket 插件入口（单包单插件：手机扫码访问 DSH，全在这一个包里）
//
// 设置页「设置 → 插件 → 手机访问」：
//   - 局域网二维码：自动显示（代理随插件启动）
//   - 公网二维码：点「开启公网」→ cloudflared 隧道 → 扫码即用，人在外面也能访问
// 手机看到的界面 = 电脑上的 dsh web，实时同步（WebSocket 透传）。

import { createPocketService } from './service.mjs';
import { installPocketRpc } from './web-rpc.js';

const name = 'dsh-pocket';
const inject = ['connection', 'webServer'];

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

  const disposeRpc = installPocketRpc(ctx, { service, log: logger });

  // 代理随插件自动启动（局域网二维码开箱即用，零配置）
  void service.startProxy().then((proxy) => {
    logger.info('dsh-pocket: proxy ready on :%d | 局域网代理已就绪', proxy.port);
  }).catch((err) => {
    logger.error('dsh-pocket: proxy start failed | 代理启动失败: %s', err?.message ?? err);
  });

  ctx.effect(() => async () => {
    disposeRpc();
    await service.dispose();
  }, 'dsh-pocket: stop proxy and tunnel');
}

export { name, inject };
