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
