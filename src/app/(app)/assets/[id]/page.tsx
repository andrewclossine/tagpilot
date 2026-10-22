import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { assetBalances, loadAsset } from "@/lib/assets";
import { moneyAccounts, UserError } from "@/lib/ledger";
import { today } from "@/lib/format";
import { ErrorNote, PageHead, Pill } from "@/components/ui";
import { ConfirmButton } from "@/components/editors";
import { assetMovement } from "../actions";

export const metadata = { title: "Fixed asset" };

export default async function AssetPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const ctx = await requireView("assets");
  const { t, err, money } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  let row;
  try { row = await loadAsset(db, ctx.company.id, id); } catch (e) { if (e instanceof UserError) notFound(); throw e; }
  const { a, cat } = row;
  const [moves, bal, moneyAccs] = await Promise.all([
    db.select().from(schema.assetMovements).where(eq(schema.assetMovements.assetId, id)).orderBy(asc(schema.assetMovements.date), asc(schema.assetMovements.createdAt)),
    assetBalances(db, ctx.company.id),
    moneyAccounts(db, ctx.company.id),
  ]);
  const b = bal.get(id) ?? { cost: 0, accum: 0, carrying: 0 };
  const active = a.status === "active" && ctx.can("assets", "write");
  const form = (kind: "addition" | "impairment" | "revaluation" | "disposal", title: string, amountLabel: string, help: string, needsMoney: boolean) => (
    <form action={assetMovement} className="panel stack" style={{ gap: 10 }}>
      <h3>{title}</h3>
      <div className="small muted">{help}</div>
      <input type="hidden" name="id" value={a.id} /><input type="hidden" name="kind" value={kind} />
      <div className="fields">
        <label className="f">{t("date")}<input type="date" name="date" id={`${kind}-date`} defaultValue={today()} required /></label>
        <label className="f">{amountLabel}<input name="amount" id={`${kind}-amount`} className="num" inputMode="decimal" required /></label>
        {needsMoney ? <label className="f">{kind === "disposal" ? t("paid_into") : t("paid_from")}
          <select name="moneyAccountId" id={`${kind}-money`}><option value="">—</option>{moneyAccs.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.nameEn}</option>)}</select></label> : null}
        <label className="f">{t("notes")}<input name="notes" id={`${kind}-notes`} /></label>
      </div>
      <div><ConfirmButton className={kind === "disposal" ? "btn danger" : "btn"} confirmLabel={t("confirm")}>{title}</ConfirmButton></div>
    </form>
  );
  return (
    <div className="stack">
      <PageHead title={`${a.code} · ${a.name}`}>
        <Pill kind={a.status === "active" ? "posted" : "void"}>{t(a.status === "active" ? "active" : "asset_disposed")}</Pill>
        <Link className="btn ghost" href="/assets">{t("back")}</Link>
      </PageHead>
      <ErrorNote message={err(q("error"))} />
      {q("saved") ? <div className="note ok small">{t("saved")}</div> : null}
      <div className="kpis">
        <div className="panel kpi"><div className="label">{t("asset_cost")}</div><div className="v">{money(b.cost)}</div></div>
        <div className="panel kpi"><div className="label">{t("asset_accum")}</div><div className="v">{money(b.accum)}</div></div>
        <div className="panel kpi"><div className="label">{t("asset_nbv")}</div><div className="v">{money(b.carrying)}</div></div>
      </div>
      <div className="grid2">
        <div className="panel stack">
          <div className="fields">
            <div><div className="label">{t("asset_category")}</div>{cat.name}</div>
            <div><div className="label">{t("asset_method")}</div>{t(a.method)}{a.method === "reducing_balance" ? ` · ${a.rate}%` : ""}</div>
            <div><div className="label">{t("asset_life_months")}</div>{a.usefulLifeMonths}</div>
            <div><div className="label">{t("asset_residual")}</div>{money(a.residualValue)}</div>
            <div><div className="label">{t("asset_acquired")}</div>{a.acquisitionDate}</div>
            <div><div className="label">{t("asset_available")}</div>{a.availableDate}</div>
            <div><div className="label">{t("asset_location")}</div>{a.location || "—"}</div>
            <div><div className="label">{t("asset_serial")}</div>{a.serialNo || "—"}</div>
            <div><div className="label">{t("asset_dep_to")}</div>{a.depreciatedTo ?? "—"}</div>
          </div>
          <h3>{t("asset_movements")}</h3>
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("date")}</th><th>{t("type")}</th><th className="num">{t("asset_cost")}</th><th className="num">{t("asset_accum")}</th><th className="num">{t("asset_gain")}</th><th /></tr></thead>
            <tbody>
              {moves.map((m) => (
                <tr key={m.id}><td className="num" style={{ textAlign: "left" }}>{m.date}</td><td>{t(`mv_${m.type}`)}{m.notes ? <div className="small muted">{m.notes}</div> : null}</td>
                  <td className="num">{m.cost ? money(m.cost) : ""}</td><td className="num">{m.depreciation ? money(m.depreciation) : ""}</td>
                  <td className="num">{m.gainLoss ? money(m.gainLoss) : ""}</td>
                  <td>{m.entryId ? <Link className="small" href={`/journal/${m.entryId}`}>→</Link> : null}</td></tr>
              ))}
            </tbody>
          </table></div>
        </div>
        {active ? (
          <div className="stack">
            {form("addition", t("mv_addition"), t("amount"), t("mv_addition_help"), true)}
            {form("impairment", t("mv_impairment"), t("amount"), t("mv_impairment_help"), false)}
            {form("revaluation", t("mv_revaluation"), t("fair_value"), t("mv_revaluation_help"), false)}
            {form("disposal", t("mv_disposal"), t("proceeds"), t("mv_disposal_help"), true)}
          </div>
        ) : null}
      </div>
    </div>
  );
}
