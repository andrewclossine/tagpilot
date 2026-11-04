import Link from "next/link";
import { getDb } from "@/db";
import { requireView } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { openAdverts } from "@/lib/bidding";
import { LocalTime } from "@/components/datetime";
import { Empty, PageHead } from "@/components/ui";

export const metadata = { title: "Adverts" };

export default async function AdvertsPage() {
  const ctx = await requireView("bidding");
  const { t } = await getI18n();
  const db = await getDb();
  const rows = (await openAdverts(db)).filter((r) => r.t.companyId !== ctx.company.id);
  return (
    <div className="stack">
      <PageHead title={t("adv_title")} />
      <p className="muted" style={{ margin: 0, maxWidth: "70ch" }}>{t("adv_sub")}</p>
      <div className="panel">
        {rows.length ? (
          <div className="tbl-wrap"><table>
            <thead><tr><th>{t("number")}</th><th>{t("type")}</th><th>{t("tn_subject")}</th><th>{t("adv_buyer")}</th><th>{t("tn_deadline")}</th></tr></thead>
            <tbody>{rows.map(({ t: x, buyer, country }) => (
              <tr key={x.id}>
                <td><Link className="rowlink" href={`/adverts/${x.id}`}><code className="k">{x.number}</code></Link></td>
                <td>{t(x.kind === "rfq" ? "tn_rfq" : "tn_tender")}</td>
                <td><Link className="rowlink" href={`/adverts/${x.id}`}>{x.title}</Link></td>
                <td>{buyer}{country ? <div className="small muted">{country}</div> : null}</td>
                <td><LocalTime value={x.deadline?.toISOString() ?? null} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>{t("adv_none")}</Empty>}
      </div>
    </div>
  );
}
