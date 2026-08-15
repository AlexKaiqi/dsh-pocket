// dsh-pocket 自重启：重新拉起启动本宿主的确切 dsh 调用（脱离父进程），
// 让更新后的插件代码生效——用户无需离开界面手动重启（借鉴 dshmarket 的
// self-restart 方案，见 https://github.com/dsh-market/dsh-market lib/restart.js）。
//
// 原理：本插件运行在 dsh web 进程内，process.argv 即 dsh CLI 的启动参数
// （如 node <bin.js> web [flags]）。用相同参数 detached 拉起新进程，
// 短暂等待后旧进程退出，新进程接管端口。

import { spawn } from 'node:child_process';

/**
 * 重建启动调用（与当前宿主相同的命令）。
 * @returns {{file:string, args:string[]}}
 */
export function restartLaunch() {
  return {
    file: process.argv[0], // node
    args: [process.argv[1], ...process.argv.slice(2)], // <bin.js> + web [flags]
  };
}

/**
 * 拉起替代宿主（detached），随后退出当前进程。
 * @param {object} opts
 * @param {number} [opts.exitDelayMs] 等待新进程接管后再退出（默认 800ms）
 * @param {object} [opts.internals] 测试注入：spawnFn / exitFn
 * @returns {{spawned:boolean, file:string}}
 */
export function restartHost({ exitDelayMs = 800, internals = {} } = {}) {
  const spawnFn = internals.spawn ?? spawn;
  const exitFn = internals.exit ?? ((code) => process.exit(code));
  const { file, args } = restartLaunch();
  try {
    const child = spawnFn(file, args, {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.unref?.();
    setTimeout(() => exitFn(0), exitDelayMs);
    return { spawned: true, file };
  } catch (err) {
    return { spawned: false, error: err?.message ?? String(err) };
  }
}
