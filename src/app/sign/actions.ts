"use server";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { bySigningToken, finalize, invite, loadDoc, logEvent, requestMeta, whoseTurn } from "@/lib/esign";
import { trimSignature } from "@/lib/signature";

const back = (token: string, error: string) => redirect(`/sign/${token}?error=${error}`);

/**
 * A signer signs: their drawn signature, their initials and the fields they fill in are kept with where and when
 * they signed. The next signer is then invited, or, when everyone has signed, the document is sealed and sent.
 */
export async function signEsign(fd: FormData) {
  const token = String(fd.get("token") ?? "");
  const row = await bySigningToken(token);
  if (!row) redirect("/sign/invalid");
  const { s, d } = row;
  if (d.status !== "sent" || s.status === "signed" || s.status === "declined") back(token, "err_es_closed");
  const db = await getDb();
  const loaded = (await loadDoc(db, d.companyId, d.id))!;
  if (!whoseTurn(d, loaded.signers).some((x) => x.id === s.id)) back(token, "err_es_not_turn");
  if (fd.get("consent") !== "1") back(token, "err_es_consent");
  const signature = String(fd.get("signature") ?? "");
  if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(signature) || signature.length > 1_500_000) back(token, "err_es_signature");
  let values: Record<string, string> = {};
  try { values = JSON.parse(String(fd.get("values") ?? "{}")); } catch { values = {}; }
  const initials = String(fd.get("initials") ?? "").trim().slice(0, 12);
  const mine = loaded.fields.filter((f) => f.signerId === s.id);
  if (mine.some((f) => f.type === "initials") && !initials) back(token, "err_es_initials");
  for (const f of mine) {
    if (f.type === "text" && f.required && !String(values[f.id] ?? "").trim()) back(token, "err_es_fields");
    if (f.type === "checkbox" && f.required && values[f.id] !== "1") back(token, "err_es_fields");
  }
  const meta = await requestMeta();
  // A drawn signature is turned into PNG, trimmed to its ink, so it sits well in its box.
  let png = signature;
  try { png = trimSignature(signature); } catch { /* kept as drawn */ }
  const signedAt = new Date();
  const tz = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Kigali", year: "numeric", month: "2-digit", day: "2-digit" }).format(signedAt);
  const last = await db.transaction(async (tx) => {
    for (const f of mine) {
      const value = f.type === "date" ? tz : f.type === "name" ? s.name : f.type === "text" ? String(values[f.id] ?? "").slice(0, 300) : f.type === "checkbox" ? (values[f.id] === "1" ? "1" : "") : "";
      if (f.type !== "signature" && f.type !== "initials") await tx.update(schema.esignFields).set({ value }).where(eq(schema.esignFields.id, f.id));
    }
    const [done] = await tx.update(schema.esignSigners).set({ status: "signed", signedAt, signature: png, initials, ip: meta.ip, userAgent: meta.userAgent })
      .where(and(eq(schema.esignSigners.id, s.id), eq(schema.esignSigners.status, s.status))).returning({ id: schema.esignSigners.id });
    if (!done) return null; // signed twice at once: the first one counts
    await logEvent(tx, d.id, "signed", { signerId: s.id, ...meta });
    const after = (await loadDoc(tx, d.companyId, d.id))!;
    return after;
  });
  if (!last) redirect(`/sign/${token}`);
  if (last.signers.every((x) => x.status === "signed")) {
    await finalize(db, d.id);
  } else {
    // Invite whoever's turn it now is and who has not been invited yet.
    const [owner] = d.createdBy ? await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, d.createdBy)) : [];
    const next = whoseTurn(d, last.signers).filter((x) => x.status === "waiting");
    if (next.length) await invite(db, d, { name: row.company }, { name: owner?.name ?? row.company }, next, meta);
  }
  redirect(`/sign/${token}?signed=1`);
}

/** A signer refuses to sign, saying why. The document stops and its sender is told. */
export async function declineEsign(fd: FormData) {
  const token = String(fd.get("token") ?? "");
  const row = await bySigningToken(token);
  if (!row) redirect("/sign/invalid");
  const { s, d } = row;
  if (d.status !== "sent" || s.status === "signed" || s.status === "declined") back(token, "err_es_closed");
  const reason = String(fd.get("reason") ?? "").trim().slice(0, 500);
  if (!reason) back(token, "err_es_reason");
  const db = await getDb();
  const meta = await requestMeta();
  await db.transaction(async (tx) => {
    await tx.update(schema.esignSigners).set({ status: "declined", declineReason: reason, ip: meta.ip, userAgent: meta.userAgent }).where(eq(schema.esignSigners.id, s.id));
    await tx.update(schema.esignDocuments).set({ status: "declined" }).where(eq(schema.esignDocuments.id, d.id));
    await logEvent(tx, d.id, "declined", { signerId: s.id, ...meta, detail: reason });
  });
  redirect(`/sign/${token}?declined=1`);
}

/** The first time a signer opens their link is recorded. */
export async function markViewed(token: string) {
  const row = await bySigningToken(token);
  if (!row || row.d.status !== "sent" || row.s.viewedAt) return;
  const db = await getDb();
  const meta = await requestMeta();
  await db.update(schema.esignSigners).set({ viewedAt: new Date(), status: row.s.status === "sent" ? "viewed" : row.s.status }).where(eq(schema.esignSigners.id, row.s.id));
  await logEvent(db, row.d.id, "viewed", { signerId: row.s.id, ...meta });
}
