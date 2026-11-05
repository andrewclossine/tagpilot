import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { assetBalances } from "@/lib/assets";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { isIsoDate, lastDayOfMonth, parseAmount, round2, today } from "@/lib/format";
import { moneyAccounts } from "@/lib/ledger";
import { ConfirmButton } from "@/components/editors";
import { Empty, ErrorNote, PageHead } from "@/components/ui";
import { assetMovement } from "../actions";

export const metadata = { title: "Dispose of an asset" };

/** IAS 16.67-72: the gain or loss is the sale proceeds less the carrying amount on the day the asset goes. */
export default async function DisposePage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("assets");
  const { t, err, money } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  const [assets, balances, accounts, past] = await Promise.all([
    db.select().from(schema.fixedAssets).where(and(eq(schema.fixedAssets.companyId, ctx.company.id), eq(schema.fixedAssets.status, "active"))).orderBy(schema.fixedAssets.code),
    assetBalances(db, ctx.company.id),
    moneyAccounts(db, ctx.company.id),
    db.select({ m: schema.assetMovements, code: schema.fixedAssets.code, name: schema.fixedAssets.name }).from(schema.assetMovements)
      .innerJoin(schema.fixedAssets, eq(schema.fixedAssets.id, schema.assetMovements.assetId))
      .where(and(eq(schema.assetMovements.companyId, ctx.company.id), eq(schema.assetMovements.type, "disposal"))).orderBy(desc(schema.assetMovements.date)).limit(100),
  ]);
  const asset = assets.find((a) => a.id === q("asset"));
  const b = asset ? balances.get(asset.id) ?? { cost: 0, accum: 0, carrying: 0 } : null;
  const date = isIsoDate(q("date")) ? q("date") : today();
  const entered = q("proceeds") !== "";
  const proceeds = parseAmount(q("proceeds"));
  const gain = b && entered ? round2(proceeds - b.carrying) : null;
  // Depreciation runs up to the month before the asset goes, so the carrying amount is not overstated.
  const prevMonth = (() => { const d = new Date(`${date.slice(0, 7)}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return lastDayOfMonth(d.toISOString().slice(0, 7)); })();
  const behind = !!asset && asset.availableDate <= prevMonth && (!asset.depreciatedTo || asset.depreciatedTo < prevMonth);
  const write = ctx.can("assets", "write");
  return (
    <div className="stack">
      <PageHead title={t("nav_dispose_asset")} />
      <p className="muted" style={{ margin: 0, maxWidth: "70ch" }}>{t("dsp_help")}</p>
      <ErrorNote message={err(q("error"))} />
      <form method="get" className="panel stack">
        <div className="fields">
          <label className="f">{t("nav_asset_register")}
            <select id="d-asset" name="asset" required defaultValue={asset?.id ?? ""}>
              <option value="">—</option>
              {assets.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </select></label>
          <label className="f">{t("dsp_date")}<input id="d-date" name="date" type="date" required defaultValue={date} /></label>
          <label className="f">{t("proceeds")} ({ctx.company.currency})<input id="d-proceeds" name="proceeds" className="num" inputMode="decimal" required defaultValue={q("proceeds")} /></label>
        </div>
        <div><button type="submit" className="btn">{t("dsp_calculate")}</button></div>
      </form>
      {asset && b && gain !== null ? (
        <div className="panel stack">
          <h2>{asset.code} · {asset.name}</h2>
          {behind ? <div className="note warn small">{t("dsp_behind").replace("{date}", prevMonth)} <Link href="/assets">{t("nav_asset_register")} →</Link></div> : null}
          <table><tbody>
            <tr><td>{t("dep_cost")}</td><td className="num">{money(b.cost, 2)}</td></tr>
            <tr><td>{t("dep_accum")}</td><td className="num">{money(-b.accum, 2)}</td></tr>
            <tr><td><b>{t("dep_carrying")}</b></td><td className="num"><b>{money(b.carrying, 2)}</b></td></tr>
            <tr><td>{t("proceeds")}</td><td className="num">{money(proceeds, 2)}</td></tr>
            <tr className="total"><td>{t(gain >= 0 ? "dsp_gain" : "dsp_loss")}</td><td className="num" style={{ color: gain < 0 ? "var(--bad)" : "var(--ok)" }}>{money(Math.abs(gain), 2)}</td></tr>
          </tbody></table>
          {write ? (
            <form action={assetMovement} className="stack">
              <input type="hidden" name="id" value={asset.id} /><input type="hidden" name="kind" value="disposal" />
              <input type="hidden" name="date" value={date} /><input type="hidden" name="amount" value={proceeds} />
              <div className="fields">
                {proceeds > 0 ? (
                  <label className="f">{t("paid_into")}
                    <select id="d-money" name="moneyAccountId" required defaultValue="">
                      <option value="">—</option>
                      {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.nameEn}</option>)}
                    </select></label>
                ) : null}
                <label className="f">{t("notes")}<input id="d-notes" name="notes" /></label>
              </div>
              <div><ConfirmButton className="btn danger" confirmLabel={t("confirm")}>{t("dsp_confirm")}</ConfirmButton></div>
            </form>
          ) : null}
        </div>
      ) : null}
      <div className="panel stack">
        <h2>{t("dsp_past")}</h2>
        {past.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("date")}</th><th>{t("code")}</th><th>{t("name")}</th><th className="num">{t("proceeds")}</th><th className="num">{t("dsp_gain_loss")}</th></tr></thead>
            <tbody>{past.map(({ m, code, name }) => (
              <tr key={m.id}>
                <td>{m.date}</td><td><Link href={`/assets/${m.assetId}`}><code className="k">{code}</code></Link></td><td>{name}</td>
                <td className="num">{money(m.proceeds, 2)}</td>
                <td className="num" style={{ color: m.gainLoss < 0 ? "var(--bad)" : "var(--ok)" }}>{money(m.gainLoss, 2)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>{t("nothing_yet")}</Empty>}
      </div>
    </div>
  );
}
