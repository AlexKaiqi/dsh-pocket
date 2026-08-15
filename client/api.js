// dsh-pocket 设置页签 RPC 契约（client 与 host 共享）
export const POCKET_RPC_CHANNEL = '/dsh-pocket';

export const POCKET_ENDPOINTS = Object.freeze({
  status: 'pocket.status',
  tunnelStart: 'tunnel.start',
  tunnelStop: 'tunnel.stop',
});

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
    dshPort: s?.dshPort ?? null,
  };
}
