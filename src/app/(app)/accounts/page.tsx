import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { balances } from "@/lib/ledger";
import { today } from "@/lib/format";
import { ConfirmButton } from "@/components/editors";
import { ErrorNote, PageHead } from "@/components/ui";
import { deleteAccount, saveAccount } from "../settings/actions";

export const metadata = { title: "Chart of accounts" };

const SUBTYPES = ["bank", "cash", "momo", "ar", "ap", "vat_in", "vat_out", "wht"] as const;
const TYPES = ["asset", "liability", "equity", "income", "expense"] as const;

/** The chart of accounts, grouped by type, with each account's balance today. */
export default async function AccountsPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("accounts");
  const { t, err, money } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  const [accounts, bal] = await Promise.all([
    db.select().from(schema.accounts).where(eq(schema.accounts.companyId, ctx.company.id)).orderBy(schema.accounts.code),
    balances(db, ctx.company.id, { to: today() }),
  ]);
  const editing = accounts.find((a) => a.id === q("edit"));
  const canEdit = ctx.can("accounts", "write");
  const sign = (type: string) => (type === "asset" || type === "expense" ? 1 : -1);
  return (
    <div className="stack">
      <PageHead title={t("nav_coa")}>
        {canEdit ? <a className="btn primary" href="#acc">{t("add_account")}</a> : null}
      </PageHead>
      <ErrorNote message={err(q("error"))} />
      {q("saved") ? <div className="note ok small">{t("saved")}</div> : null}
      <div className="panel tbl-wrap">
        <table>
          <thead><tr><th>{t("code")}</th><th>{t("name")}</th><th>{t("subtype")}</th><th className="num">{t("balance")} ({ctx.company.currency})</th><th /></tr></thead>
          <tbody>
            {TYPES.map((ty) => {
              const list = accounts.filter((a) => a.type === ty);
              const total = list.reduce((s, a) => s + (bal.get(a.id)?.net ?? 0) * sign(ty), 0);
              return [
                <tr key={ty} className="sub"><td colSpan={3}>{t(`t_${ty}`)}</td><td className="num">{money(total)}</td><td /></tr>,
                ...list.map((a) => (
                  <tr key={a.id} style={{ opacity: a.isActive ? 1 : 0.5 }}>
                    <td><code className="k">{a.code}</code></td>
                    <td><Link className="rowlink" href={`/reports/gl?account=${a.id}&from=${today().slice(0, 4)}-01-01&to=${today()}`}>{a.nameEn}</Link>{a.nameFr && a.nameFr !== a.nameEn ? <div className="small muted">{a.nameFr}</div> : null}</td>
                    <td className="small">{a.subtype ? t(`sub_${a.subtype}`) : ""}</td>
                    <td className="num">{money((bal.get(a.id)?.net ?? 0) * sign(ty))}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{canEdit ? <>
                      <a className="btn ghost sm" href={`/accounts?edit=${a.id}#acc`}>{t("edit")}</a>
                      <form action={deleteAccount} style={{ display: "inline" }}><input type="hidden" name="id" value={a.id} />
                        <ConfirmButton className="btn ghost sm danger" confirmLabel={t("confirm")}>{t("delete")}</ConfirmButton></form>
                    </> : null}</td>
                  </tr>
                )),
              ];
            })}
          </tbody>
        </table>
      </div>
      {canEdit ? (
        <form action={saveAccount} className="panel stack" id="acc" key={editing?.id ?? "new"}>
          <h2>{editing ? `${t("edit")}: ${editing.code}` : t("add_account")}</h2>
          {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
          <div className="fields">
            <label className="f">{t("code")}<input id="a-code" name="code" defaultValue={editing?.code} required /></label>
            <label className="f">{t("name_en")}<input id="a-en" name="nameEn" defaultValue={editing?.nameEn} required /></label>
            <label className="f">{t("name_fr")}<input id="a-fr" name="nameFr" defaultValue={editing?.nameFr} /></label>
            <label className="f">{t("type")}<select id="a-type" name="type" defaultValue={editing?.type ?? "expense"}>{TYPES.map((x) => <option key={x} value={x}>{t(`t_${x}`)}</option>)}</select></label>
            <label className="f">{t("subtype")}<select id="a-sub" name="subtype" defaultValue={editing?.subtype ?? ""}><option value="">{t("sub_none")}</option>{SUBTYPES.map((x) => <option key={x} value={x}>{t(`sub_${x}`)}</option>)}</select></label>
            <label className="f">{t("status")}<select id="a-act" name="isActive" defaultValue={editing?.isActive === false ? "0" : "1"}><option value="1">{t("active")}</option><option value="0">{t("inactive")}</option></select></label>
          </div>
          <div className="row"><button type="submit" className="btn primary">{t("save")}</button>{editing ? <a className="btn ghost" href="/accounts">{t("cancel")}</a> : null}</div>
        </form>
      ) : null}
    </div>
  );
}
