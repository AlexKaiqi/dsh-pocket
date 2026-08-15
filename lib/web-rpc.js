// dsh-pocket Web RPC（loopback-only）：设置页 ⇄ Host 的手机访问通道

import { POCKET_RPC_CHANNEL, POCKET_ENDPOINTS, redactStatus } from '../client/api.js';

function ok(value) {
  return { ok: true, value };
}

/**
 * 构造符合 DSH rpcErrorSchema 的错误（按 code 的 discriminated union，
 * details 必填且分分支定形；'internal' 不在合法 code 集合里）。
 */
function fail(code, message) {
  if (code === 'cancelled') return { ok: false, error: { code: 'cancelled', message, details: {} } };
  // 其余一律归入 bad-request（issues 是自由数组）
  return { ok: false, error: { code: 'bad-request', message, details: { issues: [{ message }] } } };
}

/** 注册 /dsh-pocket 逻辑通道（仅本机 loopback 可调）。 */
export function installPocketRpc(ctx, { service, push, log = console }) {
  if (!ctx?.connection?.rpc?.handle) {
    log.warn?.('dsh-pocket: DSH Host Connection RPC unavailable — settings tab disabled | 无 Connection RPC，设置页不可用');
    return () => {};
  }
  return ctx.connection.rpc.handle(POCKET_RPC_CHANNEL, async (endpoint, payload = {}, signal) => {
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
      if (endpoint === POCKET_ENDPOINTS.pushVapidKey) {
        return ok({ publicKey: push.vapidPublicKey() });
      }
      if (endpoint === POCKET_ENDPOINTS.pushSubscribe) {
        const added = await push.subscribe(payload?.subscription);
        return ok({ subscribed: added, count: push.count() });
      }
      if (endpoint === POCKET_ENDPOINTS.pushUnsubscribe) {
        const removed = await push.unsubscribe(payload?.endpoint);
        return ok({ removed, count: push.count() });
      }
      if (endpoint === POCKET_ENDPOINTS.pushStatus) {
        return ok({ enabled: push.count() > 0, count: push.count() });
      }
      return fail('bad-request', `Unknown endpoint: ${endpoint}`);
    } catch (err) {
      log.error?.('dsh-pocket: rpc %s failed | RPC 失败: %s', endpoint, err?.message ?? err);
      return fail('bad-request', err?.message ?? String(err));
    }
  }, { authority: 'loopback' });
}
