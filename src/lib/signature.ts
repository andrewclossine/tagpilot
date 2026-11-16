import "server-only";
import { eq } from "drizzle-orm";
import type { Db, Tx } from "@/db";
import { schema } from "@/db";
import zlib from "node:zlib";
import { UserError } from "./ledger";

const PREFIX = "data:image/png;base64,";
const MAX_LENGTH = 700_000; // the drawing pad's picture is far smaller; this stops anything else being stored

/** Checks that what was sent as a signature really is a PNG picture of a reasonable size, and returns it. */
export function readSignature(value: string): string {
  if (!value.startsWith(PREFIX) || value.length > MAX_LENGTH) throw new UserError("err_signature");
  const body = value.slice(PREFIX.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) throw new UserError("err_signature");
  const png = Buffer.from(body, "base64");
  if (png.length < 24 || png.toString("latin1", 1, 4) !== "PNG" || png.toString("latin1", 12, 16) !== "IHDR") throw new UserError("err_signature");
  return value;
}

export async function savedSignature(db: Db | Tx, userId: string): Promise<string | null> {
  const [row] = await db.select({ image: schema.userSignatures.image }).from(schema.userSignatures).where(eq(schema.userSignatures.userId, userId));
  return row?.image ?? null;
}

/** Keeps a person's signature for next time, or forgets it when they untick the box. It is theirs alone. */
export async function rememberSignature(db: Db | Tx, userId: string, image: string, remember: boolean) {
  if (!remember) {
    await db.delete(schema.userSignatures).where(eq(schema.userSignatures.userId, userId));
    return;
  }
  await db.insert(schema.userSignatures).values({ userId, image })
    .onConflictDoUpdate({ target: schema.userSignatures.userId, set: { image, updatedAt: new Date() } });
}

// ---------- trimming a signature to its ink ----------
// The pad is 840 x 280, and a signature printed in a 112 x 38 box shrinks with it: signed small in the middle, it
// becomes a faint dot. Cutting the picture down to where the ink is lets the signature fill its box instead.

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf: Buffer) { let x = 0xffffffff; for (const v of buf) x = CRC_TABLE[(x ^ v) & 0xff] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Decodes an 8-bit RGB or RGBA, non-interlaced PNG (what a canvas makes) into RGBA pixels; anything else returns null. */
function decodePng(png: Buffer): { w: number; h: number; px: Buffer } | null {
  if (png.toString("latin1", 1, 4) !== "PNG") return null;
  let pos = 8, w = 0, h = 0, depth = 0, type = 0, interlace = 0;
  const idat: Buffer[] = [];
  while (pos + 8 <= png.length) {
    const len = png.readUInt32BE(pos), t = png.toString("latin1", pos + 4, pos + 8), data = png.subarray(pos + 8, pos + 8 + len);
    if (t === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (t === "IDAT") idat.push(data);
    else if (t === "IEND") break;
    pos += 12 + len;
  }
  if (depth !== 8 || (type !== 6 && type !== 2) || interlace || !w || !h || w * h > 4_000_000) return null;
  const bpp = type === 6 ? 4 : 3, stride = w * bpp;
  let raw: Buffer;
  try { raw = zlib.inflateSync(Buffer.concat(idat)); } catch { return null; }
  if (raw.length < (stride + 1) * h) return null;
  const out = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[dst + i - bpp] : 0, b = y ? out[dst - stride + i] : 0, c = y && i >= bpp ? out[dst - stride + i - bpp] : 0;
      const v = raw[src + i];
      let p: number;
      if (f === 0) p = v; else if (f === 1) p = v + a; else if (f === 2) p = v + b; else if (f === 3) p = v + ((a + b) >> 1);
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); p = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
      else return null;
      out[dst + i] = p & 0xff;
    }
  }
  if (bpp === 4) return { w, h, px: out };
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) { rgba[i * 4] = out[i * 3]; rgba[i * 4 + 1] = out[i * 3 + 1]; rgba[i * 4 + 2] = out[i * 3 + 2]; rgba[i * 4 + 3] = 255; }
  return { w, h, px: rgba };
}

/**
 * The signature cut down to where the ink is, with a small margin, as a PNG. Pictures it cannot read, or with no ink,
 * come back as they were.
 */
export function trimSignature(dataUrl: string): string {
  try {
    const png = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
    const img = decodePng(png);
    if (!img) return dataUrl;
    const { w, h, px } = img;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      // Ink: visible and clearly darker than the white of the pad.
      if (px[o + 3] > 40 && px[o] + px[o + 1] + px[o + 2] < 600) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) return dataUrl;
    const pad = 10;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
    if (x0 === 0 && y0 === 0 && x1 === w - 1 && y1 === h - 1) return dataUrl;
    const cw = x1 - x0 + 1, ch = y1 - y0 + 1, raw = Buffer.alloc((cw * 4 + 1) * ch);
    for (let y = 0; y < ch; y++) { raw[y * (cw * 4 + 1)] = 0; px.copy(raw, y * (cw * 4 + 1) + 1, ((y + y0) * w + x0) * 4, ((y + y0) * w + x1 + 1) * 4); }
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(cw, 0); ihdr.writeUInt32BE(ch, 4); ihdr[8] = 8; ihdr[9] = 6;
    const out = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
    return `${PREFIX}${out.toString("base64")}`;
  } catch { return dataUrl; }
}
