"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { requireWrite } from "@/lib/auth";
import { fail, withParam } from "@/lib/actions";
import { isIsoDate, str } from "@/lib/format";
import { UserError } from "@/lib/ledger";
import { setClosingDate } from "@/lib/closing";

const BASE = "/close-books";

/** Sets the closing date, or clears it. Administrators only. */
export async function saveClosingDate(fd: FormData) {
  const ctx = await requireWrite("journal");
  try {
    if (!ctx.isAdmin) throw new UserError("err_admin_only");
    const raw = str(fd, "date");
    const date = str(fd, "do") === "clear" ? null : raw;
    if (date !== null && !isIsoDate(date)) throw new UserError("err_required");
    const db = await getDb();
    await db.transaction((tx) => setClosingDate(tx, ctx.company, ctx.user.id, date, str(fd, "reason")));
  } catch (e) { fail(e, BASE); }
  revalidatePath(BASE);
  redirect(withParam(BASE, "saved", "1"));
}

/** Closes a whole year: the books are closed through its last day. */
export async function closeYear(fd: FormData) {
  const ctx = await requireWrite("journal");
  const year = Number(str(fd, "year"));
  try {
    if (!ctx.isAdmin) throw new UserError("err_admin_only");
    if (!(year >= 2000 && year < new Date().getFullYear() + 1)) throw new UserError("err_required");
    const end = `${year}-12-31`;
    const old = ctx.company.settings.closedThrough;
    if (old && old >= end) throw new UserError("err_year_closed");
    const db = await getDb();
    await db.transaction((tx) => setClosingDate(tx, ctx.company, ctx.user.id, end, ""));
  } catch (e) { fail(e, `${BASE}?year=${year}`); }
  revalidatePath(BASE);
  redirect(withParam(`${BASE}?year=${year}`, "closed", String(year)));
}
