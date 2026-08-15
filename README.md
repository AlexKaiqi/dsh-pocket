<p align="center">
  <img src="docs/banner.jpg" alt="DSH Pocket" width="100%">
</p>

# DSH Pocket

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-pocket"><img alt="npm" src="https://img.shields.io/npm/v/dsh-pocket?color=4d6bfe&label=npm"></a>
  <a href="https://www.npmjs.com/package/dsh-pocket"><img alt="downloads" src="https://img.shields.io/npm/dm/dsh-pocket?color=4d6bfe"></a>
  <a href="https://github.com/shaobeichen/dsh-pocket/actions"><img alt="CI" src="https://github.com/shaobeichen/dsh-pocket/actions/workflows/npm-publish.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-GPL--2.0-red.svg"></a>
  <a href="https://github.com/shaobeichen/dsh-pocket/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/shaobeichen/dsh-pocket"></a>
</p>

> 把 **DeepSeek Harness 装进你的口袋**：一个包、一个设置页，手机扫二维码就实时看到电脑上的同一个界面——人在外面也能用。
>
> [English](README.en.md) | [中文](README.md)

## 这是什么

`dsh web` 默认只允许本机访问（`127.0.0.1:3080`）。DSH Pocket 在它前面加一层**改头代理**，并直接在 **DSH 网页设置页**里给你二维码：

```
手机 ──扫码──> dsh-pocket 代理 ──> dsh web :3080
                （改写 Host/Origin 为 loopback，DSH 信任栅栏放行）
```

## ✨ 特性

| 特性 | 说明 |
|---|---|
| 📶 局域网扫码 | 装好即用：设置 → 插件 → 手机访问，打开就有局域网二维码，手机连同一 WiFi 扫码即开 |
| 🌐 公网扫码（人在外面） | 点「开启公网访问」→ cloudflared 隧道 → 出公网二维码，4G/任何网络都能访问 |
| ⚡ 实时同步 | 流式输出走 WebSocket 全透传——**电脑上在输出，手机上同步在滚**，可双向操作 |
| 📱 移动端适配 | 窄屏自动变抽屉布局（移植 dsh-web-mobile，MIT）：侧栏抽屉、会话全宽、状态栏安全区、触控优化 |
| 🧩 零依赖安装 | 一个 npm 包、一个设置页，没有核心/适配器要分开装；无需账号、无需服务器 |
| 🔒 URL 即钥匙 | 无公网 URL 暴露给第三方（局域网模式）；公网 URL 每次重启自动换新 |

## 🚀 怎么用

```sh
# 1. 装插件（一个包全都有）
dsh plugin --profile web add dsh-pocket -w

# 2. 重启 dsh web
npx @deepseek-ai/dsh web
```

### 局域网（同一 WiFi）

设置 → 插件 → **手机访问** → 手机扫「📶 局域网」二维码 → 打开的就是电脑上的 DSH，实时同步。

### 公网（人在外面）

同一页点「**开启公网访问**」→ 等隧道建立（首次会下载 cloudflared）→ 手机扫「🌐 公网」二维码 → 人在外面（4G/公司网）也能访问。

> 更新到新版本：`dsh plugin --profile web update dsh-pocket --latest -w`（跨大版本时 `--latest` 是必须的，`^0.x` 范围不会自动升到 1.x）。

## 🧭 原理

DSH 的 `/api` 浏览器信任栅栏只认 loopback 或 `--trusted-host`（官方还禁了 `0.0.0.0` 绑定，防止把远程执行代码暴露给网络）。Pocket 把入站请求的 `Host` / `Origin` 统一改写成 `127.0.0.1:<dsh端口>`，栅栏永远看到 loopback——**不需要改 dsh 的任何配置**。代理随插件自动启动，公网隧道按需开启（cloudflared 强制走 HTTP/2/TCP 443，绕开被网络屏蔽的 QUIC/UDP）。

## ⚠️ 安全（必读）

- **DSH 能执行你电脑上的代码**。二维码/URL 就是钥匙，**请勿把二维码或 URL 发给任何人**
- 公网 URL 由 cloudflared 随机分配，**每次重启会变化**（旧链接自动失效，相当于天然轮换）
- 局域网模式不暴露公网，只有同一网络内的设备能访问
- 适合个人自用；多设备/分享场景后续会加访问令牌

## ⚠️ 公网隧道常见问题（必读）

**现象**：点「开启公网访问」后，手机上打开公网地址报 `error 1033`（Tunnel error）。

**最常见原因：本机开着代理/VPN（Clash、Surge、v2ray、sing-box 等，尤其 TUN 模式）**。
这类工具会接管全部流量，并常常把 cloudflared 的隧道边缘连接
（`*.argotunnel.com`、Cloudflare 边缘 IP）掐断，导致隧道注册成功但数据面连不上。

**解决（三选一）**：

1. 临时**彻底退出代理软件**（不只是关界面：Clash 要右键菜单栏图标 → 退出；若装有
   后台服务还要在服务管理器里停掉，`ps aux | grep clash` 确认进程消失），再重试
2. 给代理加**直连规则**，放行隧道域名与 Cloudflare 边缘（Clash 规则示例）：
   ```yaml
   - DOMAIN-SUFFIX,argotunnel.com,DIRECT
   - DOMAIN-SUFFIX,trycloudflare.com,DIRECT
   - IP-CIDR,198.41.192.0/24,DIRECT,no-resolve
   ```
3. 网络实在不通时，改用**局域网模式**：手机开热点 → 电脑连手机热点 → 扫局域网码，
   效果完全一样（人在外面也能用）

**其他可能**：企业防火墙/校园网拦截出站；此时请让 IT 放行或改用热点。

## 🗂 架构（单包）

| 文件 | 说明 |
|---|---|
| `lib/index.js` | 插件入口：自动起代理 + 注册 RPC（`inject: connection, webServer`） |
| `lib/service.mjs` | 服务：代理生命周期、公网隧道、状态快照（含二维码 data URL） |
| `lib/proxy.mjs` | 改头反向代理：Host/Origin → loopback，HTTP + WebSocket 全透传 + polyfill 注入 |
| `lib/tunnel.mjs` | cloudflared 快速隧道：下载/解压/启动/解析公网 URL（HTTP/2） |
| `lib/web-rpc.js` | loopback RPC：`pocket.status` / `tunnel.start` / `tunnel.stop` |
| `client/` | 设置页「手机访问」+ 移动端适配（dsh-web-mobile 移植） |
| `bin/dsh-pocket.mjs` | CLI：局域网/公网模式，打印 URL + 二维码 |

## 🛠 开发

```sh
npm install
node client/build.mjs   # 改 client/ 后重新打包
npm test                # 代理改写 / WS 透传 / 隧道 / 服务 / RPC（7 测试）
```

## 🤝 致谢

- 移动端适配移植自 [mexiaosqwq/dsh-web-mobile](https://github.com/mexiaosqwq/dsh-web-mobile)（MIT）
- 公网隧道基于 [cloudflared](https://github.com/cloudflare/cloudflared)

## 📄 License

[GPL-2.0](LICENSE) —— 自由软件许可：可自由使用、修改、分发，但**修改版必须同样以 GPL 开源**并保留版权声明；商用同样适用。

> 说明：移动端适配部分移植自 [dsh-web-mobile](https://github.com/mexiaosqwq/dsh-web-mobile)（MIT 许可，兼容 GPL），其版权声明保留在 `client/mobile/LICENSE.dsh-web-mobile`。
