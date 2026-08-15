// dsh-pocket 网页客户端：
//   1. 设置页签「手机访问」（局域网/公网二维码 + Web Push 状态）
//   2. 移动端适配（移植自 MIT 项目 dsh-web-mobile，见 client/mobile/LICENSE.dsh-web-mobile）
//   3. Web Push：注册 Service Worker + 订阅推送（agent 跑完/出错 → 手机通知）
//
// 手机扫码打开的就是电脑上的 dsh web，实时同步；窄屏自动变成抽屉布局。

import { createElement as h, useEffect, useState } from 'react';

import { POCKET_RPC_CHANNEL, POCKET_ENDPOINTS, redactStatus, compareVersions } from './api.js';
import { mobileApply } from './mobile/mobile-apply.tsx';

const name = 'dsh-pocket';
const inject = ['slots', 'connection', 'layout', 'locale', 'sessionLogDownload'];

/** Web Push：注册 SW + 订阅（仅安全上下文可用：HTTPS 公网 / localhost）。 */
async function setupPush(rpcCall) {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
    if (!window.isSecureContext) return 'insecure'; // http://LAN-IP 无 Push API
    const reg = await navigator.serviceWorker.register('/pocket-sw.js');
    const vapid = await rpcCall(POCKET_ENDPOINTS.pushVapidKey, {});
    if (!vapid?.ok) return 'host-error';
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapid.value.publicKey),
      });
    }
    const res = await rpcCall(POCKET_ENDPOINTS.pushSubscribe, { subscription: sub.toJSON() });
    return res?.ok ? 'on' : 'host-error';
  } catch {
    return 'error';
  }
}

/** VAPID 公钥（base64url）→ Uint8Array（pushManager.subscribe 需要）。 */
function urlBase64ToUint8Array(base64url) {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const b64 = (base64url + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

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
  const [pushEnabled, setPushEnabled] = useState(true); // 宿主开关
  const [pushState, setPushState] = useState('checking'); // checking|on|unsupported|insecure|off
  const [updateInfo, setUpdateInfo] = useState(null); // { current, latest, updating, result } | null

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

  // 读取宿主开关状态
  useEffect(() => {
    call(POCKET_ENDPOINTS.pushStatus, {}).then((s) => setPushEnabled(s.enabled)).catch(() => {});
  }, []);

  // 版本检测：host 当前版本 vs npm registry latest（registry 带 CORS *）
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const v = await call(POCKET_ENDPOINTS.version, {});
        const meta = await (await fetch('https://registry.npmjs.org/dsh-pocket/latest')).json();
        if (!alive) return;
        const latest = typeof meta?.version === 'string' ? meta.version : null;
        if (latest && v.current && compareVersions(latest, v.current) > 0) {
          setUpdateInfo({ current: v.current, latest, updating: false, result: null });
        }
      } catch { /* 网络失败静默 */ }
    })();
    return () => { alive = false; };
  }, []);

  // 一键更新：调宿主 dsh plugin update
  const runUpdate = async () => {
    setUpdateInfo((u) => ({ ...u, updating: true, result: null }));
    try {
      const r = await call(POCKET_ENDPOINTS.update, {});
      setUpdateInfo((u) => ({ ...u, updating: false, result: r.ok ? 'ok' : 'fail', output: r.output ?? r.error }));
    } catch (err) {
      setUpdateInfo((u) => ({ ...u, updating: false, result: 'fail', output: err.message }));
    }
  };

  // 开启推送：宿主开关开 + 浏览器订阅（安全上下文才有效）
  const enablePush = async () => {
    await call(POCKET_ENDPOINTS.pushSetEnabled, { enabled: true });
    setPushEnabled(true);
    setPushState(await setupPush(rpcCall));
  };

  // 关闭推送：取消浏览器订阅 + 宿主开关关
  const disablePush = async () => {
    try {
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration('/pocket-sw.js');
        const sub = await reg?.pushManager?.getSubscription();
        if (sub) {
          const endpoint = sub.endpoint;
          await sub.unsubscribe();
          await call(POCKET_ENDPOINTS.pushUnsubscribe, { endpoint });
        }
      }
    } catch { /* 忽略 */ }
    await call(POCKET_ENDPOINTS.pushSetEnabled, { enabled: false });
    setPushEnabled(false);
    setPushState('off');
  };

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

    // 更新提示
    updateInfo ? h('div', { style: { ...styles.block, border: '1px solid var(--dsw-alias-state-warn-primary,#b45309)', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-2,#f3f4f6)', padding: '10px 12px' } },
      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 } },
        h('div', { style: { fontWeight: 600, fontSize: 13 } }, `📦 新版本 v${updateInfo.latest} | Update available`),
        updateInfo.result !== 'ok'
          ? h('button', { style: styles.primary, onClick: runUpdate, disabled: updateInfo.updating }, updateInfo.updating ? '更新中…' : `更新到 v${updateInfo.latest} | Update`)
          : null,
      ),
      h('div', { style: styles.muted, marginTop: 4 },
        updateInfo.result === 'ok' ? '✅ 已更新，重启 dsh web 生效 | updated — restart dsh web'
        : updateInfo.result === 'fail' ? `❌ 更新失败：${updateInfo.output || '未知'}（也可手动执行 dsh plugin --profile web update dsh-pocket --latest -w）`
        : `当前 v${updateInfo.current} → 最新 v${updateInfo.latest}`),
    ) : null,

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

    // Web Push 状态 + 开关
    h('div', { style: styles.block },
      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
        h('div', { style: { fontWeight: 600, fontSize: 13 } }, '🔔 推送通知 | Push notifications'),
        pushEnabled
          ? h('button', { style: styles.btn, onClick: disablePush }, '关闭 | Off')
          : h('button', { style: styles.primary, onClick: enablePush }, '开启 | On'),
      ),
      h('div', { style: styles.muted },
        !pushEnabled ? '已关闭：agent 跑完不会推送 | off: no notifications'
        : pushState === 'on' ? '已开启：agent 跑完/出错时手机收到通知 | on: notified when tasks finish or fail'
        : pushState === 'unsupported' ? '已开启（但当前浏览器不支持推送）| on, but this browser does not support push'
        : pushState === 'insecure' ? '已开启，但当前路径不是 HTTPS——推送需要公网隧道或 localhost | on, but push needs HTTPS (public tunnel) or localhost'
        : pushState === 'checking' ? '检查中… | checking…'
        : '推送未生效 | push not active'),
    ),

    error ? h('div', { style: { color: 'var(--dsw-alias-state-error-primary,#dc2626)', fontSize: 12, marginTop: 8 } }, `❌ ${error}`) : null,
  );
}

export function apply(ctx) {
  // 移动端适配（dsh-web-mobile 移植）：抽屉布局/触控/安全区，仅窄屏生效
  mobileApply(ctx);

  const rpcCall = (endpoint, payload, signal) =>
    ctx.connection.rpc.call(POCKET_RPC_CHANNEL, endpoint, payload, signal);

  // 设置一级入口（与 通用设置/模型/插件 同级，order 1 = 通用之后、最外层）
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'pocket',
        order: 1,
        label: () => '手机访问',
        inject: () => ({ rpcCall }),
      },
      PocketSettingsTab,
    ),
  );
}

export { name, inject, redactStatus };
