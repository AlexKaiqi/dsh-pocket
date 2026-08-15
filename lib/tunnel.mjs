// cloudflared 快速隧道：把本机代理暴露成公网 https URL
//
// 手机在任何网络都能访问；URL 由 cloudflared 随机分配（每次重启会变）。
// 无密码模式：URL 即钥匙（dsh web 能执行代码，请勿把二维码/URL 发给别人）。

import { spawn, execSync } from 'node:child_process';
import { mkdtemp, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createWriteStream } from 'node:fs';

const QUICK_TUNNEL_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

function platformBinary() {
  const archMap = { x64: 'amd64', arm64: 'arm64' };
  const a = archMap[process.arch] ?? process.arch;
  const os = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'windows' : 'linux';
  return { os, a, ext: os === 'windows' ? '.exe' : '' };
}

async function downloadCloudflared(target) {
  const { os, a, ext } = platformBinary();
  const url = `https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-${os}-${a}${ext}`;
  console.log(`⬇️  正在下载 cloudflared（首次运行，之后跳过）…`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`cloudflared 下载失败（HTTP ${res.status}）`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(target));
  if (os !== 'windows') await chmod(target, 0o755);
}

/** PATH 里是否已有 cloudflared。 */
function cloudflaredOnPath() {
  try {
    execSync(process.platform === 'win32' ? 'where cloudflared' : 'command -v cloudflared', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** 拿一个可用的 cloudflared 路径（PATH 没有就下载到临时目录）。 */
async function resolveCloudflared() {
  if (cloudflaredOnPath()) return 'cloudflared';
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pocket-'));
  const bin = join(dir, `cloudflared${platformBinary().ext}`);
  await downloadCloudflared(bin);
  return bin;
}

/**
 * 启动 cloudflared 快速隧道，返回公网 URL。
 * @param {object} opts
 * @param {number} opts.port  本机代理端口
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{url:string, kill:()=>void}>}
 */
export async function startQuickTunnel({ port, signal }) {
  const bin = await resolveCloudflared();
  const child = spawn(bin, ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const url = await new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk) => {
      buf += String(chunk);
      const m = buf.match(QUICK_TUNNEL_URL_RE);
      if (m) {
        cleanup();
        resolve(m[0]);
      }
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`cloudflared 退出（code=${code}）`));
    };
    const cleanup = () => {
      child.stdout.off('data', onData);
      child.stderr.off('data', onData);
      child.off('exit', onExit);
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      child.kill();
      reject(new Error('已取消 | cancelled'));
    };
    const timer = setTimeout(() => {
      cleanup();
      child.kill();
      reject(new Error('cloudflared 启动超时（30s）'));
    }, 30_000);

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', onExit);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

  return {
    url,
    kill: () => {
      try { child.kill(); } catch { /* 忽略 */ }
    },
  };
}
