// dsh-pocket 自重启：重新拉起启动本宿主的确切 dsh 调用（detached 交接），
// 让更新后的插件代码生效——用户无需离开界面手动重启。
//
// 方案借鉴 dshmarket 的 self-restart（lib/restart.js，MIT）：不直接拉起新
// 进程，而是先拉一个 detached 的 node 辅助进程，等旧进程退出、端口释放
// （1.5s）后再拉起新 dsh，并把新进程输出写入临时日志——避免端口竞争
// （EADDRINUSE）导致新进程静默崩溃。
//
// 注意：新进程 detached，不挂终端——停止方式：lsof -ti :3080 | xargs kill -9。

import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** 重建启动调用（与当前宿主相同的命令）。 */
export function restartLaunch() {
  return {
    file: process.argv[0], // node
    args: [process.argv[1], ...process.argv.slice(2)], // <bin.js> + web [flags]
    cwd: process.cwd(),
  };
}

/** 辅助进程代码：等待 1.5s（旧进程释放端口）→ 拉起新 dsh → 输出写日志。 */
function helperCode(launch, logOut, logErr) {
  const spawn = "const { spawn } = require('node:child_process')";
  const fs = "const fs = require('node:fs')";
  const file = `const file = ${JSON.stringify(launch.file)}`;
  const args = `const args = ${JSON.stringify(launch.args)}`;
  const cwd = `const cwd = ${JSON.stringify(launch.cwd)}`;
  const o = `const logOut = ${JSON.stringify(logOut)}`;
  const e = `const logErr = ${JSON.stringify(logErr)}`;
  const body = [
    'setTimeout(() => {',
    '  try {',
    '    const out = fs.openSync(logOut, "a")',
    '    const err = fs.openSync(logErr, "a")',
    '    const child = spawn(file, args, { cwd, detached: true, stdio: ["ignore", out, err], env: process.env })',
    '    child.unref()',
    '  } catch {}',
    '}, 1500)',
  ].join('\n');
  return [spawn, fs, file, args, cwd, o, e, body].join('\n');
}

/**
 * 拉起替代宿主（detached 辅助进程交接），随后结束当前进程。
 * @param {object} opts
 * @param {number} [opts.handoffMs] 等待旧进程释放端口的时长（默认 1500ms）
 * @param {object} [opts.internals] 测试注入：spawn / kill
 * @returns {{helperPid:number|null, logOut:string, logErr:string}}
 */
export function restartHost({ handoffMs = 1500, internals = {} } = {}) {
  const spawnFn = internals.spawn ?? spawn;
  const killFn = internals.kill ?? ((pid) => process.kill(pid, 'SIGTERM'));
  const launch = restartLaunch();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const logOut = join(tmpdir(), `dsh-pocket-restart-${stamp}.out.log`);
  const logErr = join(tmpdir(), `dsh-pocket-restart-${stamp}.err.log`);

  let helperPid = null;
  try {
    const helper = spawnFn(process.execPath, ['-e', helperCode(launch, logOut, logErr)], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    helper.unref?.();
    helperPid = helper.pid ?? null;
    // 短暂等待后结束当前进程（释放端口）；由辅助进程在 1.5s 后拉起新宿主
    setTimeout(() => { try { killFn(process.pid); } catch { /* 忽略 */ } }, 500);
  } catch (err) {
    return { helperPid: null, logOut, logErr, error: err?.message ?? String(err) };
  }
  return { helperPid, logOut, logErr };
}
