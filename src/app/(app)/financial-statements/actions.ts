"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, asc, desc, eq, gt, lt } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireWrite } from "@/lib/auth";
import { fail } from "@/lib/actions";
import { isIsoDate, isUuid, str } from "@/lib/format";
import { UserError } from "@/lib/ledger";
import { audit } from "@/lib/audit";
import { getI18n } from "@/lib/i18n";
import { fsFigures, loadDraft } from "@/lib/fs";
import { startingNotes, TEMPLATES } from "@/lib/fs-templates";
import type { FsFramework } from "@/db/schema";

const BASE = "/financial-statements";
/** How many sets of financial statements an organisation keeps; generating one more removes the oldest. */
const MAX_DRAFTS = 10;

/** Only accountants change statements. */
async function editable(id: string) {
  const ctx = await requireWrite("journal");
  if (!isUuid(id)) throw new UserError("err_not_found");
  const draft = await loadDraft(ctx.company.id, id);
  if (!draft) throw new UserError("err_not_found");
  return { ctx, draft };
}
/** Final statements are not changed: they are reopened first. */
const ensureOpen = (d: { status: string }) => { if (d.status === "final") throw new UserError("err_fs_final"); };
const companyOf = (c: { name: string; country: string; orgType: string; sector: string; currency: string; vatRegistered: boolean; registrationNo: string; tin: string }) =>
  ({ name: c.name, country: c.country, orgType: c.orgType, sector: c.sector, currency: c.currency, vatRegistered: c.vatRegistered, registrationNo: c.registrationNo, tin: c.tin });

/** Reads the trial balance for the period and drafts the statements with the reports, policies and notes that apply. */
export async function generateFs(fd: FormData) {
  const ctx = await requireWrite("journal");
  const { lang, t } = await getI18n();
  let id = "";
  try {
    const from = str(fd, "periodFrom"), to = str(fd, "periodTo");
    if (!isIsoDate(from) || !isIsoDate(to) || from > to) throw new UserError("err_fs_period");
    const framework: FsFramework = str(fd, "framework") === "ifrs" ? "ifrs" : "ifrs_sme";
    const comparative = str(fd, "comparative") === "1";
    const f = await fsFigures(ctx.company.id, from, to, comparative, lang);
    const notes = startingNotes({ f, c: companyOf(ctx.company), framework }, lang);
    const db = await getDb();
    id = await db.transaction(async (tx) => {
      const [d] = await tx.insert(schema.fsDrafts).values({
        companyId: ctx.company.id, title: str(fd, "title") || `${t("fs_title")} ${to.slice(0, 4)}`, periodFrom: from, periodTo: to, comparative, framework, lang, createdBy: ctx.user.id,
      }).returning({ id: schema.fsDrafts.id });
      if (notes.length) await tx.insert(schema.fsNotes).values(notes.map((n) => ({ ...n, draftId: d.id })));
      await audit(tx, ctx.company.id, ctx.user.id, "generate", "financial_statements", `${from}..${to}`, { notes: notes.length });
      // Only the most recent sets are kept: beyond the limit the oldest go, drafts before final ones.
      const all = await tx.select({ id: schema.fsDrafts.id, title: schema.fsDrafts.title, status: schema.fsDrafts.status, createdAt: schema.fsDrafts.createdAt })
        .from(schema.fsDrafts).where(eq(schema.fsDrafts.companyId, ctx.company.id));
      const extra = all.length - MAX_DRAFTS;
      if (extra > 0) {
        const oldest = all.filter((x) => x.id !== d.id)
          .sort((a, b) => (a.status === b.status ? a.createdAt.getTime() - b.createdAt.getTime() : a.status === "draft" ? -1 : 1)).slice(0, extra);
        for (const o of oldest) {
          await tx.delete(schema.fsDrafts).where(eq(schema.fsDrafts.id, o.id));
          await audit(tx, ctx.company.id, ctx.user.id, "delete_oldest", "financial_statements", o.title);
        }
      }
      return d.id as string;
    });
  } catch (e) { fail(e, BASE); }
  revalidatePath(BASE);
  redirect(`${BASE}/${id}`);
}

/** Title, framework and who approves; or marks the set final, or reopens it. */
export async function saveFsSettings(fd: FormData) {
  const id = str(fd, "id");
  try {
    const { ctx, draft } = await editable(id);
    const db = await getDb();
    if (draft.d.status === "final") {
      await db.update(schema.fsDrafts).set({ status: "draft", updatedAt: new Date() }).where(eq(schema.fsDrafts.id, id));
      await audit(db, ctx.company.id, ctx.user.id, "reopen", "financial_statements", draft.d.title);
    } else {
      const status = str(fd, "status") === "final" ? "final" : "draft";
      const approvedOn = str(fd, "approvedOn");
      await db.update(schema.fsDrafts).set({
        title: str(fd, "title").slice(0, 200) || draft.d.title, approvedBy: str(fd, "approvedBy").slice(0, 1000),
        approvedOn: isIsoDate(approvedOn) ? approvedOn : null, framework: str(fd, "framework") === "ifrs" ? "ifrs" : "ifrs_sme", status, updatedAt: new Date(),
      }).where(eq(schema.fsDrafts.id, id));
      await audit(db, ctx.company.id, ctx.user.id, status === "final" ? "finalise" : "update", "financial_statements", draft.d.title);
    }
  } catch (e) { fail(e, `${BASE}/${id}`); }
  revalidatePath(`${BASE}/${id}`);
  redirect(`${BASE}/${id}?saved=1`);
}

