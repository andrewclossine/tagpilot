import type { ModuleKey } from "@/db/schema";
import type { Key, T } from "@/lib/i18n";
import { money as fmt, type Lang } from "@/lib/format";
import { MODULES } from "@/lib/roles";
import { DEFAULT_TIER, STORAGE_GB, STORAGE_TIERS, TIERS, USERS, tierOf, type Tier } from "@/lib/plans";

/**
 * The apps an organisation can choose, each in its packages: Free, Starter, Business or Premium, with what each
 * holds, how many people it allows and its price. Plain radio buttons, so it works without scripts.
 */
export function ModulePicker({ t, lang, prices, currency, selected, tiers = {}, seats, storage = "free", disabled }: {
  t: T; lang: Lang; prices: Record<string, number>; currency: string; selected: ModuleKey[];
  tiers?: Partial<Record<ModuleKey, Tier>>; seats?: number; storage?: Tier; disabled?: boolean;
}) {
  const users = (n: number | undefined) => (n === undefined || !Number.isFinite(n) ? t("pk_users_unlimited") : t("pk_users_n").replace("{n}", String(n)));
  return (
    <fieldset disabled={disabled} className="modules packages">
      {MODULES.map((m) => {
        const current = selected.includes(m) ? tierOf({ tiers }, m) : DEFAULT_TIER[m];
        return (
          <div key={m} className="package">
            <label className="row package-head">
              <input id={`mod-${m}`} type="checkbox" name="modules" value={m} defaultChecked={selected.includes(m)} style={{ width: "auto" }} />
              <span><b>{t(`module_${m}` as Key)}</b><span className="small muted"> · {t(`module_${m}_help` as Key)}</span></span>
            </label>
            <div className="package-tiers">
              {TIERS[m].map((tier) => (
                <label key={tier} className="package-tier">
                  <input type="radio" name={`tier_${m}`} value={tier} defaultChecked={tier === current} style={{ width: "auto" }} />
                  <span>
                    <b>{t(`tier_${tier}` as Key)}</b>
                    <span className="num">{prices[`${m}:${tier}`] ? `${fmt(prices[`${m}:${tier}`], lang, 0)} ${currency} ${t("per_month")}` : t("pk_free")}</span>
                    <span className="small muted">{users(USERS[m][tier])} · {t(`pk_${m}_${tier}` as Key)}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        );
      })}
      <div className="package">
        <div className="package-head"><b>{t("mf_title")}</b><span className="small muted"> · {t("pk_files_help")}</span></div>
        <div className="package-tiers">
          {STORAGE_TIERS.map((tier) => (
            <label key={tier} className="package-tier">
              <input type="radio" name="tier_files" value={tier} defaultChecked={tier === storage} style={{ width: "auto" }} />
              <span>
                <b>{t(`tier_${tier}` as Key)}</b>
                <span className="num">{prices[`files:${tier}`] ? `${fmt(prices[`files:${tier}`], lang, 0)} ${currency} ${t("per_month")}` : t("pk_free")}</span>
                <span className="small muted">{STORAGE_GB[tier] >= 1024 ? `${STORAGE_GB[tier] / 1024} TB` : `${STORAGE_GB[tier]} GB`}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
      {seats !== undefined ? (
        <label className="f" style={{ maxWidth: 320 }}>{t("pk_extra_users")}
          <input id="seats" name="seats" type="number" min={0} max={500} defaultValue={seats} className="num" />
          <span className="small muted">{t("pk_extra_users_help").replace("{price}", `${fmt(prices.seat ?? 0, lang, 0)} ${currency}`)}</span>
        </label>
      ) : null}
    </fieldset>
  );
}
