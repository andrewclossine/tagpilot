import type { Role } from "@/db/schema";

/** Areas of the books a role can see ("read") or change ("write"). */
export type Area =
  | "dashboard" | "journal" | "sales" | "purchases" | "partners" | "banking" | "payroll"
  | "assets" | "budgets" | "reports" | "accounts" | "company" | "users" | "audit";

const ALL: Area[] = ["dashboard", "journal", "sales", "purchases", "partners", "banking", "payroll", "assets", "budgets", "reports", "accounts", "company", "users", "audit"];
const BOOKS: Area[] = ["dashboard", "journal", "sales", "purchases", "partners", "banking", "assets", "budgets", "reports", "accounts", "audit"];

export const ROLES: Role[] = ["admin", "accountant", "sales", "purchases", "payroll", "viewer"];

/** What each role may read and write, in the spirit of QuickBooks user roles. Only admins manage users and the subscription. */
const MATRIX: Record<Role, { read: Area[]; write: Area[] }> = {
  admin: { read: ALL, write: ALL },
  accountant: { read: [...BOOKS, "payroll"], write: ([...BOOKS, "payroll"] as Area[]).filter((a) => a !== "audit") },
  sales: { read: ["dashboard", "sales", "partners"], write: ["sales", "partners"] },
  purchases: { read: ["dashboard", "purchases", "partners", "journal"], write: ["purchases", "partners", "journal"] },
  payroll: { read: ["dashboard", "payroll"], write: ["payroll"] },
  viewer: { read: BOOKS, write: [] },
};

export function can(role: Role, area: Area, mode: "read" | "write" = "read"): boolean {
  const m = MATRIX[role] ?? MATRIX.viewer;
  return mode === "read" ? m.read.includes(area) || m.write.includes(area) : m.write.includes(area);
}
