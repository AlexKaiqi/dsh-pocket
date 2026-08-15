window.__ModuleLoader__.load({
  id: "dsh-pocket",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// client/index.jsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name,
  redactStatus: () => redactStatus
});
module.exports = __toCommonJS(index_exports);
var import_react = require("react");

// client/api.js
var POCKET_RPC_CHANNEL = "/dsh-pocket";
var POCKET_ENDPOINTS = Object.freeze({
  status: "pocket.status",
  tunnelStart: "tunnel.start",
  tunnelStop: "tunnel.stop"
});
function redactStatus(s) {
  return {
    proxyRunning: s?.proxyRunning === true,
    proxyPort: s?.proxyPort ?? null,
    lanUrl: s?.lanUrl ?? null,
    lanQr: s?.lanQr ?? null,
    tunnelRunning: s?.tunnelRunning === true,
    tunnelUrl: s?.tunnelUrl ?? null,
    tunnelQr: s?.tunnelQr ?? null,
    dshPort: s?.dshPort ?? null
  };
}

// client/index.jsx
var name = "dsh-pocket";
var inject = ["slots", "connection"];
var styles = {
  card: { background: "var(--dsw-alias-bg-layer-1,#fff)", border: "1px solid var(--dsw-alias-border-l2,#e5e7eb)", borderRadius: 12, padding: "14px 16px", maxWidth: 480 },
  block: { borderTop: "1px solid var(--dsw-alias-border-l2,#e5e7eb)", marginTop: 12, paddingTop: 12 },
  muted: { color: "var(--dsw-alias-label-tertiary,#8b93a1)", fontSize: 12 },
  code: { fontFamily: "ui-monospace,Menlo,monospace", fontSize: 12, wordBreak: "break-all", margin: "4px 0 8px" },
  primary: { font: "inherit", cursor: "pointer", border: "none", background: "var(--dsw-alias-brand-primary,#4f6ef7)", color: "#fff", borderRadius: 8, padding: "6px 14px", fontSize: 13 },
  btn: { font: "inherit", cursor: "pointer", border: "1px solid var(--dsw-alias-border-l2,#e5e7eb)", background: "var(--dsw-alias-bg-layer-1,#fff)", borderRadius: 8, padding: "6px 14px", fontSize: 13 },
  qr: { width: 220, height: 220, borderRadius: 8, border: "1px solid var(--dsw-alias-border-l2,#e5e7eb)", margin: "6px 0" },
  warn: { color: "var(--dsw-alias-state-warn-primary,#b45309)", fontSize: 12 }
};
function PocketSettingsTab({ rpcCall }) {
  const [status, setStatus] = (0, import_react.useState)(null);
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [error, setError] = (0, import_react.useState)(null);
  const call = async (endpoint, payload) => {
    const res = await rpcCall(endpoint, payload);
    if (!res?.ok) throw new Error(res?.error?.message ?? "RPC failed");
    return res.value;
  };
  const load = async () => {
    try {
      setStatus(await call(POCKET_ENDPOINTS.status, {}));
    } catch {
    }
  };
  (0, import_react.useEffect)(() => {
    load();
    const t = setInterval(load, 3e3);
    return () => clearInterval(t);
  }, []);
  const startTunnel = async () => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await call(POCKET_ENDPOINTS.tunnelStart, {}));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const stopTunnel = async () => {
    try {
      setStatus(await call(POCKET_ENDPOINTS.tunnelStop, {}));
    } catch {
    }
  };
  const lanUrl = status?.lanUrl;
  const tunnelUrl = status?.tunnelUrl;
  return (0, import_react.createElement)(
    "div",
    { style: styles.card },
    (0, import_react.createElement)(
      "div",
      null,
      (0, import_react.createElement)("strong", null, "\u{1F4F1} \u624B\u673A\u8BBF\u95EE | Phone access"),
      (0, import_react.createElement)("div", { style: styles.muted }, "\u624B\u673A\u626B\u7801\u6253\u5F00\u7684\u5C31\u662F\u7535\u8111\u4E0A\u7684\u8FD9\u4E2A\u754C\u9762\uFF0C\u5B9E\u65F6\u540C\u6B65 | the phone shows this exact screen, live")
    ),
    // 局域网
    (0, import_react.createElement)(
      "div",
      { style: styles.block },
      (0, import_react.createElement)("div", { style: { fontWeight: 600, fontSize: 13 } }, "\u{1F4F6} \u5C40\u57DF\u7F51\uFF08\u540C\u4E00 WiFi\uFF09| LAN"),
      lanUrl ? (0, import_react.createElement)(
        "div",
        null,
        (0, import_react.createElement)("img", { src: status.lanQr, alt: "LAN QR", style: styles.qr }),
        (0, import_react.createElement)("div", { style: styles.code }, lanUrl),
        (0, import_react.createElement)("div", { style: styles.muted }, "\u624B\u673A\u8FDE\u63A5\u540C\u4E00 WiFi \u540E\u626B\u7801\u5373\u53EF\u6253\u5F00")
      ) : (0, import_react.createElement)("div", { style: styles.muted }, "\u4EE3\u7406\u672A\u5C31\u7EEA\u2026 | proxy starting\u2026")
    ),
    // 公网
    (0, import_react.createElement)(
      "div",
      { style: styles.block },
      (0, import_react.createElement)("div", { style: { fontWeight: 600, fontSize: 13 } }, "\u{1F310} \u516C\u7F51\uFF08\u4EBA\u5728\u5916\u9762\uFF09| Anywhere"),
      tunnelUrl ? (0, import_react.createElement)(
        "div",
        null,
        (0, import_react.createElement)("img", { src: status.tunnelQr, alt: "Tunnel QR", style: styles.qr }),
        (0, import_react.createElement)("div", { style: styles.code }, tunnelUrl),
        (0, import_react.createElement)("div", { style: styles.muted }, "\u4EFB\u4F55\u7F51\u7EDC\u626B\u7801\u5373\u7528\uFF08URL \u6BCF\u6B21\u91CD\u542F\u4F1A\u53D8\uFF09"),
        (0, import_react.createElement)("button", { style: styles.btn, onClick: stopTunnel }, "\u5173\u95ED\u516C\u7F51 | Stop")
      ) : (0, import_react.createElement)(
        "div",
        null,
        (0, import_react.createElement)("button", { style: styles.primary, onClick: startTunnel, disabled: busy }, busy ? "\u5F00\u542F\u4E2D\u2026\uFF08\u9996\u6B21\u9700\u4E0B\u8F7D cloudflared\uFF09" : "\u5F00\u542F\u516C\u7F51\u8BBF\u95EE | Enable anywhere"),
        (0, import_react.createElement)("div", { style: styles.warn, marginTop: 8 }, "\u26A0\uFE0F DSH \u80FD\u6267\u884C\u7535\u8111\u4EE3\u7801\uFF1A\u4E8C\u7EF4\u7801/URL \u5C31\u662F\u94A5\u5319\uFF0C\u8BF7\u52FF\u53D1\u7ED9\u522B\u4EBA")
      )
    ),
    error ? (0, import_react.createElement)("div", { style: { color: "var(--dsw-alias-state-error-primary,#dc2626)", fontSize: 12, marginTop: 8 } }, `\u274C ${error}`) : null
  );
}
function apply(ctx) {
  const rpcCall = (endpoint, payload, signal) => ctx.connection.rpc.call(POCKET_RPC_CHANNEL, endpoint, payload, signal);
  ctx.slots.inject(
    "settings.plugins.tab",
    () => ctx.slots.register(
      {
        name: "settings.plugins.tab",
        id: "pocket",
        order: 10,
        label: "\u624B\u673A\u8BBF\u95EE",
        inject: () => ({ rpcCall })
      },
      PocketSettingsTab
    )
  );
}

    return module.exports;
  }
});
