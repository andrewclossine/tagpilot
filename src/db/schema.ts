import {
  boolean, date, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

// Amounts are stored with two decimals and read back as JS numbers.
const money = (name: string) => numeric(name, { precision: 18, scale: 2, mode: "number" }).notNull().default(0);
const created = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export type Role = "owner" | "accountant" | "viewer";
export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";
/** Accounts with a subtype play a fixed role: money accounts appear in Banking, the rest are picked by documents. */
export type AccountSubtype = "bank" | "cash" | "momo" | "ar" | "ap" | "vat_in" | "vat_out" | "wht" | null;

export type CompanySettings = {
  arAccount: string; apAccount: string; vatIn: string; vatOut: string; whtAccount: string;
  payroll?: PayrollSettings;
};
export type PayrollSettings = {
  brackets: string; pensionEmp: number; pensionEr: number; matEmp: number; matEr: number; ohEr: number; cbhi: number;
  payeTransport: boolean; rssbTransport: boolean;
  accSalary: string; accEmployer: string; accPaye: string; accRssb: string; accNet: string; accAdv: string;
};

// ---------- people & companies ----------
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: created(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(), // sha-256 of the cookie token
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  tin: text("tin").notNull().default(""),
  address: text("address").notNull().default(""),
  currency: text("currency").notNull().default("RWF"),
  vatRegistered: boolean("vat_registered").notNull().default(true),
  vatRate: numeric("vat_rate", { precision: 5, scale: 2, mode: "number" }).notNull().default(18),
  policies: text("policies").notNull().default(""),
  settings: jsonb("settings").$type<CompanySettings>().notNull(),
  createdAt: created(),
});

export const memberships = pgTable("memberships", {
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").$type<Role>().notNull(),
}, (t) => [primaryKey({ columns: [t.companyId, t.userId] })]);

// ---------- master data ----------
export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  nameEn: text("name_en").notNull(),
  nameFr: text("name_fr").notNull().default(""),
  type: text("type").$type<AccountType>().notNull(),
  subtype: text("subtype").$type<AccountSubtype>(),
  isActive: boolean("is_active").notNull().default(true),
}, (t) => [uniqueIndex("accounts_company_code").on(t.companyId, t.code)]);

export const partners = pgTable("partners", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind").$type<"customer" | "supplier" | "both">().notNull(),
  tin: text("tin").notNull().default(""),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),
  address: text("address").notNull().default(""),
  createdAt: created(),
}, (t) => [index("partners_company").on(t.companyId)]);

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  donor: text("donor").notNull().default(""),
  isActive: boolean("is_active").notNull().default(true),
}, (t) => [uniqueIndex("projects_company_code").on(t.companyId, t.code)]);

export const attachments = pgTable("attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  storagePath: text("storage_path").notNull(),
  uploadedBy: uuid("uploaded_by").references(() => users.id),
  createdAt: created(),
});

// ---------- general ledger ----------
export type AiInfo = {
  confidence: number; warnings: string[]; docType: string; total?: number;
  newPartner?: { name: string; tin: string; kind: "customer" | "supplier" } | null;
};

export type EntrySource = "manual" | "ai" | "invoice" | "invoice_payment" | "bill" | "bill_payment" | "payroll" | "bank" | "reversal";

export const journalEntries = pgTable("journal_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  number: integer("number"), // given when posted
  date: date("date", { mode: "string" }).notNull(),
  reference: text("reference").notNull().default(""),
  memo: text("memo").notNull().default(""),
  partnerId: uuid("partner_id").references(() => partners.id),
  projectId: uuid("project_id").references(() => projects.id),
  status: text("status").$type<"draft" | "posted">().notNull(),
  source: text("source").$type<EntrySource>().notNull().default("manual"),
  sourceId: uuid("source_id"),
  attachmentId: uuid("attachment_id").references(() => attachments.id),
  ai: jsonb("ai").$type<AiInfo | null>(),
  reversesId: uuid("reverses_id"),
  reversedById: uuid("reversed_by_id"),
  createdBy: uuid("created_by").references(() => users.id),
  postedBy: uuid("posted_by").references(() => users.id),
  createdAt: created(),
  postedAt: timestamp("posted_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("entries_company_number").on(t.companyId, t.number),
  index("entries_company_date").on(t.companyId, t.date),
]);

export const journalLines = pgTable("journal_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  entryId: uuid("entry_id").notNull().references(() => journalEntries.id, { onDelete: "cascade" }),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  lineNo: integer("line_no").notNull(),
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  debit: money("debit"),
  credit: money("credit"),
  description: text("description").notNull().default(""),
  projectId: uuid("project_id").references(() => projects.id),
  partnerId: uuid("partner_id").references(() => partners.id),
  reconciled: boolean("reconciled").notNull().default(false),
}, (t) => [index("lines_entry").on(t.entryId), index("lines_company_account").on(t.companyId, t.accountId)]);

