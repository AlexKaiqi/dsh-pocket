// cloudflared 快速隧道：把本机代理暴露成公网 https URL
//
// 手机在任何网络都能访问；URL 由 cloudflared 随机分配（每次重启会变）。
// 无密码模式：URL 即钥匙（dsh web 能执行代码，请勿把二维码/URL 发给别人）。

import { spawn, execSync } from 'node:child_process';
import { mkdir, access, chmod, rm, stat, rename, cp } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
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

/**
 * cloudflared 下载源。
 * 优先：清华 TUNA 镜像的 Homebrew bottle（国内 CDN，实测 ~3MB/s）——仅 macOS/Linux
 * 且有对应 bottle 时可用（Windows 无 Homebrew，自动跳过）。
 * 兜底：官方 GitHub + 国内加速源（ghproxy.net / gh.ddlc.top / gh-proxy.com，2026-08
 * 实测可达）。npmmirror（淘宝）没有 cloudflared 镜像（已实测 404）。
 */
const CLOUDFLARED_MIRRORS = [
  (asset) => `https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`,
  (asset) => `https://ghproxy.net/https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`,
  (asset) => `https://gh.ddlc.top/https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`,
  (asset) => `https://gh-proxy.com/https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`,
];

const TUNA_BOTTLES = 'https://mirrors.tuna.tsinghua.edu.cn/homebrew-bottles/';

function hostOf(url) {
  try { return new URL(url).host; } catch { return url; }
}

/**
 * 清华 TUNA 镜像的 cloudflared Homebrew bottle URL（国内 CDN，实测 ~3MB/s）。
 * 只覆盖 macOS/Linux（Windows 无 Homebrew bottle，返回 null）。
 * 匹配按 CPU 架构取清华目录里版本号最新的 bottle——Homebrew 构建时部署目标
 * 设得较老、向后兼容，所以旧系统（如 Ventura）也能用新一点的 bottle。
 * 抓目录失败/无匹配 → null（调用方回退 GitHub/加速源，不影响可用性）。
 */
async function tsinghuaBottleUrl({ os, a }) {
  if (os !== 'darwin' && os !== 'linux') return null;
  let res;
  try {
    res = await fetch(TUNA_BOTTLES, { signal: AbortSignal.timeout(20_000) });
  } catch { return null; }
  if (!res.ok) return null;
  let html;
  try { html = await res.text(); } catch { return null; }
  // macOS: arm64_<代号> 或 <代号>（Intel 无前缀），代号白名单排除 linux；Linux: arm64_linux / x86_64_linux
  const MACOS_CODES = 'monterey|ventura|sonoma|sequoia|tahoe';
  const pattern = os === 'darwin'
    ? new RegExp(`cloudflared-([0-9.]+)\\.${a === 'arm64' ? 'arm64_' : ''}(${MACOS_CODES})\\.bottle\\.tar\\.gz`, 'g')
    : new RegExp(`cloudflared-([0-9.]+)\\.${a === 'arm64' ? 'arm64' : 'x86_64'}_linux\\.bottle\\.tar\\.gz`, 'g');
  let best = null;
  let bestV = '';
  for (const m of html.matchAll(pattern)) {
    if (m[1] > bestV) { bestV = m[1]; best = m[0]; }
  }
  return best ? `${TUNA_BOTTLES}${best}` : null;
}

