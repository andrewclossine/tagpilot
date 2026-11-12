"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireWrite } from "@/lib/auth";
import { fail, withParam } from "@/lib/actions";
import { str } from "@/lib/format";
import { getI18n } from "@/lib/i18n";
import { UserError } from "@/lib/ledger";
import { audit } from "@/lib/audit";
import { overdueInvoices, sendReminder } from "@/lib/reminders";

const BASE = "/sales/reminders";

export async function remindOne(fd: FormData) {
  const ctx = await requireWrite("sales");
  const { lang } = await getI18n();
  let to = "";
  try { to = await sendReminder(ctx.company, ctx.user.id, str(fd, "id"), lang); } catch (e) { fail(e, BASE); }
  revalidatePath(BASE);
  redirect(withParam(BASE, "sent", to));
}

/** Reminds every overdue customer who has an email address. */
export async function remindAll() {
  const ctx = await requireWrite("sales");
  const { lang } = await getI18n();
  let n = 0;
  try {
    const db = await getDb();
    const list = (await overdueInvoices(db, ctx.company.id)).filter((o) => o.customer.email);
    if (!list.length) throw new UserError("err_rem_none");
    for (const o of list) { await sendReminder(ctx.company, ctx.user.id, o.d.id, lang); n++; }
  } catch (e) { fail(e, n ? withParam(BASE, "count", String(n)) : BASE); }
  revalidatePath(BASE);
  redirect(withParam(BASE, "count", String(n)));
}

/** How often overdue invoices are reminded by themselves: every so many days, or never. */
export async function setReminderDays(fd: FormData) {
  const ctx = await requireWrite("sales");
  try {
    const days = Math.round(Number(str(fd, "days")) || 0);
    if (days < 0 || days > 90) throw new UserError("err_rem_days");
    const db = await getDb();
    await db.update(schema.companies).set({ settings: { ...ctx.company.settings, reminderDays: days } }).where(eq(schema.companies.id, ctx.company.id));
    await audit(db, ctx.company.id, ctx.user.id, "reminder_settings", "company", ctx.company.name, { days });
  } catch (e) { fail(e, BASE); }
  revalidatePath(BASE);
  redirect(withParam(BASE, "saved", "1"));
}
