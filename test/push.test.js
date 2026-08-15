// dsh-pocket Web Push 服务测试（stub web-push，无网络）

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createPushService } from '../lib/push.mjs';

/** stub web-push：记录发送，可模拟失效订阅。 */
function stubWebPush() {
  const sent = [];
  const deadEndpoints = new Set();
  return {
    generateVAPIDKeys: () => ({ publicKey: 'pub-key-1', privateKey: 'priv-key-1' }),
    setVapidDetails: () => {},
    async sendNotification(subscription, payload, opts) {
      sent.push({ endpoint: subscription.endpoint, payload, opts });
      if (deadEndpoints.has(subscription.endpoint)) {
        const e = new Error('gone');
        e.statusCode = 410;
        throw e;
      }
    },
    sent,
    killEndpoint(ep) { deadEndpoints.add(ep); },
  };
}

const SUB_A = { endpoint: 'https://push.example/a', keys: { p256dh: 'k1', auth: 'a1' } };
const SUB_B = { endpoint: 'https://push.example/b', keys: { p256dh: 'k2', auth: 'a2' } };

test('VAPID 密钥：生成一次并持久化；下次复用', async () => {
  const home = await mkdtemp(join(tmpdir(), 'push-'));
  const wp = stubWebPush();
  const s1 = await createPushService({ home, webpush: wp, internals: { mkdir, write: writeFile, read: readFile } });
  const key1 = s1.vapidPublicKey();
  assert.equal(key1, 'pub-key-1');
  // 持久化了
  const saved = JSON.parse(await readFile(join(home, 'dsh-pocket', 'push', 'vapid.json'), 'utf8'));
  assert.equal(saved.publicKey, 'pub-key-1');
  // 新实例复用（不再生成）
  const s2 = await createPushService({ home, webpush: wp, internals: { mkdir, write: writeFile, read: readFile } });
  assert.equal(s2.vapidPublicKey(), 'pub-key-1');
});

test('subscribe/unsubscribe + notify 发送给全部订阅', async () => {
  const home = await mkdtemp(join(tmpdir(), 'push-'));
  const wp = stubWebPush();
  const push = await createPushService({ home, webpush: wp, internals: { mkdir, write: writeFile, read: readFile } });

  assert.equal(await push.subscribe(SUB_A), true);
  assert.equal(await push.subscribe(SUB_B), true);
  assert.equal(push.count(), 2);

  const sent = await push.notify({ title: '✅ 任务完成', body: 'done', url: '/s/1' });
  assert.equal(sent, 2);
  assert.equal(wp.sent.length, 2);
  assert.equal(wp.sent[0].endpoint, 'https://push.example/a');
  const payload = JSON.parse(wp.sent[0].payload);
  assert.equal(payload.title, '✅ 任务完成');
  assert.equal(payload.url, '/s/1');

  assert.equal(await push.unsubscribe(SUB_A.endpoint), true);
  assert.equal(push.count(), 1);
});

test('失效订阅（410）自动清理', async () => {
  const home = await mkdtemp(join(tmpdir(), 'push-'));
  const wp = stubWebPush();
  const push = await createPushService({ home, webpush: wp, internals: { mkdir, write: writeFile, read: readFile } });
  await push.subscribe(SUB_A);
  await push.subscribe(SUB_B);
  wp.killEndpoint(SUB_A.endpoint);

  const sent = await push.notify({ title: 't', body: 'b' });
  assert.equal(sent, 1, '只有 B 发送成功');
  assert.equal(push.count(), 1, '失效的 A 被清理');
  const persisted = JSON.parse(await readFile(join(home, 'dsh-pocket', 'push', 'subscriptions.json'), 'utf8'));
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].endpoint, SUB_B.endpoint);
});

test('无订阅时 notify 返回 0，不调用 web-push', async () => {
  const home = await mkdtemp(join(tmpdir(), 'push-'));
  const wp = stubWebPush();
  const push = await createPushService({ home, webpush: wp, internals: { mkdir, write: writeFile, read: readFile } });
  assert.equal(await push.notify({ title: 't', body: 'b' }), 0);
  assert.equal(wp.sent.length, 0);
});

test('Service Worker 源码：含 push 与 notificationclick 处理', async () => {
  const src = await readFile(join(process.cwd(), 'lib', 'pocket-sw.js'), 'utf8');
  assert.ok(src.includes("addEventListener('push'"), 'push 事件处理');
  assert.ok(src.includes('showNotification'), '显示通知');
  assert.ok(src.includes("addEventListener('notificationclick'"), '点击处理');
  assert.ok(src.includes('clients.openWindow'), '点击打开窗口');
});

test('开关：setEnabled 持久化；关闭时 notify 不发送', async () => {
  const home = await mkdtemp(join(tmpdir(), 'push-'));
  const wp = stubWebPush();
  const push = await createPushService({ home, webpush: wp, internals: { mkdir, write: writeFile, read: readFile } });
  assert.equal(push.isEnabled(), true, '默认开');
  await push.subscribe(SUB_A);

  await push.setEnabled(false);
  assert.equal(push.isEnabled(), false);
  assert.equal(await push.notify({ title: 't', body: 'b' }), 0, '关闭时不发');
  assert.equal(wp.sent.length, 0);

  // 持久化：新实例读取关闭状态
  const push2 = await createPushService({ home, webpush: wp, internals: { mkdir, write: writeFile, read: readFile } });
  assert.equal(push2.isEnabled(), false, '重启后仍为关');
  await push2.setEnabled(true);
  assert.equal(push2.isEnabled(), true);
  assert.equal(await push2.notify({ title: 't', body: 'b' }), 1, '重新开启后可发');
});

test('compareVersions：语义化版本比较', async () => {
  const { compareVersions } = await import('../client/api.js');
  assert.ok(compareVersions('1.0.5', '1.0.4') > 0);
  assert.ok(compareVersions('1.0.4', '1.0.5') < 0);
  assert.equal(compareVersions('1.0.4', '1.0.4'), 0);
  assert.ok(compareVersions('1.10.0', '1.9.9') > 0, '两位数字正确比较');
  assert.ok(compareVersions('1.0.4', '1.0.4-rc.1') > 0, '预发布视为更旧');
});

test('默认路径（不注入 stub）：createPushService 能加载真实 web-push（require 修复回归）', async () => {
  // 不传 webpush → 走 defaultWebPush()；若 require 在 ESM 里未定义会抛 ReferenceError
  const home = await mkdtemp(join(tmpdir(), 'push-real-'));
  const push = await createPushService({ home, internals: { mkdir, write: writeFile, read: readFile } });
  assert.equal(typeof push.vapidPublicKey(), 'string');
  assert.ok(push.vapidPublicKey().length > 20, '真实 VAPID 公钥');
});
