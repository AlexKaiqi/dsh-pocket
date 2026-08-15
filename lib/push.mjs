// dsh-pocket Web Push 服务（Agent 跑完/出错 → 手机推送通知，即使没开页面）
//
// 原理：浏览器 Push API（Service Worker + pushManager.subscribe）把订阅
// 交给我们，我们在 dsh web 进程内用 web-push（VAPID 认证 + RFC 8030 协议）
// 直接推送到浏览器厂商的推送服务（Chrome→FCM / Firefox→Mozilla / Safari→APNs）。
// 免费、无需第三方账号；VAPID 密钥与订阅存本机。
//
// ⚠️ 硬性前提：Web Push 只在**安全上下文**可用（HTTPS 或 localhost）。
//    - 公网隧道 https://xxx.trycloudflare.com ✅（人在外面的主场景）
//    - 桌面 localhost:3080 ✅
//    - 局域网 http://192.168.x.x ❌（明文 HTTP 没有 Push API）

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const DATA_REL = join('dsh-pocket', 'push');
const VAPID_FILE = 'vapid.json';
const SUBS_FILE = 'subscriptions.json';
const SETTINGS_FILE = 'settings.json';

function defaultWebPush() {
  // web-push 是 CJS，ESM 里必须经 createRequire 加载
  return require('web-push');
}

/**
 * 创建推送服务。
 * @param {object} opts
 * @param {string} [opts.home]      $DSH_HOME（默认 ~/.dsh）
 * @param {object} [opts.webpush]   web-push 库（测试注入 stub）
 * @param {string} [opts.subject]   VAPID subject（mailto:）
 * @param {object} [opts.log]       日志（默认 console）
 * @param {object} [opts.internals] 测试注入：mkdir/write/read
 * @returns {Promise<PushService>}
 */
export async function createPushService({
  home,
  webpush = defaultWebPush(),
  subject = 'mailto:shaobeichen@outlook.com',
  log = console,
  internals = {},
} = {}) {
  const dshHome = home ?? process.env.DSH_HOME ?? join(homedir(), '.dsh');
  const dir = join(dshHome, DATA_REL);
  const vapidPath = join(dir, VAPID_FILE);
  const subsPath = join(dir, SUBS_FILE);
  const settingsPath = join(dir, SETTINGS_FILE);
  const mkdirFn = internals.mkdir ?? mkdir;
  const read = internals.read ?? readFile;
  const write = internals.write ?? writeFile;

  await mkdirFn(dir, { recursive: true });

  // 开关状态：默认开，持久化到 settings.json
  let enabled = true;
  try {
    const s = JSON.parse(await read(settingsPath, 'utf8'));
    if (typeof s.enabled === 'boolean') enabled = s.enabled;
  } catch { /* 默认开 */ }
  if (internals.enabled !== undefined) enabled = internals.enabled === true;

  // VAPID 密钥：生成一次，持久化
  let vapid;
  try {
    vapid = JSON.parse(await read(vapidPath, 'utf8'));
  } catch {
    vapid = webpush.generateVAPIDKeys();
    await write(vapidPath, JSON.stringify(vapid, null, 2) + '\n', { mode: 0o600 });
  }
  webpush.setVapidDetails(subject, vapid.publicKey, vapid.privateKey);

  // 订阅集合：endpoint → subscription
  let subs = new Map();
  try {
    for (const s of JSON.parse(await read(subsPath, 'utf8')) ?? []) {
      if (s?.endpoint) subs.set(s.endpoint, s);
    }
  } catch { /* 空开始 */ }

  const persist = async () => {
    await write(subsPath, JSON.stringify([...subs.values()], null, 2) + '\n', { mode: 0o600 });
  };

  return {
    vapidPublicKey: () => vapid.publicKey,
    count: () => subs.size,
    isEnabled: () => enabled,

    /** 设置推送总开关（持久化）。 */
    async setEnabled(value) {
      enabled = value === true;
      await write(settingsPath, JSON.stringify({ enabled }, null, 2) + '\n', { mode: 0o600 });
      return enabled;
    },

    /** 记录浏览器订阅。 */
    async subscribe(subscription) {
      if (!subscription?.endpoint || !subscription?.keys) return false;
      subs.set(subscription.endpoint, subscription);
      await persist();
      return true;
    },

    /** 按 endpoint 取消订阅。 */
    async unsubscribe(endpoint) {
      const removed = subs.delete(endpoint);
      if (removed) await persist();
      return removed;
    },

    /**
     * 推送通知到所有订阅；失效订阅自动清理。
     * @param {object} opts
     * @param {string} opts.title
     * @param {string} [opts.body]
     * @param {string} [opts.url]     点击通知打开的地址（默认 /）
     * @param {object} [opts.data]     额外载荷
     */
    async notify({ title, body = '', url = '/', data = {} }) {
      if (!enabled || subs.size === 0) return 0;
      const payload = JSON.stringify({ title, body, url, ...data });
      let sent = 0;
      for (const [endpoint, sub] of [...subs.entries()]) {
        try {
          await webpush.sendNotification(sub, payload, { TTL: 600 });
          sent += 1;
        } catch (err) {
          // 410 Gone / 404 = 订阅失效，清理
          const code = err?.statusCode;
          if (code === 410 || code === 404) {
            subs.delete(endpoint);
            await persist();
          } else {
            log.warn?.('dsh-pocket: push send failed (endpoint %s…) | 推送失败: %s', String(endpoint).slice(0, 48), err?.message ?? err);
          }
        }
      }
      return sent;
    },

    async dispose() { /* 无长连接需要清理 */ },
  };
}