async function downloadCloudflared(binPath, signal) {
  const { os, a, ext } = platformBinary();
  const dir = dirname(binPath);
  const tmpFile = join(dir, `cloudflared.download`);
  const isWindows = os === 'windows';
  // 发布资产：Windows 是 .exe（下载即二进制），macOS/Linux 是 .tgz（需解压）
  const asset = isWindows ? `cloudflared-windows-${a}.exe` : `cloudflared-${os}-${a}.tgz`;
  const fetchSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(120_000)])
    : AbortSignal.timeout(120_000);

  // 构建有序源列表：[{url, host}]；清华（如有，仅 macOS/Linux）排第一，再官方 + 加速源
  const sources = [];
  if (!isWindows) {
    const tua = await tsinghuaBottleUrl({ os, a }).catch(() => null);
    if (tua) sources.push({ url: tua, host: 'mirrors.tuna.tsinghua.edu.cn' });
  }
  for (const m of CLOUDFLARED_MIRRORS) sources.push({ url: m(asset), host: hostOf(m(asset)) });

  let lastErr = null;
  for (let i = 0; i < sources.length; i++) {
    const { url, host } = sources[i];
    console.log(`⬇️  下载 cloudflared（${i + 1}/${sources.length}：${host}）…`);
    try {
      const res = await fetch(url, { signal: fetchSignal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(tmpFile));
      // 简单校验：空文件/极小文件视为下载失败（可能是镜像返回了错误页）
      const st = await stat(tmpFile);
      if (st.size < 1024 * 1024) throw new Error(`文件异常小（${st.size} 字节），疑似镜像错误页`);
      lastErr = null;
      break; // 下载成功
    } catch (err) {
      lastErr = err;
      await rm(tmpFile, { force: true }).catch(() => {}); // 清掉半截文件
      console.warn(`  ⚠️ 源 ${i + 1} 失败：${err?.message ?? err}，尝试下一个…`);
    }
  }
  if (lastErr) {
    throw new Error(
      `cloudflared 下载失败：所有源都不通（最后错误：${lastErr?.message ?? lastErr}）。`
      + (isWindows
        ? `Windows 可手动安装后重试：winget install cloudflared；或下载 ${asset} 放到 ${dir} 目录 | download failed — try: winget install cloudflared, or put the exe into ${dir}`
        : `可手动安装后重试：npm i -g cloudflared（装好命令行 cloudflared 即可，无需下载）；或开启代理/换网络后重试 | all mirrors failed — install cloudflared manually: npm i -g cloudflared, then retry`),
    );
  }

  let extracted = join(dir, `cloudflared${ext}`);
  if (isWindows) {
    // Windows：exe 直接就是二进制，无需解压
    await rename(tmpFile, extracted).catch(async () => {
      await cp(tmpFile, extracted).catch(() => {});
    });
  } else {
    // 解压到独立临时子目录（bottle 解压产物会占用 cacheDir/cloudflared 这个名字，
    // 直接解压到 dir 会让目标路径变成目录，rename 失败）
    const extractDir = join(dir, `.extract-${process.pid}-${Date.now()}`);
    await mkdir(extractDir, { recursive: true });
    try {
      await new Promise((resolve, reject) => {
        const child = spawn('tar', ['-xzf', tmpFile, '-C', extractDir], { stdio: 'ignore' });
        child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`cloudflared 解压失败（code=${code}）`)));
        child.once('error', reject);
      });
      // 找真实的二进制**文件**（排除目录）：
      // - GitHub tgz：extractDir/cloudflared
      // - Homebrew bottle（清华）：extractDir/cloudflared/<版本>/bin/cloudflared
      const { readdir } = await import('node:fs/promises');
      let found = null;
      const direct = join(extractDir, `cloudflared${ext}`);
      try { if ((await stat(direct)).isFile()) found = direct; } catch { /* 不存在 */ }
      if (!found) {
        const verDir = join(extractDir, 'cloudflared');
        try {
          const vers = await readdir(verDir);
          for (const v of vers) {
            const bin = join(verDir, v, 'bin', `cloudflared${ext}`);
            try { if ((await stat(bin)).isFile()) { found = bin; break; } } catch { /* 继续 */ }
          }
        } catch { /* 无此目录 */ }
      }
      if (!found) throw new Error('cloudflared 解压成功但未找到二进制 | binary not found after extract');
      if (found !== extracted) {
        await rename(found, extracted).catch(async () => { await cp(found, extracted).catch(() => {}); });
      }
    } finally {
      await rm(extractDir, { recursive: true, force: true }).catch(() => {});
    }
  }
  if (!isWindows) await chmod(extracted, 0o755);
  // 解压/搬移完成就删掉临时下载文件，避免长期占用缓存目录
  await rm(tmpFile, { force: true }).catch(() => {});
  return extracted;
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

/** in-flight 下载（单飞）：并发调用复用同一次，防止交错写入损坏 tgz。 */
let downloading = null;

/**
 * 拿一个可用的 cloudflared 路径。
 * 优先：PATH 已有 → 直接用；否则用持久缓存（$DSH_HOME/dsh-pocket/cloudflared），
 * 只有缓存缺失才下载——避免每次开启公网都重新下 20MB。
 */
