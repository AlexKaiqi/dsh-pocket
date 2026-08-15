// dsh-pocket 网页设置页签（设置 → 插件 → 手机访问）
//
// 打开即显示局域网二维码；点「开启公网」出公网二维码。
// 手机扫码打开的就是电脑上的 dsh web，实时同步。

import { createElement as h, useEffect, useState } from 'react';

import { POCKET_RPC_CHANNEL, POCKET_ENDPOINTS, redactStatus } from './api.js';

const name = 'dsh-pocket';
const inject = ['slots', 'connection'];

const styles = {
  card: { background: 'var(--dsw-alias-bg-layer-1,#fff)', border: '1px solid var(--dsw-alias-border-l2,#e5e7eb)', borderRadius: 12, padding: '14px 16px', maxWidth: 480 },
  block: { borderTop: '1px solid var(--dsw-alias-border-l2,#e5e7eb)', marginTop: 12, paddingTop: 12 },
  muted: { color: 'var(--dsw-alias-label-tertiary,#8b93a1)', fontSize: 12 },
  code: { fontFamily: 'ui-monospace,Menlo,monospace', fontSize: 12, wordBreak: 'break-all', margin: '4px 0 8px' },
  primary: { font: 'inherit', cursor: 'pointer', border: 'none', background: 'var(--dsw-alias-brand-primary,#4f6ef7)', color: '#fff', borderRadius: 8, padding: '6px 14px', fontSize: 13 },
  btn: { font: 'inherit', cursor: 'pointer', border: '1px solid var(--dsw-alias-border-l2,#e5e7eb)', background: 'var(--dsw-alias-bg-layer-1,#fff)', borderRadius: 8, padding: '6px 14px', fontSize: 13 },
  qr: { width: 220, height: 220, borderRadius: 8, border: '1px solid var(--dsw-alias-border-l2,#e5e7eb)', margin: '6px 0' },
  warn: { color: 'var(--dsw-alias-state-warn-primary,#b45309)', fontSize: 12 },
};

function PocketSettingsTab({ rpcCall }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const call = async (endpoint, payload) => {
    const res = await rpcCall(endpoint, payload);
    if (!res?.ok) throw new Error(res?.error?.message ?? 'RPC failed');
    return res.value;
  };

  const load = async () => {
    try { setStatus(await call(POCKET_ENDPOINTS.status, {})); } catch { /* 忽略瞬时失败 */ }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  const startTunnel = async () => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await call(POCKET_ENDPOINTS.tunnelStart, {}));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const stopTunnel = async () => {
    try { setStatus(await call(POCKET_ENDPOINTS.tunnelStop, {})); } catch { /* 忽略 */ }
  };

  const lanUrl = status?.lanUrl;
  const tunnelUrl = status?.tunnelUrl;

  return h('div', { style: styles.card },
    h('div', null,
      h('strong', null, '📱 手机访问 | Phone access'),
      h('div', { style: styles.muted }, '手机扫码打开的就是电脑上的这个界面，实时同步 | the phone shows this exact screen, live'),
    ),

    // 局域网
    h('div', { style: styles.block },
      h('div', { style: { fontWeight: 600, fontSize: 13 } }, '📶 局域网（同一 WiFi）| LAN'),
      lanUrl
        ? h('div', null,
          h('img', { src: status.lanQr, alt: 'LAN QR', style: styles.qr }),
          h('div', { style: styles.code }, lanUrl),
          h('div', { style: styles.muted }, '手机连接同一 WiFi 后扫码即可打开'),
        )
        : h('div', { style: styles.muted }, '代理未就绪… | proxy starting…'),
    ),

    // 公网
    h('div', { style: styles.block },
      h('div', { style: { fontWeight: 600, fontSize: 13 } }, '🌐 公网（人在外面）| Anywhere'),
      tunnelUrl
        ? h('div', null,
          h('img', { src: status.tunnelQr, alt: 'Tunnel QR', style: styles.qr }),
          h('div', { style: styles.code }, tunnelUrl),
          h('div', { style: styles.muted }, '任何网络扫码即用（URL 每次重启会变）'),
          h('button', { style: styles.btn, onClick: stopTunnel }, '关闭公网 | Stop'),
        )
        : h('div', null,
          h('button', { style: styles.primary, onClick: startTunnel, disabled: busy }, busy ? '开启中…（首次需下载 cloudflared）' : '开启公网访问 | Enable anywhere'),
          h('div', { style: styles.warn, marginTop: 8 }, '⚠️ DSH 能执行电脑代码：二维码/URL 就是钥匙，请勿发给别人'),
        ),
    ),

    error ? h('div', { style: { color: 'var(--dsw-alias-state-error-primary,#dc2626)', fontSize: 12, marginTop: 8 } }, `❌ ${error}`) : null,
  );
}

export function apply(ctx) {
  const rpcCall = (endpoint, payload, signal) =>
    ctx.connection.rpc.call(POCKET_RPC_CHANNEL, endpoint, payload, signal);

  ctx.slots.inject('settings.plugins.tab', () =>
    ctx.slots.register(
      {
        name: 'settings.plugins.tab',
        id: 'pocket',
        order: 10,
        label: '手机访问',
        inject: () => ({ rpcCall }),
      },
      PocketSettingsTab,
    ),
  );
}

export { name, inject, redactStatus };
