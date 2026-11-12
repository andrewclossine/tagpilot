import type { AppKey } from "@/components/AppIcon";
import type { NavItem, Workspace } from "@/components/NavLinks";
import type { Ctx } from "./auth";
import type { T } from "./i18n";
import type { Area } from "./roles";

/** There are three apps. A supplier's adverts and bids live inside Procurement. */
export const APPS: AppKey[] = ["accounting", "projects", "procurement"];

/** The apps with the links this person may open in each. An app with no links is not theirs. */
export function appWorkspaces(ctx: Ctx, t: T): (Workspace & { key: AppKey })[] {
  const link = (area: Area, href: string, label: string): NavItem[] => (ctx.can(area) ? [{ href, label }] : []);
  const group = (label: string, items: NavItem[]): NavItem[] => (items.length ? [{ group: label }, ...items] : []);
  // A link of its own in the menu bar, not inside the dropdown before it.
  const top = (area: Area, href: string, label: string): NavItem[] => (ctx.can(area) ? [{ href, label, top: true }] : []);
  const scan: NavItem[] = ctx.can("journal", "write") ? [{ href: "/scan", label: t("nav_ai") }] : [];
  const buying: NavItem[] = [
    ...link("procurement", "/procurement", t("nav_tenders")),
    ...link("procurement", "/procurement/dashboard", t("dash_proc_title")),
    ...link("requisitions", "/procurement/requisitions", t("rq_title")),
    ...link("procurement", "/procurement/orders", t("nav_purchase_orders")),
    ...link("procurement", "/procurement/suppliers/registry", t("reg_register_title")),
    ...link("procurement", "/procurement/suppliers", t("nav_supplier_accounts")),
    ...link("contracts", "/contracts", t("nav_contracts")),
    ...(ctx.can("procurement") ? link("partners", "/partners", t("nav_partners")) : []),
  ];
  const bidding: NavItem[] = [
    ...link("bidding", "/adverts", t("nav_adverts")),
    ...link("bidding", "/my-bids", t("nav_my_bids")),
    ...link("bidding", "/my-contracts", t("nav_my_contracts")),
  ];
  const all: (Workspace & { key: AppKey })[] = [
    {
      key: "accounting", label: t("module_accounting"), items: [
        ...top("dashboard", "/dashboard", t("nav_dashboard")),
        ...group(t("nav_sales"), ctx.can("sales") ? [
          ...link("sales", "/sales/invoices", t("nav_invoices")),
          ...link("sales", "/sales/proformas", t("nav_proforma")),
          ...link("sales", "/sales/receipts", t("sr_title")),
          ...link("sales", "/sales/payments", t("nav_receive_payments")),
          ...link("partners", "/sales/customers", t("nav_customers")),
          ...link("sales", "/sales/statements", t("stm_page_title")),
          ...link("sales", "/sales/reminders", t("rem_title")),
          ...link("sales", "/sales/reports", t("nav_customer_reports")),
          ...scan,
        ] : []),
        ...group(t("nav_purchases"), ctx.can("purchases") ? [
          ...(ctx.can("purchases", "write") ? link("purchases", "/purchases/bills/new", t("nav_enter_bill")) : []),
          ...link("purchases", "/purchases/expenses", t("exp_title")),
          ...link("purchases", "/purchases/pay", t("nav_pay_bill")),
          ...link("purchases", "/purchases/receive-items", t("nav_receive_items")),
          ...link("purchases", "/purchases/bill-received", t("nav_bill_received")),
          ...(ctx.has("procurement") ? link("purchases", "/purchases/orders", t("nav_purchase_orders")) : []),
          ...link("purchases", "/purchases/bills", t("nav_bills")),
          ...(ctx.has("procurement") ? link("purchases", "/purchases/received-bills", t("nav_receive_bill")) : []),
          ...link("partners", "/purchases/suppliers", t("nav_suppliers")),
          ...(ctx.has("procurement") ? link("purchases", "/purchases/tenders", t("nav_tender_report")) : []),
          ...link("purchases", "/purchases/reports", t("nav_vendor_reports")),
          ...scan,
        ] : []),
        ...group(t("nav_banking"), ctx.can("banking") ? [
          ...link("banking", "/banking", t("nav_bank_accounts")),
          ...link("banking", "/banking/check", t("nav_write_check")),
          ...link("banking", "/banking/deposit", t("nav_make_deposit")),
          ...link("banking", "/banking/transfer", t("nav_transfer_funds")),
          ...link("banking", "/banking/reconcile", t("nav_reconcile")),
          ...link("banking", "/banking/rules", t("rule_title")),
          ...link("banking", "/banking/foreign", t("nav_foreign")),
        ] : []),
        ...group(t("nav_inventory"), ctx.can("inventory") ? [
          ...link("inventory", "/inventory", t("nav_items")),
        ] : []),
        ...group(t("nav_employees"), [
          ...link("payroll", "/payroll?tab=employees", t("nav_employees")),
          ...link("payroll", "/payroll", t("nav_payroll")),
        ]),
        ...group(t("nav_assets"), [
          ...link("assets", "/assets", t("nav_asset_register")),
          ...link("assets", "/assets/depreciation", t("nav_depreciation")),
          ...link("assets", "/assets/schedule", t("asset_schedule")),
          ...link("assets", "/assets/dispose", t("nav_dispose_asset")),
        ]),
        ...group(t("nav_accountant"), [
          ...link("journal", "/journal", t("nav_journal")),
          ...link("accounts", "/accounts", t("nav_coa")),
          ...link("budgets", "/budgets", t("nav_budgets")),
          ...link("journal", "/recurring", t("rec_title")),
          ...link("reports", "/reports", t("nav_reports")),
        ]),
      ],
    },
    {
      key: "projects", label: t("module_projects"), items: [
        ...link("projects", "/projects", t("nav_projects")),
        ...link("vouchers", "/vouchers", t("nav_vouchers")),
        ...(ctx.can("projects", "write") ? [{ href: "/projects/import", label: t("tm_title") }] : []),
      ],
    },
    {
      key: "procurement", label: t("module_procurement"),
      items: [...buying, ...(buying.length ? group(t("nav_as_supplier"), bidding) : bidding)],
    },
  ];
  return all.filter((w) => w.items.length);
}

/** The first page of an app. */
export const appHome = (w: Workspace) => w.items.flatMap((i) => ("href" in i ? [i.href] : []))[0];
