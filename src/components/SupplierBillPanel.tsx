import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getI18n } from "@/lib/i18n";
import { addDays, today } from "@/lib/format";
import { Pill } from "./ui";

/** On a supplier's own contract: the bills it has sent, and a form to send another. */
export async function SupplierBillPanel({ contractId, currency, canSend, action }: { contractId: string; currency: string; canSend: boolean; action: (fd: FormData) => Promise<void> }) {
  const { t, money } = await getI18n();
  const db = await getDb();
  const rows = await db.select().from(schema.supplierBills).where(eq(schema.supplierBills.contractId, contractId)).orderBy(desc(schema.supplierBills.createdAt));
  const pill = { received: "open", accepted: "paid", rejected: "void" } as const;
  return (
    <div className="panel stack">
      <h2>{t("rb_my_bills")}</h2>
      {rows.length ? (
        <div className="tbl-wrap"><table>
          <thead><tr><th>{t("reference")}</th><th>{t("date")}</th><th>{t("description")}</th><th className="num">{t("rb_amount")}</th><th>{t("status")}</th></tr></thead>
          <tbody>{rows.map((s) => (
            <tr key={s.id}>
              <td>{s.reference}</td><td>{s.date}</td>
              <td style={{ whiteSpace: "pre-wrap" }}>{s.description}{s.decisionNote ? <div className="small muted">{s.decisionNote}</div> : null}</td>
              <td className="num">{money(s.amount, 2)}</td>
              <td><Pill kind={pill[s.status]}>{t(`rb_${s.status}`)}</Pill></td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : null}
      {canSend ? (
        <form action={action} className="stack">
          <h3 style={{ margin: 0 }}>{t("rb_send")}</h3>
          <input type="hidden" name="contractId" value={contractId} />
          <div className="fields">
            <label className="f">{t("rb_your_number")}<input id="sb-ref" name="reference" required /></label>
            <label className="f">{t("date")}<input id="sb-date" name="date" type="date" required defaultValue={today()} /></label>
            <label className="f">{t("due_date")}<input id="sb-due" name="dueDate" type="date" required defaultValue={addDays(today(), 30)} /></label>
            <label className="f">{t("rb_amount")} ({currency})<input id="sb-amount" name="amount" className="num" inputMode="decimal" required /></label>
            <label className="f">{t("attachment")}<input id="sb-file" name="file" type="file" accept="image/*,application/pdf" /></label>
          </div>
          <label className="f">{t("description")}<textarea id="sb-desc" name="description" rows={2} required /></label>
          <div><button type="submit" className="btn primary">{t("rb_send")}</button></div>
        </form>
      ) : null}
    </div>
  );
}
