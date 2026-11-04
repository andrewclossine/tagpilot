import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { isUuid } from "@/lib/format";
import { advertFor } from "@/lib/bidding";
import { biddingOpen, supplierSeesStage } from "@/lib/procurement";
import type { TenderStage } from "@/db/schema";
import { LocalTime } from "@/components/datetime";
import { ErrorNote, PageHead, Pill } from "@/components/ui";
import { submitAdvertBid } from "../actions";

export const metadata = { title: "Advert" };

const ORDER: TenderStage[] = ["provisional", "final", "negotiation", "minutes", "draft_contract", "signed"];

export default async function AdvertPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const ctx = await requireView("bidding");
  const { t, err, money } = await getI18n();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const q = await sp(searchParams);
  const db = await getDb();
  const ad = await advertFor(db, ctx, id);
  if (!ad) notFound();
  const { tender, buyer, bid } = ad;
  const stages = await db.select().from(schema.tenderStages).where(eq(schema.tenderStages.tenderId, id));
  const shown = ORDER.flatMap((s) => stages.filter((x) => x.stage === s && supplierSeesStage(s, bid)));
  const own = tender.companyId === ctx.company.id;
  const open = biddingOpen(tender) && !own && ctx.can("bidding", "write");
  const file = (attachmentId: string | null, label: string) => attachmentId ? <a href={`/api/files/${attachmentId}`} target="_blank" rel="noreferrer">{label}</a> : null;
  return (
    <div className="stack">
      <PageHead title={`${tender.number} · ${tender.title}`}>
        <Link className="btn" href={bid ? "/my-bids" : "/adverts"}>{t("back")}</Link>
        <a className="btn" href={`/api/pdf/tender/${id}`} target="_blank" rel="noreferrer">PDF</a>
        {tender.status === "cancelled"
          ? <Pill kind="cancelled">{t("ts_cancelled")}</Pill>
          : <Pill kind={biddingOpen(tender) ? "published" : "opened"}>{t(biddingOpen(tender) ? "portal_open" : "portal_closed")}</Pill>}
      </PageHead>
      <ErrorNote message={err(q("error"))} />
      {q("sent") ? <div className="note ok small">{t("portal_bid_sent")}</div> : null}
      <div className="grid2">
        <div className="panel stack">
          <div className="fields">
            <div><div className="label">{t("adv_buyer")}</div>{buyer.name}{buyer.country ? <div className="small muted">{buyer.country}</div> : null}</div>
            <div><div className="label">{t("type")}</div>{t(tender.kind === "rfq" ? "tn_rfq" : "tn_tender")}</div>
            <div><div className="label">{t("tn_deadline")}</div><LocalTime value={tender.deadline?.toISOString() ?? null} /></div>
          </div>
          {tender.description ? <div><div className="label">{t("tn_description")}</div><div style={{ whiteSpace: "pre-wrap" }}>{tender.description}</div></div> : null}
          {tender.requirements ? <div><div className="label">{t("tn_requirements")}</div><div style={{ whiteSpace: "pre-wrap" }}>{tender.requirements}</div></div> : null}
          {file(tender.attachmentId, t("tn_document_file"))}
        </div>
        <div className="panel stack">
          <h2>{t("portal_my_bid")}</h2>
          {bid ? (
            <div className="small">
              <div><b>{money(bid.amount, 2)} {buyer.currency}</b></div>
              <div className="muted"><LocalTime value={bid.submittedAt.toISOString()} /></div>
              {bid.note ? <div style={{ whiteSpace: "pre-wrap" }}>{bid.note}</div> : null}
              {file(bid.attachmentId, t("tn_bid_file"))}
            </div>
          ) : null}
          {open ? (
            <form action={submitAdvertBid} className="stack">
              <input type="hidden" name="tenderId" value={id} />
              <label className="f">{t("portal_amount")} ({buyer.currency})<input id="b-amount" name="amount" className="num" inputMode="decimal" required defaultValue={bid?.amount || ""} /></label>
              <label className="f">{t("notes")}<textarea id="b-note" name="note" rows={3} defaultValue={bid?.note} /></label>
              <label className="f">{t("tn_bid_file")}<input id="b-file" name="file" type="file" accept="image/*,application/pdf" /></label>
              <div className="small muted">{t("portal_sealed_note")}</div>
              <div><button type="submit" className="btn primary">{t(bid ? "portal_update_bid" : "portal_send_bid")}</button></div>
            </form>
          ) : !bid ? <div className="small muted">{t(own ? "err_own_tender" : "portal_closed")}</div> : null}
        </div>
      </div>
      {shown.map((st) => (
        <div key={st.id} className="panel stack">
          <div className="row">
            <h2 style={{ flex: 1 }}>{t(`stage_${st.stage as TenderStage}`)}</h2>
            <span className="small muted">{st.date}</span>
            {file(st.attachmentId, t("tn_file"))}
            <a className="btn sm" href={`/api/pdf/tender/${id}?stage=${st.stage}`} target="_blank" rel="noreferrer">PDF</a>
          </div>
          {st.body ? <div style={{ whiteSpace: "pre-wrap" }}>{st.body}</div> : null}
        </div>
      ))}
    </div>
  );
}
