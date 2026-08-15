# DSH Pocket

把 **DeepSeek Harness 装进你的口袋**：电脑上跑 `dsh web`，手机扫一下二维码，就实时看到电脑上的同一个界面——人在外面也能用。

> EN: Put DeepSeek Harness in your pocket. Scan a QR code on your phone and see exactly what's on your computer screen — live, anywhere.

## 这是什么

`dsh web` 默认只允许本机访问（`127.0.0.1:3080`）。DSH Pocket 在它前面加一层**改头代理**：

```
手机 ──扫码──> dsh-pocket 代理 ──> dsh web :3080
                （改写 Host/Origin 为 loopback，栅栏放行）
```

- **局域网**：手机连同一 WiFi，扫码即访问（`http://电脑IP:3081`）
- **公网**：加 `--public`，cloudflared 隧道生成 https 网址，人在外面也能访问
- **实时同步**：DSH 网页的流式输出走 WebSocket，代理原样透传——**电脑上看到什么，手机上就是什么**，不用任何密码、不用装 App

## 安装与使用

```sh
# 前提：dsh web 已在 127.0.0.1:3080 运行
npx @deepseek-ai/dsh web &

# 方式一：局域网（手机连同一 WiFi）
npx -y dsh-pocket

# 方式二：公网（人在外面；首次运行自动下载 cloudflared）
npx -y dsh-pocket --public
```

启动后终端打印二维码，手机相机/微信扫码即打开 DSH，界面与电脑完全一致、实时同步。

## ⚠️ 安全（必读）

- **DSH 能执行你电脑上的代码**。这个工具的设计就是"URL 即钥匙"——**请勿把二维码或 URL 发给任何人**
- 公网 URL 由 cloudflared 随机分配，**每次重启会变化**（旧链接自动失效，相当于天然轮换）
- 适合个人自用。如果要多设备/分享使用，后续版本会加访问令牌与设备管理

## 架构

| 模块 | 说明 |
|---|---|
| `lib/proxy.mjs` | 改头反向代理：Host/Origin → loopback，HTTP + WebSocket 全透传（核心） |
| `lib/tunnel.mjs` | cloudflared 快速隧道：下载/启动/解析公网 URL |
| `bin/dsh-pocket.mjs` | CLI：局域网/公网模式，打印 URL + 二维码 |

原理细节：DSH 的 `/api` 浏览器信任栅栏只认 loopback 或 `--trusted-host`（官方还禁了 `0.0.0.0` 绑定，防止把远程执行代码暴露给网络）。Pocket 把入站请求的 `Host` / `Origin` 统一改写成 `127.0.0.1:3080`，栅栏永远看到 loopback——**不需要改 dsh 的任何配置**。

## 开发

```sh
npm install
npm test    # 代理改写 + WebSocket 透传 + 502 兜底
```

## License

MIT
