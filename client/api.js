// dsh-pocket 设置页签 RPC 契约（client 与 host 共享）
export const POCKET_RPC_CHANNEL = '/dsh-pocket';

export const POCKET_ENDPOINTS = Object.freeze({
  status: 'pocket.status',
  tunnelStart: 'tunnel.start',
  tunnelStop: 'tunnel.stop',
  pushVapidKey: 'push.vapidKey',
  pushSubscribe: 'push.subscribe',
  pushUnsubscribe: 'push.unsubscribe',
  pushStatus: 'push.status',
  pushSetEnabled: 'push.setEnabled',
  version: 'pocket.version',
  update: 'pocket.update',
  restart: 'pocket.restart',
});

/** 语义化版本比较：a > b 返回正数，相等 0，a < b 负数（仅数字段；带预发布后缀的更旧）。 */
export function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split('.');
  const pb = String(b).replace(/^v/, '').split('.');
  for (let i = 0; i < 3; i++) {
    const x = parseInt(pa[i], 10) || 0;
    const y = parseInt(pb[i], 10) || 0;
    if (x !== y) return x - y;
  }
  // 数字段相等：带预发布（-）的更旧
  const aPre = /-/.test(pa[2] ?? '');
  const bPre = /-/.test(pb[2] ?? '');
  if (aPre !== bPre) return aPre ? -1 : 1;
  return 0;
}

/** 浏览器可见的状态字段（无敏感信息；含二维码 data URL）。 */
export function redactStatus(s) {
  return {
    proxyRunning: s?.proxyRunning === true,
    proxyPort: s?.proxyPort ?? null,
    lanUrl: s?.lanUrl ?? null,
    lanQr: s?.lanQr ?? null,
    tunnelRunning: s?.tunnelRunning === true,
    tunnelUrl: s?.tunnelUrl ?? null,
    tunnelQr: s?.tunnelQr ?? null,
    tunnelState: s?.tunnelState ?? { phase: 'idle' },
    dshPort: s?.dshPort ?? null,
  };
}
