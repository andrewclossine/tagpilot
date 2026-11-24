import Link from "next/link";
import { getCtx } from "@/lib/auth";
import { getI18n, type Key } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { featureNeeds, type Feature } from "@/lib/plans";
import { PageHead } from "@/components/ui";

export const metadata = { title: "Upgrade" };

const FEATURES: Feature[] = ["payroll", "inventory", "assets", "budgets", "financial_statements", "batch", "manufacturing", "qr_logo", "qr_file"];

/** Shown instead of a part of TAGPILOT that the organisation's package does not include: what it needs, and where to get it. */
export default async function UpgradePage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await getCtx();
  const { t } = await getI18n();
  const q = await sp(searchParams);
  const f = (FEATURES as string[]).includes(q("feature")) ? (q("feature") as Feature) : null;
  const [module, tier] = f ? featureNeeds(f) : ["accounting", "business"];
  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      <PageHead title={t("up_title")} />
      <div className="panel stack">
        <p style={{ margin: 0 }}>
          {f ? t(`up_f_${f}` as Key) : t("up_generic")} {t("up_needs")} <b>{t(`module_${module}` as Key)} {t(`tier_${tier}` as Key)}</b>.
        </p>
        {ctx.isAdmin
          ? <div><Link className="btn primary" href={`/billing?upgrade=${module}`}>{t("up_change")}</Link></div>
          : <div className="small muted">{t("up_ask_admin")}</div>}
      </div>
    </div>
  );
}
