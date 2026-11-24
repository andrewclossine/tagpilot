import Link from "next/link";
import { requireView, requireFeature } from "@/lib/auth";
import { getI18n, type Key } from "@/lib/i18n";
import { sp, type SearchParams } from "@/lib/actions";
import { batchLists, type BatchKind } from "@/lib/batch";
import { PageHead, Tabs } from "@/components/ui";
import { kindOf } from "@/lib/account-kinds";
import { BatchGrid } from "./BatchGrid";

export const metadata = { title: "Batch enter transactions" };

const AREA = { invoice: "sales", bill: "purchases", bank: "banking" } as const;

/**
 * Many invoices, bills or bank transactions at once, in a grid like a spreadsheet. Rows can be pasted from Excel;
 * nothing is saved until every row is right, then all of them are saved together.
 */
export default async function BatchPage({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireView("journal");

  requireFeature(ctx, "batch");
  const { t, lang, accName } = await getI18n();
  const q = await sp(searchParams);
  const kinds = (["invoice", "bill", "bank"] as const).filter((k) => ctx.can(AREA[k], "write"));
  const kind: BatchKind | undefined = kinds.find((k) => k === q("type")) ?? kinds[0];
  const lists = await batchLists(ctx.company.id);
  const canWrite = ctx.can("journal", "write");
  const accounts = lists.accounts
    .filter((a) => !a.currency && !["ar", "ap"].includes(a.subtype ?? "") && (kind === "invoice" ? ["income", "liability"].includes(a.type) : kind === "bill" ? ["expense", "asset"].includes(a.type) && !["bank", "cash", "momo"].includes(a.subtype ?? "") : true))
    .map((a) => `${a.code} · ${accName(a)} — ${t(`acck_${kindOf(a)}` as Key)}`); // the code leads: batch entry reads only that
  const partners = lists.partners.filter((p) => kind === "bank" || p.kind === "both" || p.kind === (kind === "invoice" ? "customer" : "supplier")).map((p) => p.name);
  return (
    <div className="stack">
      <PageHead title={t("batch_title")}>
        <Link className="btn ghost" href="/journal">{t("back")}</Link>
      </PageHead>
      <div className="small muted">{t("batch_help")}</div>
      {kind && canWrite ? (
        <>
          <Tabs current={kind} items={kinds.map((k) => ({ key: k, href: `/batch?type=${k}`, label: t(`batch_type_${k}`) }))} />
          <BatchGrid key={kind} kind={kind} lang={lang} vat={ctx.company.vatRegistered} currency={ctx.company.currency}
            accounts={accounts} partners={partners} projects={lists.projects.map((p) => p.code)}
            banks={lists.money.map((a) => ({ id: a.id, label: `${a.code} · ${accName(a)}` }))}
            labels={{
              date: t("date"), dueDate: t("due_date"), direction: t("batch_direction"), out: t("batch_out"), in: t("batch_in"),
              partner: t(kind === "invoice" ? "customer" : kind === "bill" ? "supplier" : "batch_payee"),
              reference: t(kind === "bill" ? "batch_supplier_ref" : "reference"), account: t("account"), description: t("description"),
              amount: t("amount"), vatCol: t("batch_vat"), project: t("project"), total: t("total"), rows: t("batch_rows"),
              addRows: t("batch_add_rows"), clear: t("batch_clear"), save: t("batch_save"), saving: t("batch_saving"),
              post: t("batch_post"), postNow: t("batch_post_now"), draft: t("batch_draft"), createPartners: t(kind === "invoice" ? "batch_create_customers" : "batch_create_suppliers"),
              bank: t("batch_bank"), pasteHint: t("batch_paste_hint"), saved: t("batch_saved"), fix: t("batch_fix"), remove: t("delete"),
              errors: Object.fromEntries(["err_batch_empty", "err_batch_too_many", "err_batch_date", "err_batch_due", "err_batch_amount", "err_batch_account",
                "err_batch_customer", "err_batch_supplier", "err_batch_no_customer", "err_batch_no_supplier", "err_batch_project", "err_batch_bank", "err_no_access",
                "err_period_closed", "err_account", "err_use_bills", "err_use_transfer", "err_same_account", "err_fx_account", "err_stock_insufficient", "err_unbalanced",
              ].map((k) => [k, t(k as never)])),
            }} />
        </>
      ) : <div className="note warn">{t("err_no_access")}</div>}
    </div>
  );
}
