// dsh-pocket Web RPC（loopback-only）：设置页 ⇄ Host 的手机访问通道

import { POCKET_RPC_CHANNEL, POCKET_ENDPOINTS, redactStatus } from '../client/api.js';

function ok(value) {
  return { ok: true, value };
}

function fail(code, message) {
  return { ok: false, error: { code, message } };
}

/** 注册 /dsh-pocket 逻辑通道（仅本机 loopback 可调）。 */
export function installPocketRpc(ctx, { service, log = console }) {
  if (!ctx?.connection?.rpc?.handle) {
    log.warn?.('dsh-pocket: DSH Host Connection RPC unavailable — settings tab disabled | 无 Connection RPC，设置页不可用');
    return () => {};
  }
  return ctx.connection.rpc.handle(POCKET_RPC_CHANNEL, async (endpoint, _payload = {}, signal) => {
    if (signal?.aborted) return fail('cancelled', 'The request was cancelled.');

    try {
      if (endpoint === POCKET_ENDPOINTS.status) {
        return ok(redactStatus(await service.status()));
      }
      if (endpoint === POCKET_ENDPOINTS.tunnelStart) {
        await service.startTunnel();
        return ok(redactStatus(await service.status()));
      }
      if (endpoint === POCKET_ENDPOINTS.tunnelStop) {
        service.stopTunnel();
        return ok(redactStatus(await service.status()));
      }
      return fail('bad-request', `Unknown endpoint: ${endpoint}`);
    } catch (err) {
      log.error?.('dsh-pocket: rpc %s failed | RPC 失败: %s', endpoint, err?.message ?? err);
      return fail('internal', err?.message ?? String(err));
    }
  }, { authority: 'loopback' });
}