export { tsinghuaBottleUrl };

export async function resolveCloudflared({ home, onPhase = () => {}, signal } = {}) {
  if (cloudflaredOnPath()) return 'cloudflared';
  const dshHome = home ?? process.env.DSH_HOME ?? join(homedir(), '.dsh');
  const cacheDir = join(dshHome, 'dsh-pocket', 'bin');
  const bin = join(cacheDir, `cloudflared${platformBinary().ext}`);
  try {
    await access(bin);
    return bin; // 缓存命中，秒开
  } catch { /* 缓存缺失，下载 */ }
  onPhase('downloading');
  await mkdir(cacheDir, { recursive: true });
  if (!downloading) {
    downloading = downloadCloudflared(bin, signal).finally(() => { downloading = null; });
  }
  return downloading;
}

/**
 * 启动 cloudflared 快速隧道，返回公网 URL。
 * @param {object} opts
 * @param {number} opts.port  本机代理端口
 * @param {string} [opts.home] $DSH_HOME（cloudflared 持久缓存）
 * @param {AbortSignal} [opts.signal]
 * @param {(phase:string)=>void} [opts.onPhase] 进度回调：downloading→starting→registering→ready
 * @returns {Promise<{url:string, kill:()=>void}>}
 */
export async function startQuickTunnel({ port, home, signal, onPhase = () => {} }) {
  const bin = await resolveCloudflared({ home, onPhase, signal });
  onPhase('starting');
  // 强制 HTTP/2（TCP 443）而不是默认的 QUIC（UDP 7844）：
  // 国内网络/部分企业网常屏蔽 UDP 7844，导致 tunnel 报 error 1033（Tunnel error）；
  // HTTP/2 走 443 更稳。若平台未来恢复 QUIC 可达，可去掉 --protocol http2。
  const child = spawn(bin, ['tunnel', '--url', `http://127.0.0.1:${port}`, '--protocol', 'http2', '--no-autoupdate'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // H1：spawn 失败（缓存二进制损坏等）必须接住，否则 uncaughtException 崩宿主
  child.on('error', (err) => {
    cleanup?.();
    onPhase?.('error');
    rejectErr?.(new Error(`cloudflared 启动失败：${err?.message ?? err}（可删除 $DSH_HOME/dsh-pocket/bin 缓存后重试）`));
  });
  onPhase('registering');

  let cleanup = null;
  let rejectErr = null;
  const url = await new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk) => {
      buf += String(chunk);
      const m = buf.match(QUICK_TUNNEL_URL_RE);
      if (m) {
        cleanup();
        onPhase('ready');
        resolve(m[0]);
      }
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`cloudflared 退出（code=${code}）`));
    };
    cleanup = () => {
      child.stdout.off('data', onData);
      child.stderr.off('data', onData);
      child.off('exit', onExit);
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      // M4：摘掉监听后管道不再消费 → 64KB 缓冲填满会阻塞 cloudflared → 继续吞掉输出
      child.stdout.resume();
      child.stderr.resume();
    };
    const onAbort = () => {
      cleanup();
      child.kill();
      reject(new Error('已取消 | cancelled'));
    };
    const timer = setTimeout(() => {
      cleanup();
      child.kill();
      reject(new Error(
        'cloudflared 启动超时（30s）——请检查是否开着代理/VPN（Clash 等 TUN 模式会掐断隧道连接），退出代理后重试 | '
        + 'timeout — if you run a proxy/VPN (Clash etc., TUN mode), it can block the tunnel; quit it and retry',
      ));
    }, 30_000);

    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', onExit);
    signal?.addEventListener('abort', onAbort, { once: true });
    rejectErr = reject;
  });

  // M1：隧道进程运行中死亡（崩溃/被杀）→ 通知监听方（service 据此把状态从 ready 打回）
  const exitListeners = new Set();
  child.on('exit', (code) => {
    for (const cb of exitListeners) cb(code);
  });

  return {
    url,
    kill: () => {
      try { child.kill(); } catch { /* 忽略 */ }
    },
    /** 注册「进程已退出」回调，返回取消函数。 */
    onExit: (cb) => {
      exitListeners.add(cb);
      return () => exitListeners.delete(cb);
    },
  };
}
