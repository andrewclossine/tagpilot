// QR codes: what each kind of code holds, and the code drawn as SVG in its colours and shapes, with a logo and a frame.
// Pure functions, shared by the live preview in the browser and the server.
import QRCode from "qrcode";
import type { QrStyle, QrType } from "@/db/schema";

export const QR_TYPES: QrType[] = ["url", "text", "vcard", "email", "phone", "sms", "wifi", "location", "file"];
/** The fields each kind of code asks for. */
export const QR_FIELDS: Record<QrType, string[]> = {
  url: ["url"], text: ["text"], email: ["email", "subject", "body"], phone: ["phone"], sms: ["phone", "message"],
  wifi: ["ssid", "password", "security", "hidden"], location: ["lat", "lng", "label"],
  vcard: ["first", "last", "org", "title", "phone", "mobile", "email", "website", "address"], file: [],
};
export const DEFAULT_STYLE: QrStyle = { fg: "#10203f", bg: "#ffffff", dots: "square", eyes: "square", eyeColor: "#10203f", logo: null, frame: "none", frameText: "SCAN ME", frameColor: "#1d4ed8", ecc: "M" };

const wifiEsc = (s: string) => s.replace(/([\\;,:"])/g, "\\$1");
const vEsc = (s: string) => s.replace(/([\\;,])/g, "\\$1").replace(/\n/g, "\\n");
const httpish = (u: string) => (/^[a-z][a-z0-9+.-]*:/i.test(u) ? u : `https://${u}`);

/** What a static code of this kind holds: a link, a contact card, Wi-Fi details... */
export function qrContent(type: QrType, d: Record<string, string>): string {
  const v = (k: string) => (d[k] ?? "").trim();
  switch (type) {
    case "url": return v("url") ? httpish(v("url")) : "";
    case "text": return v("text");
    case "email": { const p = new URLSearchParams(); if (v("subject")) p.set("subject", v("subject")); if (v("body")) p.set("body", v("body")); const qs = p.toString().replace(/\+/g, "%20"); return v("email") ? `mailto:${v("email")}${qs ? `?${qs}` : ""}` : ""; }
    case "phone": return v("phone") ? `tel:${v("phone").replace(/[^\d+]/g, "")}` : "";
    case "sms": return v("phone") ? `SMSTO:${v("phone").replace(/[^\d+]/g, "")}:${v("message")}` : "";
    case "wifi": return v("ssid") ? `WIFI:T:${v("security") || "WPA"};S:${wifiEsc(v("ssid"))};${v("security") === "nopass" ? "" : `P:${wifiEsc(v("password"))};`}${v("hidden") === "1" ? "H:true;" : ""};` : "";
    case "location": return v("lat") && v("lng") ? `geo:${Number(v("lat"))},${Number(v("lng"))}${v("label") ? `?q=${encodeURIComponent(v("label"))}` : ""}` : "";
    case "vcard": {
      if (!v("first") && !v("last") && !v("org")) return "";
      return ["BEGIN:VCARD", "VERSION:3.0", `N:${vEsc(v("last"))};${vEsc(v("first"))};;;`, `FN:${vEsc([v("first"), v("last")].filter(Boolean).join(" ") || v("org"))}`,
        v("org") ? `ORG:${vEsc(v("org"))}` : "", v("title") ? `TITLE:${vEsc(v("title"))}` : "", v("phone") ? `TEL;TYPE=WORK,VOICE:${v("phone")}` : "", v("mobile") ? `TEL;TYPE=CELL:${v("mobile")}` : "",
        v("email") ? `EMAIL:${v("email")}` : "", v("website") ? `URL:${httpish(v("website"))}` : "", v("address") ? `ADR;TYPE=WORK:;;${vEsc(v("address"))};;;;` : "", "END:VCARD"].filter(Boolean).join("\n");
    }
    case "file": return "";
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const color = (c: string, fallback: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : fallback);

/**
 * The code as an SVG image. The three corner "eyes" are drawn in their own shape and colour; the dots in theirs; a logo
 * covers the middle (the code is then made with the highest error correction so it still scans); a frame adds a call
 * to action under the code.
 */
export function qrSvg(text: string, style: QrStyle, size = 320): string {
  const s = { ...DEFAULT_STYLE, ...style };
  const fg = color(s.fg, "#000000"), bg = color(s.bg, "#ffffff"), eye = color(s.eyeColor, fg), frameColor = color(s.frameColor, "#1d4ed8");
  const qr = QRCode.create(text || " ", { errorCorrectionLevel: s.logo ? "H" : s.ecc });
  const n = qr.modules.size, quiet = 4, cells = n + quiet * 2;
  const isEye = (r: number, c: number) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
  // The middle left free for a logo, about a fifth of the code.
  const hole = s.logo ? Math.ceil(n * 0.22) | 1 : 0, h0 = Math.floor((n - hole) / 2);
  const inHole = (r: number, c: number) => hole > 0 && r >= h0 && r < h0 + hole && c >= h0 && c < h0 + hole;
  const parts: string[] = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    if (!qr.modules.get(r, c) || isEye(r, c) || inHole(r, c)) continue;
    const x = c + quiet, y = r + quiet;
    parts.push(s.dots === "dots" ? `<circle cx="${x + 0.5}" cy="${y + 0.5}" r="0.45"/>` : s.dots === "rounded" ? `<rect x="${x + 0.05}" y="${y + 0.05}" width="0.9" height="0.9" rx="0.35"/>` : `<rect x="${x}" y="${y}" width="1.02" height="1.02"/>`);
  }
  const eyes = [[0, 0], [0, n - 7], [n - 7, 0]].map(([r, c]) => {
    const x = c + quiet, y = r + quiet;
    if (s.eyes === "circle") return `<circle cx="${x + 3.5}" cy="${y + 3.5}" r="3" fill="none" stroke="${eye}" stroke-width="1"/><circle cx="${x + 3.5}" cy="${y + 3.5}" r="1.5" fill="${eye}"/>`;
    const rx = s.eyes === "rounded" ? 1.6 : 0, rx2 = s.eyes === "rounded" ? 0.8 : 0;
    return `<rect x="${x + 0.5}" y="${y + 0.5}" width="6" height="6" rx="${rx}" fill="none" stroke="${eye}" stroke-width="1"/><rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="${rx2}" fill="${eye}"/>`;
  }).join("");
  const logo = s.logo && /^data:image\/(png|jpeg|svg\+xml);base64,/.test(s.logo)
    ? `<rect x="${h0 + quiet - 0.3}" y="${h0 + quiet - 0.3}" width="${hole + 0.6}" height="${hole + 0.6}" rx="1" fill="${bg}"/><image href="${s.logo}" x="${h0 + quiet + 0.4}" y="${h0 + quiet + 0.4}" width="${hole - 0.8}" height="${hole - 0.8}" preserveAspectRatio="xMidYMid meet"/>` : "";
  const label = s.frame !== "none" && s.frameText.trim() ? esc(s.frameText.trim().slice(0, 30)) : "";
  const band = label ? 6 : 0, pad = label && s.frame === "box" ? 1.5 : 0;
  const W = cells + pad * 2, H = cells + band + pad * 2;
  const frame = !label ? "" : s.frame === "box"
    ? `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="2" fill="none" stroke="${frameColor}" stroke-width="1"/><text x="${W / 2}" y="${cells + pad + band / 2 + 1.2}" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="3.4" fill="${frameColor}" text-anchor="middle">${label}</text>`
    : `<rect x="0" y="${cells}" width="${W}" height="${band}" rx="1.5" fill="${frameColor}"/><text x="${W / 2}" y="${cells + band / 2 + 1.2}" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="3.4" fill="#ffffff" text-anchor="middle">${label}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${size}" height="${Math.round((size * H) / W)}" shape-rendering="${s.dots === "square" ? "crispEdges" : "geometricPrecision"}">`
    + `<rect width="${W}" height="${H}" fill="${bg}"/><g transform="translate(${pad} ${pad})"><g fill="${fg}">${parts.join("")}</g>${eyes}${logo}</g>${frame}</svg>`;
}

/** The kind of device that scanned a code, from its user agent. */
export function deviceOf(ua: string) {
  const os = /android/i.test(ua) ? "Android" : /iphone|ipad|ipod/i.test(ua) ? "iOS" : /windows/i.test(ua) ? "Windows" : /mac os/i.test(ua) ? "macOS" : /linux/i.test(ua) ? "Linux" : "Other";
  const device = /ipad|tablet/i.test(ua) ? "tablet" : /mobi|iphone|android/i.test(ua) ? "phone" : "computer";
  const browser = /edg\//i.test(ua) ? "Edge" : /chrome|crios/i.test(ua) ? "Chrome" : /safari/i.test(ua) ? "Safari" : /firefox|fxios/i.test(ua) ? "Firefox" : "Other";
  return { os, device, browser };
}
