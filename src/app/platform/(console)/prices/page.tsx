import { getI18n } from "@/lib/i18n";
import { requirePlatformOwner } from "@/lib/platform";
import { sp, type SearchParams } from "@/lib/actions";
import { defaultCurrency, priceList } from "@/lib/billing";
import { CURRENCIES } from "@/lib/template";
import { MODULES } from "@/lib/roles";
import { STORAGE_GB, STORAGE_TIERS, TIERS } from "@/lib/plans";
import type { Key } from "@/lib/i18n";
import { ConfirmButton } from "@/components/editors";
import { ErrorNote, PageHead } from "@/components/ui";
import { removeCurrencyAction, savePricesAction } from "../../actions";

export const metadata = { title: "Prices" };

/** The monthly price of each app in every currency subscribers can pay in. A year costs ten months. */
export default async function PricesPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePlatformOwner();
  const { t, err } = await getI18n();
  const q = await sp(searchParams);
  const list = await priceList();
  const def = defaultCurrency();
  const unused = CURRENCIES.filter((c) => !list.some((l) => l.currency === c));
  const row = (currency: string, prices: Record<string, number> | null, isNew: boolean) => (
    <form key={currency || "new"} action={savePricesAction} className="panel stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        {isNew ? (
          <label className="f" style={{ maxWidth: 200 }}>{t("prc_add")}
            <select id="prc-new" name="currency" defaultValue="RWF">{unused.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
        ) : <h2 style={{ margin: 0 }}>{currency}{currency === def ? <span className="small muted"> · {t("prc_default")}</span> : null}</h2>}
      </div>
      {isNew ? null : <input type="hidden" name="currency" value={currency} />}
      {MODULES.map((m) => (
        <div key={m} className="fields">
          {TIERS[m].map((tier) => (
            <label key={tier} className="f">{t(`module_${m}` as Key)} · {t(`tier_${tier}` as Key)}
              <input id={`prc-${currency || "new"}-${m}-${tier}`} name={`price_${m}:${tier}`} className="num" inputMode="decimal" defaultValue={prices ? prices[`${m}:${tier}`] ?? "" : ""} required /></label>
          ))}
        </div>
      ))}
      <div className="fields">
        {STORAGE_TIERS.map((tier) => (
          <label key={tier} className="f">{t("mf_title")} · {t(`tier_${tier}` as Key)} ({STORAGE_GB[tier] >= 1024 ? `${STORAGE_GB[tier] / 1024} TB` : `${STORAGE_GB[tier]} GB`})
            <input id={`prc-${currency || "new"}-files-${tier}`} name={`price_files:${tier}`} className="num" inputMode="decimal" defaultValue={prices ? prices[`files:${tier}`] ?? "" : ""} required /></label>
        ))}
      </div>
      <div className="fields">
        <label className="f">{t("pk_extra_users")} · {t("per_month")}
          <input id={`prc-${currency || "new"}-seat`} name="price_seat" className="num" inputMode="decimal" defaultValue={prices ? prices.seat ?? "" : ""} required /></label>
      </div>
      <div><button type="submit" className="btn primary">{t("save")}</button></div>
    </form>
  );
  const remove = (currency: string) => (
    <form key={`rm-${currency}`} action={removeCurrencyAction} className="row" style={{ marginTop: -8 }}>
      <input type="hidden" name="currency" value={currency} />
      <ConfirmButton className="btn sm ghost danger" confirmLabel={t("confirm")}>{t("prc_remove")} ({currency})</ConfirmButton>
    </form>
  );
  return (
    <div className="stack">
      <PageHead title={t("prc_title")} />
      <div className="small muted">{t("prc_help")}</div>
      <ErrorNote message={err(q("error"))} />
      {q("saved") ? <div className="note ok small">{t("saved")}</div> : null}
      {list.map((l) => [row(l.currency, l.prices, false), l.currency !== def ? remove(l.currency) : null])}
      {unused.length ? row("", null, true) : null}
    </div>
  );
}
