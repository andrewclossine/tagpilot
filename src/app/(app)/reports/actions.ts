"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { audit } from "@/lib/audit";
import { requireView, requireWrite } from "@/lib/auth";
import { fail } from "@/lib/actions";
import { getI18n } from "@/lib/i18n";
import { UserError } from "@/lib/ledger";
import { mailConfigured, sendMail } from "@/lib/mail";
import { isReportKind, reportArea } from "@/lib/reports";
import { readQuery, reportFiles } from "@/lib/report-view";
import { isIsoDate, str } from "@/lib/format";
import { taxLinesFor, type TaxLine } from "@/lib/tax-lines";

/** Saves which income tax line each income and expense account belongs to. */
export async function saveTaxLines(fd: FormData) {
  const ctx = await requireWrite("accounts");
  const db = await getDb();
  const accounts = await db.select().from(schema.accounts).where(eq(schema.accounts.companyId, ctx.company.id));
  let changed = 0;
  await db.transaction(async (tx) => {
    for (const a of accounts) {
      const line = str(fd, `tax_${a.id}`);
      if (!line || line === a.taxLine || !taxLinesFor(a.type).includes(line as TaxLine)) continue;
      await tx.update(schema.accounts).set({ taxLine: line }).where(eq(schema.accounts.id, a.id));
      changed++;
    }
    if (changed) await audit(tx, ctx.company.id, ctx.user.id, "update", "tax_lines", ctx.company.id, { accounts: changed });
  });
  revalidatePath("/reports/tax-prep");
  const from = str(fd, "from"), to = str(fd, "to");
  redirect(`/reports/tax-prep?saved=1${isIsoDate(from) ? `&from=${from}` : ""}${isIsoDate(to) ? `&to=${to}` : ""}`);
}

/** Emails a report, as PDF, Excel or both, with the dates, columns and title it was shown with. */
export async function emailReport(fd: FormData) {
  const kind = str(fd, "kind");
  if (!isReportKind(kind)) redirect("/reports");
  const ctx = await requireView(reportArea(kind));
  const back = str(fd, "back").startsWith(`/reports/${kind}`) ? str(fd, "back") : `/reports/${kind}`;
  const to = str(fd, "to").split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  try {
    if (!to.length || to.length > 10 || to.some((a) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a))) throw new UserError("err_email_invalid");
    if (!mailConfigured() && process.env.NODE_ENV === "production") throw new UserError("err_mail_off");
    const format = str(fd, "format");
    const params = new URLSearchParams(str(fd, "query"));
    const query = readQuery(ctx, (k) => params.get(k));
    const { files, title, report } = await reportFiles(ctx, kind, query, { pdf: format !== "xlsx", xlsx: format === "xlsx" || format === "both" });
    const { t } = await getI18n();
    const message = str(fd, "message").slice(0, 2000) || `${t("r_mail_body")} ${title} (${report.period}).`;
    const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)).replace(/\n/g, "<br>");
    await sendMail(to.join(", "), `${title} - ${ctx.company.name}`, `${message}\n\n${ctx.user.name}\n${ctx.company.name}`,
      `<p>${esc(message)}</p><p>${esc(ctx.user.name)}<br>${esc(ctx.company.name)}</p>`, files);
    const db = await getDb();
    await audit(db, ctx.company.id, ctx.user.id, "email", "report", kind, { to, format });
  } catch (e) { fail(e, back); }
  redirect(`${back}${back.includes("?") ? "&" : "?"}emailed=${encodeURIComponent(to.join(", "))}`);
}
