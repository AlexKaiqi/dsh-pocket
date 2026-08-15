<p align="center">
  <img src="docs/banner.jpg" alt="DSH Pocket" width="100%">
</p>

# DSH Pocket

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-pocket"><img alt="npm" src="https://img.shields.io/npm/v/dsh-pocket?color=4d6bfe&label=npm"></a>
  <a href="https://www.npmjs.com/package/dsh-pocket"><img alt="downloads" src="https://img.shields.io/npm/dm/dsh-pocket?color=4d6bfe"></a>
  <a href="https://github.com/shaobeichen/dsh-pocket/actions"><img alt="CI" src="https://github.com/shaobeichen/dsh-pocket/actions/workflows/npm-publish.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <a href="https://github.com/shaobeichen/dsh-pocket/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/shaobeichen/dsh-pocket"></a>
</p>

> Put **DeepSeek Harness in your pocket**: one package, one settings tab — scan a QR code and your phone shows exactly what's on your computer screen, live, from anywhere.
>
> [English](README.en.md) | [中文](README.md)

## What is this

`dsh web` only allows local access by default (`127.0.0.1:3080`). DSH Pocket puts a **header-rewriting proxy** in front of it and hands you QR codes right in the DSH web settings page:

```
Phone ──scan──> dsh-pocket proxy ──> dsh web :3080
                 (rewrites Host/Origin to loopback; passes DSH's trust fence)
```

## ✨ Features

| Feature | Description |
|---|---|
| 📶 LAN QR access | Works out of the box: Settings → Plugins → Phone access — scan the LAN QR on the same Wi-Fi |
| 🌐 Public QR (from anywhere) | Click "Enable anywhere" → cloudflared tunnel → scan the public QR over 4G / any network |
| ⚡ Real-time sync | Streaming output passes through WebSocket untouched — what the computer renders, the phone renders live; fully interactive both ways |
| 📱 Mobile-adaptive layout | Narrow screens get a drawer layout automatically (ported from dsh-web-mobile, MIT): sidebar drawer, full-width conversation, safe-area insets, touch optimizations |
| 🧩 Zero-dependency install | One npm package, one settings tab — no core/adapter split, no account, no server |
| 🔒 URL is the key | No public URL exposure in LAN mode; public URL rotates on every restart |

## 🚀 Usage

```sh
# 1. Install the plugin (everything in one package)
dsh plugin --profile web add dsh-pocket -w

# 2. Restart dsh web
npx @deepseek-ai/dsh web
```

### LAN (same Wi-Fi)

Settings → Plugins → **Phone access** → scan the "📶 LAN" QR code → the phone opens the exact same DSH, in real time.

### Public (from anywhere)

On the same page click "**Enable anywhere**" → wait for the tunnel (first run downloads cloudflared) → scan the "🌐 Public" QR code → works from outside (4G / office network).

> Upgrading: `dsh plugin --profile web update dsh-pocket --latest -w` (`--latest` is required across major versions — a `^0.x` range won't auto-jump to 1.x).

## 🧭 How it works

DSH's `/api` browser-trust fence only accepts loopback or `--trusted-host` authorities (and the official build refuses `0.0.0.0` binding to avoid exposing remote code execution to the network). Pocket rewrites every inbound request's `Host` / `Origin` to `127.0.0.1:<dsh-port>`, so the fence always sees loopback — **no dsh configuration changes needed**. The proxy auto-starts with the plugin; the public tunnel is on demand (cloudflared forced to HTTP/2 over TCP 443 to bypass blocked QUIC/UDP).

## ⚠️ Security (read first)

- **DSH can execute code on your computer.** The QR code / URL is the key — **never share it with anyone**.
- The public URL is randomly assigned by cloudflared and **changes on every restart** (old links die automatically — a natural key rotation).
- LAN mode exposes nothing publicly; only devices on the same network can reach it.
- Built for personal use; access tokens for multi-device/sharing are planned.

## ⚠️ Public tunnel troubleshooting (read first)

**Symptom**: after clicking "Enable anywhere", the public URL shows `error 1033` (Tunnel error) on the phone.

**Most common cause: a local proxy/VPN (Clash, Surge, v2ray, sing-box, etc., especially in TUN mode).**
Such tools take over all traffic and often cut cloudflared's tunnel-edge connections
(`*.argotunnel.com`, Cloudflare edge IPs), so the tunnel registers but the data plane never connects.

**Fix (any one of)**:

1. Temporarily **fully quit the proxy** (not just close the window: quit Clash from the menu-bar icon; if a
   background service is installed, stop it in the service manager and confirm with `ps aux | grep clash`), then retry.
2. Add **DIRECT rules** to the proxy for the tunnel domains and Cloudflare edge (Clash example):
   ```yaml
   - DOMAIN-SUFFIX,argotunnel.com,DIRECT
   - DOMAIN-SUFFIX,trycloudflare.com,DIRECT
   - IP-CIDR,198.41.192.0/24,DIRECT,no-resolve
   ```
3. If the network really can't reach the tunnel, use **LAN mode**: turn on the phone hotspot → connect the computer to it → scan the LAN QR. Same experience, from anywhere.

**Other causes**: corporate firewalls / campus networks blocking outbound — ask IT to allow it, or use a hotspot.

## 🗂 Architecture (single package)

| File | Purpose |
|---|---|
| `lib/index.js` | Plugin entry: auto-start proxy + register RPC (`inject: connection, webServer`) |
| `lib/service.mjs` | Service: proxy lifecycle, public tunnel, status snapshot (with QR data URLs) |
| `lib/proxy.mjs` | Header-rewriting reverse proxy: Host/Origin → loopback, HTTP + WebSocket passthrough + polyfill injection |
| `lib/tunnel.mjs` | cloudflared quick tunnel: download/extract/start/parse public URL (HTTP/2) |
| `lib/web-rpc.js` | Loopback RPC: `pocket.status` / `tunnel.start` / `tunnel.stop` |
| `client/` | "Phone access" settings tab + mobile adaptation (dsh-web-mobile port) |
| `bin/dsh-pocket.mjs` | CLI: LAN/public modes, prints URL + QR |

## 🛠 Development

```sh
npm install
node client/build.mjs   # rebuild after editing client/
npm test                # proxy rewrite / WS passthrough / tunnel / service / RPC (7 tests)
```

## 🤝 Credits

- Mobile adaptation ported from [mexiaosqwq/dsh-web-mobile](https://github.com/mexiaosqwq/dsh-web-mobile) (MIT)
- Public tunnel powered by [cloudflared](https://github.com/cloudflare/cloudflared)

## 📄 License

MIT
