import type { ModuleKey } from "@/db/schema";
import type { T } from "@/lib/i18n";
import { money as fmt, type Lang } from "@/lib/format";
import { MODULES } from "@/lib/roles";

/** The modules an organisation can choose, each with what it contains and its price. */
export function ModulePicker({ t, lang, prices, currency, selected, disabled }: {
  t: T; lang: Lang; prices: Record<ModuleKey, number>; currency: string; selected: ModuleKey[]; disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled} className="modules">
      {MODULES.map((m) => (
        <label key={m} className="module">
          <input id={`mod-${m}`} type="checkbox" name="modules" value={m} defaultChecked={selected.includes(m)} />
          <span>
            <b>{t(`module_${m}`)}</b>
            <span className="small muted">{t(`module_${m}_help`)}</span>
            <span className="num small">{fmt(prices[m], lang, 2)} {currency} {t("per_month")}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
