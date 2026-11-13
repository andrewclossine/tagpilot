import Link from "next/link";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getCtx } from "@/lib/auth";
import { getI18n } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { parseAmount } from "@/lib/format";
import { Empty, PageHead, Pill } from "@/components/ui";

export const metadata = { title: "Search" };

/**
 * One search over the books: invoices and bills by number, customer or supplier, or amount; customers and suppliers;
 * journal entries by number, reference or memo; and accounts. Each kind shows only to people who may open it.
 */
export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await getCtx();
  const { t, money, accName } = await getI18n();
  const q = (await sp(searchParams))("q").trim().slice(0, 80);
  const db = await getDb();
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const amount = parseAmount(q);
  const isAmount = /^[\d\s.,]+$/.test(q) && amount > 0;
  const num = Number(q.replace(/^#/, ""));
  const cid = ctx.company.id;
  const none = Promise.resolve([] as never[]);
  const [invoices, bills, partners, entries, accounts] = q.length < 2 ? [[], [], [], [], []] : await Promise.all([
    ctx.can("sales") ? db.select({ d: schema.invoices, partner: schema.partners.name }).from(schema.invoices).innerJoin(schema.partners, eq(schema.partners.id, schema.invoices.partnerId))
      .where(and(eq(schema.invoices.companyId, cid), or(ilike(schema.invoices.number, like), ilike(schema.partners.name, like), ilike(schema.invoices.notes, like), ...(isAmount ? [eq(schema.invoices.total, amount)] : []))))
      .orderBy(desc(schema.invoices.date)).limit(20) : none,
    ctx.can("purchases") ? db.select({ d: schema.bills, partner: schema.partners.name }).from(schema.bills).innerJoin(schema.partners, eq(schema.partners.id, schema.bills.partnerId))
      .where(and(eq(schema.bills.companyId, cid), or(ilike(schema.bills.number, like), ilike(schema.partners.name, like), ilike(schema.bills.supplierRef, like), ...(isAmount ? [eq(schema.bills.total, amount)] : []))))
      .orderBy(desc(schema.bills.date)).limit(20) : none,
    ctx.can("partners") || ctx.can("sales") || ctx.can("purchases") ? db.select().from(schema.partners)
      .where(and(eq(schema.partners.companyId, cid), or(ilike(schema.partners.name, like), ilike(schema.partners.tin, like), ilike(schema.partners.email, like), ilike(schema.partners.phone, like))))
      .orderBy(schema.partners.name).limit(20) : none,
    ctx.can("journal") ? db.select().from(schema.journalEntries)
      .where(and(eq(schema.journalEntries.companyId, cid), or(ilike(schema.journalEntries.memo, like), ilike(schema.journalEntries.reference, like), ...(Number.isInteger(num) && num > 0 ? [eq(schema.journalEntries.number, num)] : []))))
      .orderBy(desc(schema.journalEntries.date)).limit(20) : none,
    ctx.can("accounts") || ctx.can("journal") ? db.select().from(schema.accounts)
      .where(and(eq(schema.accounts.companyId, cid), or(ilike(schema.accounts.code, like), ilike(schema.accounts.nameEn, like), ilike(schema.accounts.nameFr, like))))
      .orderBy(schema.accounts.code).limit(20) : none,
  ]);
  const total = invoices.length + bills.length + partners.length + entries.length + accounts.length;
  const st = (s: string) => t(`st_${s as "draft"}`);
  const partnerHref = (p: (typeof partners)[number]) => p.kind === "supplier" ? `/purchases/suppliers?edit=${p.id}#form` : `/sales/customers?edit=${p.id}#form`;
  const section = (title: string, n: number, body: React.ReactNode) => (n ? <div className="panel stack"><h2>{title} <span className="small muted">· {n}</span></h2>{body}</div> : null);
  return (
    <div className="stack">
      <PageHead title={t("qb_search")} />
      <form method="get" className="panel row" role="search" style={{ gap: 8 }}>
        <input name="q" type="search" defaultValue={q} placeholder={t("qb_placeholder")} aria-label={t("qb_search")} autoFocus style={{ flex: 1 }} />
        <button type="submit" className="btn primary">{t("qb_search")}</button>
      </form>
      {q.length >= 2 && !total ? <div className="panel"><Empty>{t("qb_nothing").replace("{q}", q)}</Empty></div> : null}
      {q.length < 2 ? <div className="small muted">{t("qb_help")}</div> : null}
      {section(t("inv_title"), invoices.length, (
        <div className="tbl-wrap"><table><tbody>{invoices.map(({ d, partner }) => (
          <tr key={d.id}><td><Link className="rowlink" href={`/sales/invoices/${d.id}`}><b>{d.number}</b></Link></td><td>{d.date}</td><td>{partner}</td><td className="num">{money(d.total, 2)}</td><td><Pill kind={d.status}>{st(d.status)}</Pill></td></tr>
        ))}</tbody></table></div>
      ))}
      {section(t("bill_title"), bills.length, (
        <div className="tbl-wrap"><table><tbody>{bills.map(({ d, partner }) => (
          <tr key={d.id}><td><Link className="rowlink" href={`/purchases/bills/${d.id}`}><b>{d.number}</b></Link>{d.supplierRef ? <span className="small muted"> · {d.supplierRef}</span> : null}</td><td>{d.date}</td><td>{partner}</td><td className="num">{money(d.total, 2)}</td><td><Pill kind={d.status}>{st(d.status)}</Pill></td></tr>
        ))}</tbody></table></div>
      ))}
      {section(t("qb_people"), partners.length, (
        <div className="tbl-wrap"><table><tbody>{partners.map((p) => (
          <tr key={p.id}><td><Link className="rowlink" href={partnerHref(p)}><b>{p.name}</b></Link></td><td>{t(p.kind)}</td><td>{p.tin}</td><td>{p.phone}</td><td>{p.email}</td></tr>
        ))}</tbody></table></div>
      ))}
      {section(t("nav_journal"), entries.length, (
        <div className="tbl-wrap"><table><tbody>{entries.map((e) => (
          <tr key={e.id}><td><Link className="rowlink" href={`/journal/${e.id}`}>{e.number ? `#${e.number}` : t("st_draft")}</Link></td><td>{e.date}</td><td>{e.reference}</td><td>{e.memo}</td></tr>
        ))}</tbody></table></div>
      ))}
      {section(t("nav_coa"), accounts.length, (
        <div className="tbl-wrap"><table><tbody>{accounts.map((a) => (
          <tr key={a.id}><td><Link className="rowlink" href={`/reports/gl?account=${a.id}`}><code className="k">{a.code}</code></Link></td><td>{accName(a)}</td><td>{t(`t_${a.type}`)}</td></tr>
        ))}</tbody></table></div>
      ))}
    </div>
  );
}

export const dynamic = "force-dynamic";
