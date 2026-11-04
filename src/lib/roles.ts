import type { ModuleKey, Role } from "@/db/schema";

/** Areas of the books a role can see ("read") or change ("write"). */
export type Area =
  | "dashboard" | "journal" | "sales" | "purchases" | "partners" | "banking" | "payroll"
  | "assets" | "inventory" | "budgets" | "reports" | "accounts" | "company" | "users" | "audit"
  | "projects" | "vouchers" | "voucher_approve" | "voucher_pay" | "procurement" | "contracts" | "bidding";

const ALL: Area[] = ["dashboard", "journal", "sales", "purchases", "partners", "banking", "payroll", "assets", "inventory", "budgets", "reports", "accounts", "company", "users", "audit", "projects", "vouchers", "voucher_approve", "voucher_pay", "procurement", "contracts", "bidding"];
const BOOKS: Area[] = ["dashboard", "journal", "sales", "purchases", "partners", "banking", "assets", "inventory", "budgets", "reports", "accounts", "audit"];

export const MODULES: ModuleKey[] = ["accounting", "projects", "procurement", "bidding"];

/** Which module an area belongs to. Company settings, users and the audit trail come with any module. */
const AREA_MODULES: Partial<Record<Area, ModuleKey[]>> = {
  dashboard: ["accounting"], journal: ["accounting"], sales: ["accounting"], purchases: ["accounting"], banking: ["accounting"], payroll: ["accounting"],
  assets: ["accounting"], inventory: ["accounting"], budgets: ["accounting"], reports: ["accounting"], accounts: ["accounting"],
  partners: ["accounting", "procurement"],
  projects: ["projects"], vouchers: ["projects"], voucher_approve: ["projects"], voucher_pay: ["projects"],
  procurement: ["procurement"], contracts: ["procurement"],
  bidding: ["bidding"],
};

export function areaInModules(area: Area, modules: ModuleKey[]): boolean {
  const needs = AREA_MODULES[area];
  return !needs || needs.some((m) => modules.includes(m));
}

/** Every role there is, except supplier accounts, which are created under Procurement. */
export const ROLES: Role[] = ["admin", "accountant", "sales", "purchases", "payroll", "viewer", "staff", "procurement"];

const ROLE_MODULES: Partial<Record<Role, ModuleKey[]>> = {
  accountant: ["accounting", "projects"], sales: ["accounting"], purchases: ["accounting"], payroll: ["accounting"],
  staff: ["projects"], procurement: ["procurement", "bidding"],
};

/** The roles that make sense for what the organisation subscribes to. */
export const rolesFor = (modules: ModuleKey[]) => ROLES.filter((r) => { const m = ROLE_MODULES[r]; return !m || m.some((x) => modules.includes(x)); });

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
  viewer: { read: [...BOOKS, "projects", "vouchers", "procurement", "contracts", "bidding"], write: [] },
  staff: { read: ["projects", "vouchers"], write: ["vouchers"] },
  procurement: { read: ["projects", "partners", "procurement", "contracts", "bidding"], write: ["partners", "procurement", "contracts", "bidding"] },
  supplier: { read: [], write: [] }, // suppliers invited by one organisation only use its supplier portal
};

export function can(role: Role, area: Area, mode: "read" | "write" = "read"): boolean {
  const m = MATRIX[role] ?? MATRIX.viewer;
  return mode === "read" ? m.read.includes(area) || m.write.includes(area) : m.write.includes(area);
}

const PAGE_OF: [Area, string][] = [["dashboard", "/dashboard"], ["projects", "/projects"], ["vouchers", "/vouchers"], ["procurement", "/procurement"], ["bidding", "/adverts"], ["company", "/settings"]];

/** Where someone lands after signing in: the first page their role can open in what the organisation subscribes to. */
export function homeOf(role: Role, modules: ModuleKey[]): string {
  if (role === "supplier") return "/portal";
  const first: Area[] = role === "staff" ? ["vouchers"] : role === "procurement" ? ["procurement", "bidding"] : [];
  const order = [...first.map((a) => PAGE_OF.find(([x]) => x === a)!), ...PAGE_OF];
  return order.find(([a]) => can(role, a) && areaInModules(a, modules))?.[1] ?? "/no-access";
}
