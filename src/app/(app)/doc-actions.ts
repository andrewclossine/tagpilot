"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireWrite } from "@/lib/auth";
import { fail } from "@/lib/actions";
import { isIsoDate, parseAmount, str, today } from "@/lib/format";
import { getDoc, payDoc, postDoc, saveDocDraft, voidDoc, type DocKind } from "@/lib/documents";
import { UserError } from "@/lib/ledger";
import { parseDocLines } from "@/lib/parse";
import { getI18n } from "@/lib/i18n";
import { audit } from "@/lib/audit";

const kindOf = (fd: FormData): DocKind => (str(fd, "kind") === "bill" ? "bill" : "invoice");
const docBase = (kind: DocKind) => (kind === "invoice" ? "/sales/invoices" : "/purchases/bills");

export async function saveDoc(fd: FormData) {
  const kind = kindOf(fd);
  const ctx = await requireWrite(kind === "invoice" ? "sales" : "purchases");
  const base = docBase(kind);
  const id = str(fd, "id") || undefined;
  const post = str(fd, "intent") === "post";
  let savedId: string;
  try {
    const partnerId = str(fd, "partnerId"), date = str(fd, "date"), dueDate = str(fd, "dueDate");
    if (!partnerId || !isIsoDate(date) || !isIsoDate(dueDate)) throw new UserError("err_required");
    const lines = parseDocLines(fd);
    const vatRate = ctx.company.vatRegistered ? ctx.company.vatRate : 0;
    const db = await getDb();
    savedId = await db.transaction(async (tx) => {
      const [p] = await tx.select().from(schema.partners).where(and(eq(schema.partners.id, partnerId), eq(schema.partners.companyId, ctx.company.id)));
      if (!p) throw new UserError("err_required");
      const docId = await saveDocDraft(tx, kind, ctx.company.id, ctx.user.id, id, {
        partnerId, date, dueDate, notes: str(fd, "notes"), projectId: str(fd, "projectId") || null,
        supplierRef: str(fd, "supplierRef"), whtRate: parseAmount(fd.get("whtRate")),
      }, lines, vatRate);
      if (post) await postDoc(tx, kind, ctx.company.id, ctx.user.id, docId, ctx.company.settings);
      return docId;
    });
  } catch (e) { fail(e, id ? `${base}/${id}` : `${base}/new`); }
  revalidatePath(base);
  redirect(`${base}/${savedId}`);
}

export async function postDocAction(fd: FormData) {
  const kind = kindOf(fd);
  const ctx = await requireWrite(kind === "invoice" ? "sales" : "purchases");
  const base = docBase(kind), id = str(fd, "id");
  try {
    const db = await getDb();
    await db.transaction((tx) => postDoc(tx, kind, ctx.company.id, ctx.user.id, id, ctx.company.settings));
  } catch (e) { fail(e, `${base}/${id}`); }
  revalidatePath(base);
  redirect(`${base}/${id}`);
}

export async function payDocAction(fd: FormData) {
  const kind = kindOf(fd);
  const ctx = await requireWrite(kind === "invoice" ? "sales" : "purchases");
  const base = docBase(kind), id = str(fd, "id");
  try {
    const date = str(fd, "date");
    if (!isIsoDate(date)) throw new UserError("err_required");
    const db = await getDb();
    await db.transaction((tx) => payDoc(tx, kind, ctx.company.id, ctx.user.id, id, {
      date, amount: parseAmount(fd.get("amount")), moneyAccountId: str(fd, "moneyAccountId"), reference: str(fd, "reference"),
    }, ctx.company.settings));
  } catch (e) { fail(e, `${base}/${id}`); }
  revalidatePath(base);
  redirect(`${base}/${id}`);
}

export async function voidDocAction(fd: FormData) {
  const kind = kindOf(fd);
  const ctx = await requireWrite(kind === "invoice" ? "sales" : "purchases");
  const base = docBase(kind), id = str(fd, "id");
  const { t } = await getI18n();
  try {
    const db = await getDb();
    await db.transaction((tx) => voidDoc(tx, kind, ctx.company.id, ctx.user.id, id, today(), t("void_doc")));
  } catch (e) { fail(e, `${base}/${id}`); }
  revalidatePath(base);
  redirect(`${base}/${id}`);
}

export async function deleteDocDraft(fd: FormData) {
  const kind = kindOf(fd);
  const ctx = await requireWrite(kind === "invoice" ? "sales" : "purchases");
  const base = docBase(kind), id = str(fd, "id");
  try {
    const db = await getDb();
    await db.transaction(async (tx) => {
      const d = await getDoc(tx, kind, ctx.company.id, id);
      if (d.status !== "draft") throw new UserError("err_posted_locked");
      if (kind === "invoice") await tx.delete(schema.invoices).where(eq(schema.invoices.id, id));
      else await tx.delete(schema.bills).where(eq(schema.bills.id, id));
      await audit(tx, ctx.company.id, ctx.user.id, "delete_draft", kind, id, { number: d.number });
    });
  } catch (e) { fail(e, `${base}/${id}`); }
  revalidatePath(base);
  redirect(base);
}