// ---------- sales & purchases ----------
export type DocStatus = "draft" | "open" | "partial" | "paid" | "void";

const documentColumns = () => ({
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  number: text("number").notNull(),
  partnerId: uuid("partner_id").notNull().references(() => partners.id),
  date: date("date", { mode: "string" }).notNull(),
  dueDate: date("due_date", { mode: "string" }).notNull(),
  status: text("status").$type<DocStatus>().notNull(),
  notes: text("notes").notNull().default(""),
  projectId: uuid("project_id").references(() => projects.id),
  subtotal: money("subtotal"),
  vat: money("vat"),
  total: money("total"),
  amountPaid: money("amount_paid"),
  entryId: uuid("entry_id").references(() => journalEntries.id),
  attachmentId: uuid("attachment_id").references(() => attachments.id),
  createdAt: created(),
});

const docLineColumns = () => ({
  id: uuid("id").primaryKey().defaultRandom(),
  lineNo: integer("line_no").notNull(),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 3, mode: "number" }).notNull().default(1),
  unitPrice: money("unit_price"),
  vatApplies: boolean("vat_applies").notNull().default(true),
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  projectId: uuid("project_id").references(() => projects.id),
  amount: money("amount"), // quantity x unit price, before VAT
});

export const invoices = pgTable("invoices", documentColumns(), (t) => [uniqueIndex("invoices_company_number").on(t.companyId, t.number)]);
export const invoiceLines = pgTable("invoice_lines", {
  ...docLineColumns(),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
});

export const bills = pgTable("bills", {
  ...documentColumns(),
  supplierRef: text("supplier_ref").notNull().default(""),
  whtRate: numeric("wht_rate", { precision: 5, scale: 2, mode: "number" }).notNull().default(0),
}, (t) => [uniqueIndex("bills_company_number").on(t.companyId, t.number)]);
export const billLines = pgTable("bill_lines", {
  ...docLineColumns(),
  billId: uuid("bill_id").notNull().references(() => bills.id, { onDelete: "cascade" }),
});

export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"receipt" | "payment">().notNull(),
  invoiceId: uuid("invoice_id").references(() => invoices.id),
  billId: uuid("bill_id").references(() => bills.id),
  date: date("date", { mode: "string" }).notNull(),
  amount: money("amount"),
  wht: money("wht"),
  moneyAccountId: uuid("money_account_id").notNull().references(() => accounts.id),
  reference: text("reference").notNull().default(""),
  entryId: uuid("entry_id").notNull().references(() => journalEntries.id),
  createdAt: created(),
});

// ---------- banking ----------
export const bankLines = pgTable("bank_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  date: date("date", { mode: "string" }).notNull(),
  description: text("description").notNull(),
  reference: text("reference").notNull().default(""),
  amount: money("amount"), // money in is positive, money out is negative
  status: text("status").$type<"open" | "matched" | "booked" | "ignored">().notNull().default("open"),
  journalLineId: uuid("journal_line_id").references(() => journalLines.id),
  suggestedAccountId: uuid("suggested_account_id").references(() => accounts.id),
  importBatch: text("import_batch").notNull(),
  createdAt: created(),
}, (t) => [index("bank_lines_account").on(t.companyId, t.accountId, t.date)]);

// ---------- budgets ----------
export const budgets = pgTable("budgets", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  projectId: uuid("project_id").references(() => projects.id), // null = whole company
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  amount: money("amount"),
}, (t) => [index("budgets_company_year").on(t.companyId, t.year)]);

// ---------- payroll ----------
export const employees = pgTable("employees", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  rssbNo: text("rssb_no").notNull().default(""),
  nationalId: text("national_id").notNull().default(""),
  position: text("position").notNull().default(""),
  projectId: uuid("project_id").references(() => projects.id),
  basic: money("basic"),
  transport: money("transport"),
  other: money("other"),
  isActive: boolean("is_active").notNull().default(true),
});

export type PayslipRow = {
  employeeId: string; name: string; projectId: string | null;
  basic: number; transport: number; other: number; bonus: number; gross: number;
  paye: number; penE: number; penR: number; matE: number; matR: number; oh: number; cbhi: number;
  deduction: number; net: number; employer: number;
};

export const payrollRuns = pgTable("payroll_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  month: text("month").notNull(), // YYYY-MM
  rows: jsonb("rows").$type<PayslipRow[]>().notNull(),
  settings: jsonb("settings").$type<PayrollSettings>().notNull(),
  entryId: uuid("entry_id").references(() => journalEntries.id),
  createdAt: created(),
}, (t) => [uniqueIndex("payroll_company_month").on(t.companyId, t.month)]);

// ---------- audit trail ----------
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entityId: text("entity_id").notNull(),
  details: jsonb("details").$type<Record<string, unknown>>(),
  at: created(),
}, (t) => [index("audit_company_at").on(t.companyId, t.at)]);
