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
  // Customers and suppliers belong to accounting for anyone who works in the books; procurement has its own way in.
  const booksRole = ctx.can("sales") || ctx.can("purchases") || ctx.can("journal");
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
        ...link("dashboard", "/dashboard", t("nav_dashboard")),
        ...group(t("nav_sales"), [...link("sales", "/sales/invoices", t("nav_invoices")), ...(booksRole ? link("partners", "/partners", t("nav_partners")) : [])]),
        ...group(t("nav_purchases"), link("purchases", "/purchases/bills", t("nav_bills"))),
        ...group(t("nav_accounting"), [
          ...(ctx.can("journal", "write") ? [{ href: "/scan", label: t("nav_ai") }] : []),
          ...link("journal", "/journal", t("nav_journal")),
          ...link("accounts", "/accounts", t("nav_coa")),
          ...link("banking", "/banking", t("nav_banking")),
          ...link("inventory", "/inventory", t("nav_inventory")),
          ...link("assets", "/assets", t("nav_assets")),
          ...link("payroll", "/payroll", t("nav_payroll")),
          ...link("budgets", "/budgets", t("nav_budgets")),
          ...link("reports", "/reports", t("nav_reports")),
        ]),
      ],
    },
    {
      key: "projects", label: t("module_projects"), items: [
        ...link("projects", "/projects", t("nav_projects")),
        ...link("vouchers", "/vouchers", t("nav_vouchers")),
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
