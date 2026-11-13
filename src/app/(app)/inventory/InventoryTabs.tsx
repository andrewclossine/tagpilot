import type { T } from "@/lib/i18n";
import { Tabs } from "@/components/ui";

/** Items, production runs and the stock valuation sit side by side. */
export function InventoryTabs({ t, current }: { t: T; current: "items" | "production" | "valuation" }) {
  return <Tabs current={current} items={[
    { key: "items", href: "/inventory", label: t("nav_items") },
    { key: "production", href: "/inventory/production", label: t("mo_title") },
    { key: "valuation", href: "/inventory/valuation", label: t("val_title") },
  ]} />;
}

/** Status colours of a production run. */
export const PILL = { draft: "draft", in_progress: "partial", done: "completed", cancelled: "cancelled" } as const;
