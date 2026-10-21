"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireWrite } from "@/lib/auth";
import { fail } from "@/lib/actions";
import { isIsoDate, str, today } from "@/lib/format";
import { deleteDraft, postDraft, reverseEntry, saveEntry, UserError } from "@/lib/ledger";
import { getI18n } from "@/lib/i18n";
import { parseJournalLines } from "@/lib/parse";

export async function saveJournal(fd: FormData) {
  const ctx = await requireWrite();
  const id = str(fd, "id") || undefined;
  const back = id ? `/journal/${id}` : "/journal/new";
  const post = str(fd, "intent") === "post";
  let savedId: string;
  try {
    const date = str(fd, "date");
    if (!isIsoDate(date)) throw new UserError("err_required");
    const lines = parseJournalLines(fd);
    const db = await getDb();
    // Source, attachment and AI notes stay as they were when the draft was created.
    const [old] = id ? await db.select().from(schema.journalEntries)
      .where(and(eq(schema.journalEntries.id, id), eq(schema.journalEntries.companyId, ctx.company.id))) : [];
    savedId = await db.transaction((tx) => saveEntry(tx, ctx.company.id, ctx.user.id, {
      id, date, reference: str(fd, "reference"), memo: str(fd, "memo"),
      partnerId: str(fd, "partnerId") || null, projectId: str(fd, "projectId") || null,
      source: old?.source ?? "manual", sourceId: old?.sourceId, attachmentId: old?.attachmentId, ai: old?.ai,
      lines,
    }, post));
  } catch (e) { fail(e, back); }
  revalidatePath("/journal");
  redirect(`/journal/${savedId}?saved=1`);
}

export async function postJournal(fd: FormData) {
  const ctx = await requireWrite();
  const id = str(fd, "id");
  try {
    const db = await getDb();
    await db.transaction((tx) => postDraft(tx, ctx.company.id, ctx.user.id, id));
  } catch (e) { fail(e, `/journal/${id}`); }
  revalidatePath("/journal");
  redirect(`/journal/${id}?saved=1`);
}

export async function reverseJournal(fd: FormData) {
  const ctx = await requireWrite();
  const id = str(fd, "id");
  const { t } = await getI18n();
  let newId: string;
  try {
    const db = await getDb();
    newId = await db.transaction((tx) => reverseEntry(tx, ctx.company.id, ctx.user.id, id, str(fd, "date") || today(), t("reverse_of")));
  } catch (e) { fail(e, `/journal/${id}`); }
  revalidatePath("/journal");
  redirect(`/journal/${newId}`);
}

/** Adds the supplier or customer the AI found on a document, and links it to the draft. */
export async function addPartnerFromAi(fd: FormData) {
  const ctx = await requireWrite();
  const id = str(fd, "id");
  const db = await getDb();
  const [e] = await db.select().from(schema.journalEntries)
    .where(and(eq(schema.journalEntries.id, id), eq(schema.journalEntries.companyId, ctx.company.id)));
  const np = e?.ai?.newPartner;
  if (e && np && e.status === "draft") {
    await db.transaction(async (tx) => {
      const [p] = await tx.insert(schema.partners).values({ companyId: ctx.company.id, name: np.name, tin: np.tin, kind: np.kind })
        .returning({ id: schema.partners.id });
      await tx.update(schema.journalEntries).set({ partnerId: p.id, ai: { ...e.ai!, newPartner: null } }).where(eq(schema.journalEntries.id, id));
      await tx.update(schema.journalLines).set({ partnerId: p.id }).where(eq(schema.journalLines.entryId, id));
    });
  }
  revalidatePath(`/journal/${id}`);
  redirect(`/journal/${id}`);
}

export async function deleteJournal(fd: FormData) {
  const ctx = await requireWrite();
  const id = str(fd, "id");
  try {
    const db = await getDb();
    await db.transaction((tx) => deleteDraft(tx, ctx.company.id, ctx.user.id, id));
  } catch (e) { fail(e, `/journal/${id}`); }
  revalidatePath("/journal");
  redirect("/journal");
}
