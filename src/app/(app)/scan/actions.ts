"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireWrite } from "@/lib/auth";
import { fail, withParam } from "@/lib/actions";
import { isIsoDate, round2, today } from "@/lib/format";
import { saveEntry, UserError, type LineInput } from "@/lib/ledger";
import { ALLOWED_TYPES, MAX_UPLOAD, saveAttachment } from "@/lib/storage";
import { readDocument, type DocProposal } from "@/lib/ai";
import { bookOptions, recentEntriesForAi } from "@/lib/data";
import { getI18n } from "@/lib/i18n";
import type { AiInfo } from "@/db/schema";

/** Saves the document, asks the AI for a booking, and opens it as a draft for review. */
export async function scanDocument(fd: FormData) {
  const ctx = await requireWrite("journal");
  const { lang, accName } = await getI18n();
  const file = fd.get("file");
  try {
    if (!(file instanceof File) || !file.size) throw new UserError("err_required");
    if (!(ALLOWED_TYPES as readonly string[]).includes(file.type)) throw new UserError("err_file_type");
    if (file.size > MAX_UPLOAD) throw new UserError("err_file_size");
  } catch (e) { fail(e, "/scan"); }

  const { id: attachmentId, bytes } = await saveAttachment(ctx.company.id, ctx.user.id, file);
  const o = await bookOptions(ctx.company.id, accName);
  const s = ctx.company.settings;

  let proposal: DocProposal | null = null;
  let aiError = "";
  try {
    proposal = await readDocument({ bytes, mimeType: file.type, fileName: file.name }, {
      companyName: ctx.company.name, tin: ctx.company.tin, country: ctx.company.country, currency: ctx.company.currency, vatRegistered: ctx.company.vatRegistered, vatRate: ctx.company.vatRate,
      vatIn: s.vatIn, vatOut: s.vatOut, policies: ctx.company.policies, language: lang === "fr" ? "French" : "English",
      accounts: o.accounts.map((a) => ({ code: a.code, name: a.nameEn, type: a.type })),
      partners: o.partners.map((p) => ({ id: p.id, name: p.name, kind: p.kind, tin: p.tin })),
      projects: o.projects.map((p) => ({ code: p.code, name: p.name })),
      recent: await recentEntriesForAi(ctx.company.id),
    });
  } catch (e) {
    aiError = e instanceof UserError ? e.message : "err_ai_failed";
    console.error("AI reading failed:", e);
  }

  // Turn the AI's codes into this company's records; anything unknown becomes a warning for the accountant.
  const warnings = [...(proposal?.warnings ?? [])];
  const lines: LineInput[] = [];
  for (const l of proposal?.lines ?? []) {
    const acc = o.accounts.find((a) => a.code === l.account_code);
    if (!acc) { warnings.push(`${lang === "fr" ? "Compte inconnu ignoré" : "Unknown account left out"}: ${l.account_code} (${l.debit || l.credit})`); continue; }
    lines.push({ accountId: acc.id, debit: round2(l.debit), credit: round2(l.credit), description: l.description });
  }
  const p = proposal?.partner;
  const partner = p && (o.partners.find((x) => x.id === p.existing_id)
    ?? (p.tin ? o.partners.find((x) => x.tin && x.tin === p.tin) : undefined)
    ?? o.partners.find((x) => x.name.toLowerCase() === p.name.toLowerCase()));
  const project = o.projects.find((x) => x.code === proposal?.project_code);
  const ai: AiInfo = {
    confidence: Math.max(0, Math.min(1, proposal?.confidence ?? 0)), warnings, docType: proposal?.doc_type ?? "",
    total: proposal?.total ?? 0, newPartner: !partner && p?.name ? { name: p.name, tin: p.tin, kind: p.kind } : null,
  };

  const db = await getDb();
  const id = await db.transaction((tx) => saveEntry(tx, ctx.company.id, ctx.user.id, {
    date: isIsoDate(proposal?.date) ? proposal!.date! : today(),
    reference: proposal?.reference ?? "", memo: proposal?.memo || file.name,
    partnerId: partner?.id ?? null, projectId: project?.id ?? null,
    source: "ai", attachmentId, ai: proposal ? ai : null, lines,
  }, false));
  revalidatePath("/journal");
  redirect(aiError ? withParam(`/journal/${id}`, "error", aiError) : `/journal/${id}`);
}
