// dsh-pocket 服务：在 dsh web 进程内跑改头代理 + 公网隧道
//
// - 代理：监听 0.0.0.0:<port>（默认 3081），把入站 Host/Origin 改写成
//   127.0.0.1:<dshPort>（dsh web 实际端口），HTTP + WebSocket 全透传。
//   这样 DSH 的 /api 浏览器信任栅栏永远看到 loopback，局域网/公网都能进，
//   且不需要改 dsh 的任何配置（0.0.0.0 绑定被 dsh 官方禁用）。
// - 隧道：cloudflared 快速隧道（可选），公网 https URL，供人在外面访问。

import { networkInterfaces } from 'node:os';
import { createRequire } from 'node:module';
import { createPocketProxy } from './proxy.mjs';
import { startQuickTunnel } from './tunnel.mjs';

const require = createRequire(import.meta.url);

/** URL → 二维码 data URL（浏览器 <img> 直接显示，全本地不依赖第三方）。 */
export async function qrDataUrl(text, { width = 220, margin = 1 } = {}) {
  const QRCode = require('qrcode');
  return QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin, width, type: 'image/png' });
}

function lanIPv4() {
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const i of ifaces ?? []) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return null;
}

/**
 * 创建 Pocket 服务。
 * @param {object} opts
 * @param {number} opts.dshPort   dsh web 实际端口（从 ctx.webServer.port 取）
 * @param {number} [opts.port]    代理端口（默认 3081）
 * @param {object} [opts.internals] 测试注入：createProxy / startTunnel / lanIPv4
 * @returns {PocketService}
 */
export function createPocketService({
  dshPort,
  port = 3081,
  home,
  internals = {},
} = {}) {
  const createProxy = internals.createProxy ?? createPocketProxy;
  const startTunnel = internals.startTunnel ?? startQuickTunnel;
  const getLan = internals.lanIPv4 ?? lanIPv4;

  let proxy = null;
  let tunnel = null;
  let tunnelAbort = null;
  /** 隧道进度：{ phase: idle|downloading|starting|registering|ready|error, detail, startedAt } */
  const tunnelState = { phase: 'idle', detail: '', startedAt: null };

  return {
    /** 启动局域网代理（幂等）。 */
    async startProxy() {
      if (proxy) return proxy;
      proxy = await createProxy({
        port,
        host: '0.0.0.0',
        upstream: { host: '127.0.0.1', port: dshPort },
      });
      return proxy;
    },

    /** 启动公网隧道（幂等；返回公网 URL）。进度写进 tunnelState。 */
    async startTunnel() {
      await this.startProxy();
      if (tunnel) return tunnel.url;
      tunnelAbort = new AbortController();
      tunnelState.startedAt = Date.now();
      const onPhase = (phase) => {
        tunnelState.phase = phase;
        if (phase === 'downloading') tunnelState.detail = '首次下载 cloudflared（约 20MB）| first run downloads cloudflared (~20MB)';
        else if (phase === 'starting') tunnelState.detail = '启动隧道进程… | starting tunnel…';
        else if (phase === 'registering') tunnelState.detail = '连接 Cloudflare 边缘（通常 5-30 秒）| connecting to Cloudflare edge (usually 5-30s)';
        else if (phase === 'ready') tunnelState.detail = '隧道就绪 | ready';
      };
      try {
        const result = await startTunnel({ port: proxy.port, home, signal: tunnelAbort.signal, onPhase });
        // 归一化：startTunnel 契约返回 {url, kill}（字符串也兼容）
        tunnel = typeof result === 'string' ? { url: result, kill: () => {} } : result;
        tunnelState.phase = 'ready';
        return tunnel.url;
      } catch (err) {
        tunnelState.phase = 'error';
        tunnelState.detail = err?.message ?? String(err);
        throw err;
      }
    },

    /** 停止公网隧道（代理保持）。 */
    stopTunnel() {
      tunnelAbort?.abort();
      tunnelAbort = null;
      if (tunnel) tunnel.kill();
      tunnel = null;
      tunnelState.phase = 'idle';
      tunnelState.detail = '';
      tunnelState.startedAt = null;
    },

    /** 状态快照（RPC 返回，不含敏感信息；二维码 data URL 本地生成）。 */
    async status() {
      const lan = getLan();
      const proxyPort = proxy?.port ?? null;
      const lanUrl = lan && proxyPort ? `http://${lan}:${proxyPort}` : null;
      const encode = internals.encodeQr ?? qrDataUrl;
      return {
        proxyRunning: proxy !== null,
        proxyPort,
        lanUrl,
        lanQr: lanUrl ? await encode(lanUrl) : null,
        tunnelRunning: tunnel !== null,
        tunnelUrl: tunnel?.url ?? null,
        tunnelQr: tunnel?.url ? await encode(tunnel.url) : null,
        tunnelState: { ...tunnelState },
        dshPort,
      };
    },

    /** 停止一切（插件卸载时）。 */
    async dispose() {
      this.stopTunnel();
      if (proxy) {
        const p = proxy;
        proxy = null;
        await p.close();
      }
    },
  };
}