async function noteOf(noteId: string) {
  if (!isUuid(noteId)) throw new UserError("err_not_found");
  const db = await getDb();
  const [n] = await db.select().from(schema.fsNotes).where(eq(schema.fsNotes.id, noteId));
  if (!n) throw new UserError("err_not_found");
  const { ctx, draft } = await editable(n.draftId);
  ensureOpen(draft.d);
  return { ctx, n, db };
}

/** Saves a note's wording and whether it is printed. */
export async function saveFsNote(fd: FormData) {
  let draftId = "";
  try {
    const { n, db } = await noteOf(str(fd, "noteId"));
    draftId = n.draftId;
    await db.update(schema.fsNotes).set({ title: str(fd, "title").slice(0, 200) || n.title, body: String(fd.get("body") ?? "").slice(0, 20000), included: str(fd, "included") === "1" })
      .where(eq(schema.fsNotes.id, n.id));
    await db.update(schema.fsDrafts).set({ updatedAt: new Date() }).where(eq(schema.fsDrafts.id, n.draftId));
  } catch (e) { fail(e, draftId ? `${BASE}/${draftId}` : BASE); }
  revalidatePath(`${BASE}/${draftId}`);
  redirect(`${BASE}/${draftId}?saved=1#note-${str(fd, "noteId")}`);
}

/** Moves a note up or down among the notes of its kind. */
export async function moveFsNote(fd: FormData) {
  let draftId = "";
  try {
    const { n, db } = await noteOf(str(fd, "noteId"));
    draftId = n.draftId;
    const up = str(fd, "dir") === "up";
    const [other] = await db.select().from(schema.fsNotes)
      .where(and(eq(schema.fsNotes.draftId, n.draftId), eq(schema.fsNotes.kind, n.kind), up ? lt(schema.fsNotes.sortOrder, n.sortOrder) : gt(schema.fsNotes.sortOrder, n.sortOrder)))
      .orderBy(up ? desc(schema.fsNotes.sortOrder) : asc(schema.fsNotes.sortOrder)).limit(1);
    if (other) {
      await db.transaction(async (tx) => {
        await tx.update(schema.fsNotes).set({ sortOrder: other.sortOrder }).where(eq(schema.fsNotes.id, n.id));
        await tx.update(schema.fsNotes).set({ sortOrder: n.sortOrder }).where(eq(schema.fsNotes.id, other.id));
      });
    }
  } catch (e) { fail(e, draftId ? `${BASE}/${draftId}` : BASE); }
  revalidatePath(`${BASE}/${draftId}`);
  redirect(`${BASE}/${draftId}#note-${str(fd, "noteId")}`);
}

export async function deleteFsNote(fd: FormData) {
  let draftId = "";
  try {
    const { ctx, n, db } = await noteOf(str(fd, "noteId"));
    draftId = n.draftId;
    await db.delete(schema.fsNotes).where(eq(schema.fsNotes.id, n.id));
    await audit(db, ctx.company.id, ctx.user.id, "delete_note", "financial_statements", n.title);
  } catch (e) { fail(e, draftId ? `${BASE}/${draftId}` : BASE); }
  revalidatePath(`${BASE}/${draftId}`);
  redirect(`${BASE}/${draftId}?saved=1#notes`);
}

/** Adds a note from a template (a loan's terms, a court case...) or one written from scratch, at the end of its kind. */
export async function addFsNote(fd: FormData) {
  const draftId = str(fd, "draftId");
  let newId = "";
  try {
    const { ctx, draft } = await editable(draftId);
    ensureOpen(draft.d);
    const tpl = TEMPLATES.find((x) => x.key === str(fd, "template"));
    const kind = tpl?.kind ?? (str(fd, "kind") === "policy" ? "policy" : "note");
    let title = str(fd, "title"), body = String(fd.get("body") ?? "");
    if (tpl) {
      const f = await fsFigures(ctx.company.id, draft.d.periodFrom, draft.d.periodTo, draft.d.comparative, draft.d.lang);
      const text = tpl.body({ f, c: companyOf(ctx.company), framework: draft.d.framework });
      title = title || tpl.title[draft.d.lang];
      body = body || text[draft.d.lang];
    }
    if (!title) throw new UserError("err_required");
    const last = draft.notes.filter((x) => x.kind === kind).reduce((m, x) => Math.max(m, x.sortOrder), 0);
    const db = await getDb();
    const [row] = await db.insert(schema.fsNotes).values({
      draftId, kind, key: tpl?.key ?? "custom", title: title.slice(0, 200), body: body.slice(0, 20000), figures: tpl?.figures ?? null, included: true, sortOrder: last + 10,
    }).returning({ id: schema.fsNotes.id });
    newId = row.id;
    await audit(db, ctx.company.id, ctx.user.id, "add_note", "financial_statements", title);
  } catch (e) { fail(e, `${BASE}/${draftId}`); }
  revalidatePath(`${BASE}/${draftId}`);
  redirect(`${BASE}/${draftId}?saved=1#note-${newId}`);
}

export async function deleteFsDraft(fd: FormData) {
  const id = str(fd, "id");
  try {
    // Deleting asks for a second click; a final set can be deleted too, since only ten are kept.
    const { ctx, draft } = await editable(id);
    const db = await getDb();
    await db.delete(schema.fsDrafts).where(eq(schema.fsDrafts.id, id));
    await audit(db, ctx.company.id, ctx.user.id, "delete", "financial_statements", draft.d.title);
  } catch (e) { fail(e, `${BASE}/${id}`); }
  revalidatePath(BASE);
  redirect(BASE);
}
