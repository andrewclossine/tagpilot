import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n, type Key } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { qrContent, qrSvg } from "@/lib/qr";
import { Empty, PageHead } from "@/components/ui";
import { shortLinkOf } from "./labels";

export const metadata = { title: "QR Codes" };

/** The organisation's QR codes, each with its picture, kind and scans. */
export default async function QrListPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("qr");
  const { t } = await getI18n();
  const q = await sp(searchParams);
  const db = await getDb();
  const codes = await db.select().from(schema.qrCodes).where(eq(schema.qrCodes.companyId, ctx.company.id)).orderBy(desc(schema.qrCodes.createdAt)).limit(300);
  const total = codes.reduce((s, c) => s + c.scans, 0);
  return (
    <div className="stack">
      <PageHead title={t("qr_title")}>
        {ctx.can("qr", "write") ? <Link className="btn primary" href="/qr/new">{t("qr_new")}</Link> : null}
      </PageHead>
      {q("deleted") ? <div className="note ok small">{t("qr_deleted")}</div> : null}
      <div className="kpis">
        <div className="panel kpi"><div className="label">{t("qr_k_codes")}</div><div className="v">{codes.length}</div></div>
        <div className="panel kpi"><div className="label">{t("qr_k_dynamic")}</div><div className="v">{codes.filter((c) => c.dynamic).length}</div></div>
        <div className="panel kpi"><div className="label">{t("qr_k_scans")}</div><div className="v">{total}</div></div>
      </div>
      {codes.length ? (
        <div className="qr-grid">
          {codes.map((c) => (
            <Link key={c.id} href={`/qr/${c.id}`} className="panel qr-card">
              <div className="qr-thumb" dangerouslySetInnerHTML={{ __html: qrSvg(c.dynamic ? shortLinkOf(c.slug) : qrContent(c.type, c.data), c.style, 120) }} />
              <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                <b className="qr-card-name">{c.name}</b>
                <span className="small muted">{t(`qr_t_${c.type}` as Key)} · {t(c.dynamic ? "qr_dynamic_short" : "qr_static_short")}{c.active ? "" : ` · ${t("qr_paused")}`}</span>
                {c.dynamic ? <span className="small">{t("qr_scans_n").replace("{n}", String(c.scans))}</span> : null}
              </div>
            </Link>
          ))}
        </div>
      ) : <div className="panel"><Empty>{t("qr_list_empty")}</Empty></div>}
    </div>
  );
}
