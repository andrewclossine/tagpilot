import type { Role } from "@/db/schema";

/** Areas of the books a role can see ("read") or change ("write"). */
export type Area =
  | "dashboard" | "journal" | "sales" | "purchases" | "partners" | "banking" | "payroll"
  | "assets" | "inventory" | "budgets" | "reports" | "accounts" | "company" | "users" | "audit"
  | "projects" | "vouchers" | "voucher_approve" | "voucher_pay" | "procurement" | "contracts";

const ALL: Area[] = ["dashboard", "journal", "sales", "purchases", "partners", "banking", "payroll", "assets", "inventory", "budgets", "reports", "accounts", "company", "users", "audit", "projects", "vouchers", "voucher_approve", "voucher_pay", "procurement", "contracts"];
const BOOKS: Area[] = ["dashboard", "journal", "sales", "purchases", "partners", "banking", "assets", "inventory", "budgets", "reports", "accounts", "audit"];

/** Roles the admin can give on the Users page. Supplier accounts are created under Procurement. */
export const ROLES: Role[] = ["admin", "accountant", "sales", "purchases", "payroll", "viewer", "staff", "procurement"];

/** What each role may read and write, in the spirit of QuickBooks user roles. Only admins manage users and the subscription. */
const MATRIX: Record<Role, { read: Area[]; write: Area[] }> = {
  admin: { read: ALL, write: ALL },
  accountant: {
    read: [...BOOKS, "payroll", "projects", "vouchers", "voucher_approve", "voucher_pay", "procurement", "contracts"],
    write: ([...BOOKS, "payroll", "projects", "vouchers", "voucher_approve", "voucher_pay"] as Area[]).filter((a) => a !== "audit"),
  },
  sales: { read: ["dashboard", "sales", "partners", "inventory"], write: ["sales", "partners"] },
  purchases: { read: ["dashboard", "purchases", "partners", "journal", "inventory"], write: ["purchases", "partners", "journal"] },
  payroll: { read: ["dashboard", "payroll"], write: ["payroll"] },
  viewer: { read: [...BOOKS, "projects", "vouchers", "procurement", "contracts"], write: [] },
  staff: { read: ["projects", "vouchers"], write: ["vouchers"] },
  procurement: { read: ["projects", "partners", "procurement", "contracts"], write: ["partners", "procurement", "contracts"] },
  supplier: { read: [], write: [] }, // suppliers only use the supplier portal
};

export function can(role: Role, area: Area, mode: "read" | "write" = "read"): boolean {
  const m = MATRIX[role] ?? MATRIX.viewer;
  return mode === "read" ? m.read.includes(area) || m.write.includes(area) : m.write.includes(area);
}

/** Where a role lands after signing in. */
export function homeOf(role: Role): string {
  if (role === "supplier") return "/portal";
  if (role === "staff") return "/vouchers";
  if (role === "procurement") return "/procurement";
  return "/dashboard";
}
