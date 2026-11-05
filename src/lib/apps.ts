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
          ...link("sales", "/sales/payments", t("nav_receive_payments")),
          ...link("partners", "/sales/customers", t("nav_customers")),
          ...scan,
        ] : []),
        ...group(t("nav_purchases"), ctx.can("purchases") ? [
          ...link("purchases", "/purchases/bills", t("nav_bills")),
          ...(ctx.has("procurement") ? link("purchases", "/purchases/received-bills", t("nav_receive_bill")) : []),
          ...link("purchases", "/purchases/receive-items", t("nav_receive_items")),
          ...link("partners", "/purchases/suppliers", t("nav_suppliers")),
          ...(ctx.has("procurement") ? link("purchases", "/purchases/tenders", t("nav_tender_report")) : []),
          ...scan,
        ] : []),
        ...top("banking", "/banking", t("nav_banking")),
        ...group(t("nav_inventory"), ctx.can("inventory") ? [
          ...link("inventory", "/inventory", t("nav_items")),
          ...link("assets", "/assets/depreciation", t("nav_depreciation")),
          ...link("assets", "/assets/dispose", t("nav_dispose_asset")),
        ] : []),
        ...group(t("nav_assets"), [
          ...link("assets", "/assets", t("nav_asset_register")),
          ...link("assets", "/assets/depreciation", t("nav_depreciation")),
          ...link("assets", "/assets/schedule", t("asset_schedule")),
          ...link("assets", "/assets/dispose", t("nav_dispose_asset")),
        ]),
        ...group(t("nav_employees"), [
          ...link("payroll", "/payroll?tab=employees", t("nav_employees")),
          ...link("payroll", "/payroll", t("nav_payroll")),
        ]),
        ...group(t("nav_accountant"), [
          ...link("journal", "/journal", t("nav_journal")),
          ...link("accounts", "/accounts", t("nav_coa")),
          ...link("budgets", "/budgets", t("nav_budgets")),
          ...link("reports", "/reports", t("nav_reports")),
        ]),
      ],
    },
    {
      key: "projects", label: t("module_projects"), items: [
        ...link("projects", "/projects", t("nav_projects")),
        ...link("vouchers", "/vouchers", t("nav_vouchers")),
        ...(ctx.can("projects", "write") ? [{ href: "/projects/import", label: t("im_title") }] : []),
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
