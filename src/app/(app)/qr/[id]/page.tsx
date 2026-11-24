import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, gte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { isUuid } from "@/lib/format";
import { ConfirmButton } from "@/components/editors";
import { ErrorNote, PageHead, Pill } from "@/components/ui";
import { deleteQr, saveQr, toggleQr } from "../actions";
import { QrBuilder } from "../QrBuilder";
import { qrLabels, shortLinkOf } from "../labels";

export const metadata = { title: "QR code" };

/** One code: its scans over the last 30 days and by device, and the builder to change its look or, when dynamic, what it opens. */
export default async function QrPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const ctx = await requireView("qr");
  const { t, err } = await getI18n();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const q = await sp(searchParams);
  const db = await getDb();
  const [c] = await db.select().from(schema.qrCodes).where(and(eq(schema.qrCodes.id, id), eq(schema.qrCodes.companyId, ctx.company.id)));
  if (!c) notFound();
  const since = new Date(Date.now() - 29 * 86400000);
  const scans = c.dynamic ? await db.select().from(schema.qrScans).where(and(eq(schema.qrScans.codeId, id), gte(schema.qrScans.at, new Date(since.toISOString().slice(0, 10))))).orderBy(desc(schema.qrScans.at)) : [];
  const days = Array.from({ length: 30 }, (_, i) => new Date(since.getTime() + i * 86400000).toISOString().slice(0, 10));
  const perDay = days.map((d) => scans.filter((s) => s.at.toISOString().slice(0, 10) === d).length);
  const max = Math.max(1, ...perDay);
  const by = (k: "device" | "os") => Object.entries(scans.reduce<Record<string, number>>((m, s) => ({ ...m, [s[k] || "Other"]: (m[s[k] || "Other"] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  const write = ctx.can("qr", "write");
  return (
    <div className="stack">
      <PageHead title={c.name}>
        <Pill kind={c.active ? "paid" : "void"}>{t(c.dynamic ? "qr_dynamic_short" : "qr_static_short")}{c.active ? "" : ` · ${t("qr_paused")}`}</Pill>
        {write && c.dynamic ? <form action={toggleQr}><input type="hidden" name="id" value={c.id} /><button type="submit" className="btn">{t(c.active ? "qr_pause" : "qr_resume")}</button></form> : null}
        {write ? <form action={deleteQr}><input type="hidden" name="id" value={c.id} /><ConfirmButton className="btn ghost danger" confirmLabel={t("confirm")}>{t("delete")}</ConfirmButton></form> : null}
        <Link className="btn ghost" href="/qr">{t("back")}</Link>
      </PageHead>
      <ErrorNote message={err(q("error"))} />
      {q("saved") ? <div className="note ok small">{t("saved")}</div> : null}
      {c.dynamic ? (
        <div className="panel stack">
          <h2>{t("qr_scans")} <span className="small muted">· {t("qr_scans_n").replace("{n}", String(c.scans))} · {t("qr_last_30")}: {scans.length}</span></h2>
          <div className="qr-bars" aria-label={t("qr_last_30")}>
            {perDay.map((n, i) => <div key={days[i]} title={`${days[i]}: ${n}`} style={{ height: `${Math.max(2, (n / max) * 100)}%` }} />)}
          </div>
          <div className="row small muted" style={{ justifyContent: "space-between" }}><span>{days[0]}</span><span>{days[29]}</span></div>
          {scans.length ? (
            <div className="fields">
              <div><div className="label">{t("qr_by_device")}</div>{by("device").map(([k, n]) => <div key={k} className="small">{t(`qr_dev_${k}` as never) || k}: <b>{n}</b></div>)}</div>
              <div><div className="label">{t("qr_by_os")}</div>{by("os").map(([k, n]) => <div key={k} className="small">{k}: <b>{n}</b></div>)}</div>
            </div>
          ) : <div className="small muted">{t("qr_no_scans")}</div>}
        </div>
      ) : null}
      {write ? (
        <QrBuilder action={saveQr} shortLink={c.dynamic ? shortLinkOf(c.slug) : null} labels={qrLabels(t)} locked={!c.dynamic}
          initial={{ id: c.id, name: c.name, type: c.type, data: c.data, dynamic: c.dynamic, style: c.style }} />
      ) : null}
    </div>
  );
}
