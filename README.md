# DSH Pocket

把 **DeepSeek Harness 装进你的口袋**：一个包、一个设置页，手机扫二维码就实时看到电脑上的同一个界面——人在外面也能用。

> EN: Put DeepSeek Harness in your pocket. One package, one settings tab — scan a QR code and your phone shows exactly what's on your computer screen, live, anywhere.

## 这是什么

`dsh web` 默认只允许本机访问（`127.0.0.1:3080`）。DSH Pocket 在它前面加一层**改头代理**，并直接在 **DSH 网页设置页**里给你二维码：

```
手机 ──扫码──> dsh-pocket 代理 ──> dsh web :3080
                （改写 Host/Origin 为 loopback，DSH 信任栅栏放行）
```

- **局域网**：装好插件，设置 → 插件 → **手机访问**，打开就有一个局域网二维码——手机连同一 WiFi 扫码即用
- **公网**：同一页点「**开启公网访问**」，出第二个二维码——人在外面（4G/公司网）也能访问
- **实时同步**：DSH 的流式输出走 WebSocket，代理原样透传——**电脑上看到什么，手机上就是什么**

## 安装

```sh
dsh plugin --profile web add dsh-pocket -w
```

重启 `dsh web` → 设置 → 插件 → **手机访问**。**就这一个包，没有核心/适配器要分开装。**

## ⚠️ 安全（必读）

- **DSH 能执行你电脑上的代码**。二维码/URL 就是钥匙，**请勿把二维码或 URL 发给任何人**
- 公网 URL 由 cloudflared 随机分配，**每次重启 dsh web 会变化**（旧链接自动失效，相当于天然轮换）
- 适合个人自用；多设备/分享场景后续会加访问令牌

## 原理

DSH 的 `/api` 浏览器信任栅栏只认 loopback 或 `--trusted-host`（官方还禁了 `0.0.0.0` 绑定，防止把远程执行代码暴露给网络）。Pocket 把入站请求的 `Host` / `Origin` 统一改写成 `127.0.0.1:<dsh端口>`，栅栏永远看到 loopback——**不需要改 dsh 的任何配置**。代理随插件自动启动，公网隧道按需开启（首次自动下载 cloudflared）。

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

## 架构（单包）

| 文件 | 说明 |
|---|---|
| `lib/index.js` | 插件入口：自动起代理 + 注册 RPC（`inject: connection, webServer`） |
| `lib/service.mjs` | 服务：代理生命周期、公网隧道、状态快照（含二维码 data URL） |
| `lib/proxy.mjs` | 改头反向代理：Host/Origin → loopback，HTTP + WebSocket 全透传 |
| `lib/tunnel.mjs` | cloudflared 快速隧道：下载/启动/解析公网 URL |
| `lib/web-rpc.js` | loopback RPC：`pocket.status` / `tunnel.start` / `tunnel.stop` |
| `client/` | 设置页「手机访问」标签（React，esbuild 打包） |

## 开发

```sh
npm install
node client/build.mjs   # 改 client/index.jsx 后重新打包
npm test                # 代理改写 + WS 透传 + 服务 + RPC（5 个测试）
```

## License

MIT
