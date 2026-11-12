import { sql } from "drizzle-orm";
import {
  boolean, date, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

// Amounts are stored with two decimals and read back as JS numbers.
const money = (name: string) => numeric(name, { precision: 18, scale: 2, mode: "number" }).notNull().default(0);
const created = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export type Role = "admin" | "accountant" | "sales" | "purchases" | "payroll" | "viewer" | "staff" | "procurement" | "supplier" | "project_manager" | "authorizer";
/** The parts of the system an organisation subscribes to. "bidding" is for suppliers: see adverts and bid on them. */
export type ModuleKey = "accounting" | "projects" | "procurement" | "bidding";
export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";
/** Accounts with a subtype play a fixed role: money accounts appear in Banking, the rest are picked by documents. */
export type AccountSubtype = "bank" | "cash" | "momo" | "ar" | "ap" | "vat_in" | "vat_out" | "wht" | null;

export type CompanySettings = {
  arAccount: string; apAccount: string; vatIn: string; vatOut: string; whtAccount: string;
  payroll?: PayrollSettings | LegacyPayrollSettings;
  /** Days between automatic reminders of overdue invoices; 0 or missing means none are sent by themselves. */
  reminderDays?: number;
  /** The books are closed through this date: nothing dated on or before it can be posted. */
  closedThrough?: string;
};

/** One payroll tax or contribution. The company's list of these is its payroll law. */
export type PayrollComponent = {
  code: string; name: string;
  kind: "employee" | "employer";   // deducted from the employee's pay, or paid by the employer on top of it
  method: "percent" | "brackets";
  rate: number;                    // percent, for "percent"
  brackets: string;                // monthly bands "60000:0, 100000:10, *:30", for "brackets"
  base: "gross" | "remaining";     // gross pay, or gross minus the employee deductions listed before this one
  liabilityAccount: string;        // account credited with the amount owed to the authority
  expenseAccount: string;          // employer components: account debited
};
export type PayrollSettings = {
  country: string; components: PayrollComponent[];
  accSalary: string; accNet: string; accAdv: string;
  reviewed: boolean;               // false until someone confirms rules suggested by the AI
};
/** Shape used before payroll rules became configurable; converted on read. */
export type LegacyPayrollSettings = {
  brackets: string; pensionEmp: number; pensionEr: number; matEmp: number; matEr: number; ohEr: number; cbhi: number;
  payeTransport: boolean; rssbTransport: boolean;
  accSalary: string; accEmployer: string; accPaye: string; accRssb: string; accNet: string; accAdv: string;
};

// ---------- people & companies ----------
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: text("username").notNull().unique(),
  email: text("email").unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdBy: uuid("created_by"),
  createdAt: created(),
});

/** The people who run TAGPILOT itself. Separate from every organisation's users, with their own sign-in. */
export const platformAdmins = pgTable("platform_admins", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: created(),
});
export const platformSessions = pgTable("platform_sessions", {
  id: text("id").primaryKey(), // sha-256 of the cookie token
  adminId: uuid("admin_id").notNull().references(() => platformAdmins.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(), // sha-256 of the cookie token
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  registrationNo: text("registration_no").notNull().default(""),
  tin: text("tin").notNull().default(""), // tax number, optional
  orgType: text("org_type").notNull().default("company"), // company, ngo, cooperative, government, sole trader, other
  sector: text("sector").notNull().default(""),
  country: text("country").notNull().default(""),
  city: text("city").notNull().default(""),
  address: text("address").notNull().default(""),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),
  currency: text("currency").notNull().default("USD"),
  plan: text("plan").$type<"trial" | "active" | "expired">().notNull().default("trial"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }).notNull().default(sql`now() + interval '30 days'`),
  paidUntil: timestamp("paid_until", { withTimezone: true }), // end of the last paid subscription period
  suspendedAt: timestamp("suspended_at", { withTimezone: true }), // set by the platform owner: nobody in it can use TAGPILOT
  suspendedReason: text("suspended_reason").notNull().default(""),
  logoAttachmentId: uuid("logo_attachment_id"), // shown on PDFs and in the sidebar
  // What the organisation chose, and what its last payment covers. Organisations from before modules keep everything.
  modules: jsonb("modules").$type<ModuleKey[]>().notNull().default(["accounting", "projects", "procurement"]),
  paidModules: jsonb("paid_modules").$type<ModuleKey[]>().notNull().default(["accounting", "projects", "procurement"]),
  vatRegistered: boolean("vat_registered").notNull().default(true),
  vatRate: numeric("vat_rate", { precision: 5, scale: 2, mode: "number" }).notNull().default(18),
  policies: text("policies").notNull().default(""),
  settings: jsonb("settings").$type<CompanySettings>().notNull(),
  createdAt: created(),
  // Suppliers register themselves through a link with this code, while registration is open.
  supplierRegCode: text("supplier_reg_code"),
  supplierRegOpen: boolean("supplier_reg_open").notNull().default(false),
});

export const memberships = pgTable("memberships", {
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").$type<Role>().notNull(),
  partnerId: uuid("partner_id"), // role "supplier": the supplier this account belongs to
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
  taxLine: text("tax_line"), // income tax working paper line; empty uses the default for the account
  currency: text("currency"), // a money account held in a foreign currency; empty is the company's own currency
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
  address: text("address").notNull().default(""), // the first line of the fiscal address
  address2: text("address2").notNull().default(""),
  address3: text("address3").notNull().default(""),
  website: text("website").notNull().default(""),
  workPhone: text("work_phone").notNull().default(""),
  bankAccount: text("bank_account").notNull().default(""),
  paymentTerms: integer("payment_terms").notNull().default(0), // days to pay; 0 uses 30 days
  creditLimit: money("credit_limit"), // 0 means no limit
  taxCode: text("tax_code").$type<"standard" | "zero" | "exempt">().notNull().default("standard"),
  openingBalance: money("opening_balance"),
  openingDate: date("opening_date", { mode: "string" }),
  openingDocId: uuid("opening_doc_id"), // the invoice or bill that carries the opening balance
  linkedCompanyId: uuid("linked_company_id"), // a supplier organisation on TAGPILOT that bid on an advert
  // For suppliers that registered themselves: under review, approved, rejected or suspended. Empty means added by the
  // organisation itself, which counts as approved.
  supplierStatus: text("supplier_status").$type<SupplierStatus>(),
  statusNote: text("status_note").notNull().default(""),
  createdAt: created(),
}, (t) => [index("partners_company").on(t.companyId), uniqueIndex("partners_linked_company").on(t.companyId, t.linkedCompanyId)]);

export type SupplierStatus = "registered" | "approved" | "rejected" | "suspended";

/** What the organisation buys, used to group and prequalify suppliers: IT equipment, stationery, works... */
export const supplierCategories = pgTable("supplier_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => [index("supplier_categories_company").on(t.companyId)]);

/** A supplier's prequalification in one category. */
export const partnerCategories = pgTable("partner_categories", {
  partnerId: uuid("partner_id").notNull().references(() => partners.id, { onDelete: "cascade" }),
  categoryId: uuid("category_id").notNull().references(() => supplierCategories.id, { onDelete: "cascade" }),
  status: text("status").$type<"pending" | "prequalified" | "rejected">().notNull().default("pending"),
  note: text("note").notNull().default(""),
  validUntil: date("valid_until", { mode: "string" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
}, (t) => [primaryKey({ columns: [t.partnerId, t.categoryId] })]);

export type SupplierDocKind = "rdb" | "rra" | "rssb" | "other";

/** A supplier's legal document: registration certificate, tax clearance, social security clearance... */
export const supplierDocuments = pgTable("supplier_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  partnerId: uuid("partner_id").notNull().references(() => partners.id, { onDelete: "cascade" }),
  kind: text("kind").$type<SupplierDocKind>().notNull(),
  label: text("label").notNull().default(""),
  reference: text("reference").notNull().default(""),
  expiresOn: date("expires_on", { mode: "string" }),
  attachmentId: uuid("attachment_id").notNull().references(() => attachments.id),
  status: text("status").$type<"pending" | "accepted" | "rejected">().notNull().default("pending"),
  note: text("note").notNull().default(""),
  uploadedBy: uuid("uploaded_by").references(() => users.id),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedBy: uuid("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
}, (t) => [index("supplier_documents_partner").on(t.partnerId)]);

/** How a supplier performed on one order, from 1 to 5 on each point. */
export const supplierRatings = pgTable("supplier_ratings", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  partnerId: uuid("partner_id").notNull().references(() => partners.id, { onDelete: "cascade" }),
  orderId: uuid("order_id").references(() => purchaseOrders.id, { onDelete: "cascade" }),
  quality: integer("quality").notNull(),
  delivery: integer("delivery").notNull(),
  service: integer("service").notNull(),
  comment: text("comment").notNull().default(""),
  ratedBy: uuid("rated_by").references(() => users.id),
  createdAt: created(),
}, (t) => [index("supplier_ratings_partner").on(t.partnerId), uniqueIndex("supplier_ratings_order").on(t.orderId)]);

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  donor: text("donor").notNull().default(""),
  kind: text("kind").$type<"project" | "cost_center">().notNull().default("project"),
  description: text("description").notNull().default(""),
  startDate: date("start_date", { mode: "string" }),
  endDate: date("end_date", { mode: "string" }),
  importNotes: jsonb("import_notes").$type<string[]>().notNull().default([]), // what did not add up in the file it was imported from
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

export type EntrySource = "manual" | "ai" | "invoice" | "invoice_payment" | "bill" | "bill_payment" | "payroll" | "bank" | "reversal" | "voucher" | "receipt" | "check" | "deposit" | "transfer" | "fx" | "credit_note" | "expense";

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
  isAdjusting: boolean("is_adjusting").notNull().default(false), // depreciation, accruals and other period-end corrections
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
  reconciliationId: uuid("reconciliation_id"), // the reconciliation that cleared it, so that it can be undone
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
  itemId: uuid("item_id").references(() => items.id), // stock items move inventory when the document is posted
  amount: money("amount"), // quantity x unit price, before VAT
});

export const invoices = pgTable("invoices", {
  ...documentColumns(),
  // A sales receipt is a sale paid on the spot: issued and paid in one step, numbered on its own (SR-0001).
  docType: text("doc_type").$type<"invoice" | "receipt">().notNull().default("invoice"),
  sentAt: timestamp("sent_at", { withTimezone: true }), // last time the PDF was emailed to the customer
  sentTo: text("sent_to").notNull().default(""),
  remindedAt: timestamp("reminded_at", { withTimezone: true }), // last reminder of this overdue invoice
  reminders: integer("reminders").notNull().default(0),
}, (t) => [uniqueIndex("invoices_company_number").on(t.companyId, t.number)]);
export const invoiceLines = pgTable("invoice_lines", {
  ...docLineColumns(),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
});

export const bills = pgTable("bills", {
  ...documentColumns(),
  supplierRef: text("supplier_ref").notNull().default(""),
  whtRate: numeric("wht_rate", { precision: 5, scale: 2, mode: "number" }).notNull().default(0),
  goodsReceiptId: uuid("goods_receipt_id"), // the delivery this bill is for: its stock is already in inventory
  purchaseOrderId: uuid("purchase_order_id"), // the purchase order this bill is for
}, (t) => [uniqueIndex("bills_company_number").on(t.companyId, t.number)]);
export const billLines = pgTable("bill_lines", {
  ...docLineColumns(),
  billId: uuid("bill_id").notNull().references(() => bills.id, { onDelete: "cascade" }),
});

/** An order to a supplier, issued from Procurement for a project or cost center. Nothing is booked until its bill comes. */
export const purchaseOrders = pgTable("purchase_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  number: text("number").notNull(),
  partnerId: uuid("partner_id").notNull().references(() => partners.id),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  date: date("date", { mode: "string" }).notNull(),
  expectedDate: date("expected_date", { mode: "string" }),
  status: text("status").$type<"draft" | "issued" | "closed" | "cancelled">().notNull().default("draft"),
  notes: text("notes").notNull().default(""),
  closeNote: text("close_note").notNull().default(""),
  // Three-way match: a bill may only take what was received and accepted, at no more than the ordered price.
  requireReceipt: boolean("require_receipt").notNull().default(false),
  subtotal: money("subtotal"),
  vat: money("vat"),
  total: money("total"),
  createdBy: uuid("created_by").references(() => users.id),
  issuedBy: uuid("issued_by").references(() => users.id),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  createdAt: created(),
}, (t) => [uniqueIndex("purchase_orders_company_number").on(t.companyId, t.number), index("purchase_orders_project").on(t.projectId)]);
export const purchaseOrderLines = pgTable("purchase_order_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  lineNo: integer("line_no").notNull(),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 3, mode: "number" }).notNull().default(1),
  unitPrice: money("unit_price"),
  vatApplies: boolean("vat_applies").notNull().default(true),
  amount: money("amount"),
}, (t) => [index("po_lines_order").on(t.orderId)]);
/** What a bill took from a line of the order. It stays even if the draft bill's lines are edited; deleting the draft frees it. */
export const purchaseOrderBillings = pgTable("purchase_order_billings", {
  id: uuid("id").primaryKey().defaultRandom(),
  billId: uuid("bill_id").notNull().references(() => bills.id, { onDelete: "cascade" }),
  lineId: uuid("line_id").notNull().references(() => purchaseOrderLines.id, { onDelete: "cascade" }),
  quantity: numeric("quantity", { precision: 18, scale: 3, mode: "number" }).notNull(),
  amount: money("amount"),
}, (t) => [index("po_billings_line").on(t.lineId), index("po_billings_bill").on(t.billId)]);

export type ReceiptChecks = { quantity: boolean; specification: boolean; condition: boolean; documents: boolean };

/**
 * A goods received note against a purchase order: what arrived, what passed inspection and what was rejected.
 * It books nothing; the bill does, and may take no more than what was accepted when the order asks for a match.
 */
export const orderReceipts = pgTable("order_receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  orderId: uuid("order_id").notNull().references(() => purchaseOrders.id, { onDelete: "cascade" }),
  number: text("number").notNull(),
  date: date("date", { mode: "string" }).notNull(),
  deliveryNote: text("delivery_note").notNull().default(""),
  checks: jsonb("checks").$type<ReceiptChecks>().notNull(),
  defects: text("defects").notNull().default(""),
  attachmentId: uuid("attachment_id").references(() => attachments.id),
  status: text("status").$type<"received" | "void">().notNull().default("received"),
  voidNote: text("void_note").notNull().default(""),
  receivedBy: uuid("received_by").references(() => users.id),
  createdAt: created(),
}, (t) => [uniqueIndex("order_receipts_company_number").on(t.companyId, t.number), index("order_receipts_order").on(t.orderId)]);
export const orderReceiptLines = pgTable("order_receipt_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  receiptId: uuid("receipt_id").notNull().references(() => orderReceipts.id, { onDelete: "cascade" }),
  lineId: uuid("line_id").notNull().references(() => purchaseOrderLines.id, { onDelete: "cascade" }),
  received: numeric("received", { precision: 18, scale: 3, mode: "number" }).notNull(),
  accepted: numeric("accepted", { precision: 18, scale: 3, mode: "number" }).notNull(),
  note: text("note").notNull().default(""),
}, (t) => [index("order_receipt_lines_line").on(t.lineId)]);

/** Reminders already sent, so the daily run sends each one once. */
export const noticeLog = pgTable("notice_log", {
  key: text("key").primaryKey(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A quotation to a customer. Nothing is booked until it becomes an invoice. */
export const proformas = pgTable("proformas", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  number: text("number").notNull(),
  partnerId: uuid("partner_id").notNull().references(() => partners.id),
  date: date("date", { mode: "string" }).notNull(),
  validUntil: date("valid_until", { mode: "string" }).notNull(),
  status: text("status").$type<"open" | "converted" | "cancelled">().notNull().default("open"),
  notes: text("notes").notNull().default(""),
  projectId: uuid("project_id").references(() => projects.id),
  subtotal: money("subtotal"),
  vat: money("vat"),
  total: money("total"),
  invoiceId: uuid("invoice_id").references(() => invoices.id),
  createdAt: created(),
}, (t) => [uniqueIndex("proformas_company_number").on(t.companyId, t.number)]);
export const proformaLines = pgTable("proforma_lines", {
  ...docLineColumns(),
  proformaId: uuid("proforma_id").notNull().references(() => proformas.id, { onDelete: "cascade" }),
});

/** Goods that arrived with a supplier's delivery note: in inventory now, owed to the supplier until the bill comes. */
export const goodsReceipts = pgTable("goods_receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  number: text("number").notNull(),
  partnerId: uuid("partner_id").notNull().references(() => partners.id),
  date: date("date", { mode: "string" }).notNull(),
  deliveryNote: text("delivery_note").notNull().default(""),
  notes: text("notes").notNull().default(""),
  value: money("value"),
  status: text("status").$type<"received" | "billed" | "void">().notNull().default("received"),
  entryId: uuid("entry_id").references(() => journalEntries.id),
  billId: uuid("bill_id"),
  attachmentId: uuid("attachment_id").references(() => attachments.id),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: created(),
}, (t) => [uniqueIndex("goods_receipts_company_number").on(t.companyId, t.number)]);
export const goodsReceiptLines = pgTable("goods_receipt_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  receiptId: uuid("receipt_id").notNull().references(() => goodsReceipts.id, { onDelete: "cascade" }),
  lineNo: integer("line_no").notNull(),
  itemId: uuid("item_id").notNull().references(() => items.id),
  quantity: numeric("quantity", { precision: 18, scale: 3, mode: "number" }).notNull(),
  unitCost: numeric("unit_cost", { precision: 18, scale: 4, mode: "number" }).notNull(),
  amount: money("amount"),
});

/**
 * A credit note takes back part or all of an invoice (to a customer) or of a bill (from a supplier): it reverses the
 * income or expense and the VAT, and reduces what is still owed on that document.
 */
export const creditNotes = pgTable("credit_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"invoice" | "bill">().notNull(),
  number: text("number").notNull(),
  invoiceId: uuid("invoice_id").references(() => invoices.id),
  billId: uuid("bill_id").references(() => bills.id),
  partnerId: uuid("partner_id").notNull().references(() => partners.id),
  date: date("date", { mode: "string" }).notNull(),
  reason: text("reason").notNull().default(""),
  supplierRef: text("supplier_ref").notNull().default(""), // the supplier's own credit note number
  subtotal: money("subtotal"),
  vat: money("vat"),
  total: money("total"),
  status: text("status").$type<"posted" | "void">().notNull().default("posted"),
  entryId: uuid("entry_id").references(() => journalEntries.id),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: created(),
}, (t) => [uniqueIndex("credit_notes_company_number").on(t.companyId, t.number), index("credit_notes_invoice").on(t.invoiceId), index("credit_notes_bill").on(t.billId)]);
export const creditNoteLines = pgTable("credit_note_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  creditNoteId: uuid("credit_note_id").notNull().references(() => creditNotes.id, { onDelete: "cascade" }),
  lineNo: integer("line_no").notNull(),
  description: text("description").notNull(),
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  projectId: uuid("project_id").references(() => projects.id),
  vatApplies: boolean("vat_applies").notNull().default(false),
  amount: money("amount"),
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
  suggestedProjectId: uuid("suggested_project_id").references(() => projects.id),
  ruleId: uuid("rule_id"), // the bank rule that suggested or booked it
  importBatch: text("import_batch").notNull(),
  createdAt: created(),
}, (t) => [index("bank_lines_account").on(t.companyId, t.accountId, t.date)]);

/**
 * A bank rule: statement lines whose description contains the text (and fit the direction and amounts) go to this
 * account. With autoBook they are booked as soon as they are imported; otherwise the account is only suggested.
 */
export const bankRules = pgTable("bank_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  contains: text("contains").notNull(),
  direction: text("direction").$type<"any" | "in" | "out">().notNull().default("any"),
  minAmount: money("min_amount"), // 0 means no limit
  maxAmount: money("max_amount"),
  bankAccountId: uuid("bank_account_id").references(() => accounts.id), // only for this money account, or all
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  projectId: uuid("project_id").references(() => projects.id),
  autoBook: boolean("auto_book").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: created(),
}, (t) => [index("bank_rules_company").on(t.companyId)]);

export type RecurringKind = "invoice" | "bill" | "journal";
export type RecurringEvery = "week" | "month" | "quarter" | "year";
export type RecurringPayload = {
  partnerId?: string | null; projectId?: string | null; notes?: string; reference?: string; memo?: string; supplierRef?: string; whtRate?: number; termDays?: number;
  docLines?: { description: string; quantity: number; unitPrice: number; vatApplies: boolean; accountId: string; projectId: string | null; itemId: string | null }[];
  journalLines?: { accountId: string; debit: number; credit: number; description: string; projectId: string | null; partnerId: string | null }[];
};

/** An invoice, bill or journal entry made again on a schedule: rent, subscriptions, monthly accruals... */
export const recurringTemplates = pgTable("recurring_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  kind: text("kind").$type<RecurringKind>().notNull(),
  name: text("name").notNull(),
  every: text("every").$type<RecurringEvery>().notNull(),
  nextDate: date("next_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }),
  autoPost: boolean("auto_post").notNull().default(true), // post it, or leave it as a draft to check
  status: text("status").$type<"active" | "paused" | "ended">().notNull().default("active"),
  payload: jsonb("payload").$type<RecurringPayload>().notNull(),
  made: integer("made").notNull().default(0),
  lastDate: date("last_date", { mode: "string" }),
  lastError: text("last_error").notNull().default(""),
  sourceId: uuid("source_id"), // the document or entry it was made from
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: created(),
}, (t) => [index("recurring_company_next").on(t.companyId, t.nextDate)]);

/** A cheque, deposit, transfer or foreign currency movement. The journal entry is the accounting; this is what the bank page lists. */
export type BankTransactionKind = "check" | "expense" | "deposit" | "transfer" | "fx_in" | "fx_out" | "fx_exchange" | "fx_revaluation";

export const bankTransactions = pgTable("bank_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  kind: text("kind").$type<BankTransactionKind>().notNull(),
  number: text("number").notNull().default(""),
  date: date("date", { mode: "string" }).notNull(),
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  toAccountId: uuid("to_account_id").references(() => accounts.id),
  partnerId: uuid("partner_id").references(() => partners.id),
  payee: text("payee").notNull().default(""),
  memo: text("memo").notNull().default(""),
  amount: money("amount"), // in the company's own currency
  currency: text("currency").notNull().default(""),
  foreignAmount: money("foreign_amount"), // moved on accountId, in its currency: money in is positive
  toForeignAmount: money("to_foreign_amount"), // received on toAccountId, in its currency
  rate: numeric("rate", { precision: 18, scale: 6, mode: "number" }).notNull().default(0),
  entryId: uuid("entry_id").notNull().references(() => journalEntries.id),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: created(),
}, (t) => [
  index("bank_tx_company_kind").on(t.companyId, t.kind, t.date),
  uniqueIndex("bank_tx_check_number").on(t.accountId, t.number).where(sql`${t.kind} = 'check'`),
]);

/** A bank statement agreed with the books. */
export const bankReconciliations = pgTable("bank_reconciliations", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  statementDate: date("statement_date", { mode: "string" }).notNull(),
  openingBalance: money("opening_balance"),
  endingBalance: money("ending_balance"),
  clearedCount: integer("cleared_count").notNull().default(0),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: created(),
}, (t) => [index("bank_rec_account").on(t.companyId, t.accountId, t.statementDate)]);

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
  email: text("email").notNull().default(""), // payslips are sent here
  projectId: uuid("project_id").references(() => projects.id),
  basic: money("basic"),
  transport: money("transport"),
  other: money("other"),
  isActive: boolean("is_active").notNull().default(true),
});

export type PayslipRow = {
  employeeId: string | null; name: string; position: string; projectId: string | null;
  email?: string;                       // where the payslip is sent
  gross: number;
  deductions: Record<string, number>;   // employee components by code
  employer: Record<string, number>;     // employer components by code
  otherDeduction: number;               // advances and other deductions
  net: number; employerTotal: number;
};
/** Payslip shape stored before payroll rules became configurable; converted on read. */
export type LegacyPayslipRow = {
  employeeId: string; name: string; projectId: string | null;
  basic: number; transport: number; other: number; bonus: number; gross: number;
  paye: number; penE: number; penR: number; matE: number; matR: number; oh: number; cbhi: number;
  deduction: number; net: number; employer: number;
};

export const payrollRuns = pgTable("payroll_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  month: text("month").notNull(), // YYYY-MM
  rows: jsonb("rows").$type<(PayslipRow | LegacyPayslipRow)[]>().notNull(),
  settings: jsonb("settings").$type<PayrollSettings | LegacyPayrollSettings>().notNull(),
  source: text("source").notNull().default("employees"), // "employees" or the name of the uploaded Excel file
  entryId: uuid("entry_id").references(() => journalEntries.id),
  createdAt: created(),
}, (t) => [uniqueIndex("payroll_company_month").on(t.companyId, t.month)]);

// ---------- inventory (IAS 2, weighted average cost) ----------
const qty = (name: string) => numeric(name, { precision: 18, scale: 3, mode: "number" }).notNull().default(0);

export const items = pgTable("items", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  unit: text("unit").notNull().default("pcs"),
  kind: text("kind").$type<"stock" | "service">().notNull().default("stock"),
  salePrice: money("sale_price"),
  purchaseCost: money("purchase_cost"),       // default price on bills
  inventoryAccount: text("inventory_account").notNull().default("1300"), // account codes
  incomeAccount: text("income_account").notNull().default("4100"),
  cogsAccount: text("cogs_account").notNull().default("5100"),
  expenseAccount: text("expense_account").notNull().default("6900"),     // services bought
  reorderLevel: qty("reorder_level"),
  qtyOnHand: qty("qty_on_hand"),
  avgCost: numeric("avg_cost", { precision: 18, scale: 4, mode: "number" }).notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: created(),
}, (t) => [uniqueIndex("items_company_sku").on(t.companyId, t.sku)]);

/** Every change in quantity. On-hand quantity and average cost on the item are the running result of these. */
export const stockMoves = pgTable("stock_moves", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  itemId: uuid("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  date: date("date", { mode: "string" }).notNull(),
  kind: text("kind").$type<"opening" | "purchase" | "sale" | "adjustment" | "void">().notNull(),
  quantity: qty("quantity"),                  // in is positive, out is negative
  unitCost: numeric("unit_cost", { precision: 18, scale: 4, mode: "number" }).notNull().default(0),
  value: money("value"),                      // quantity x unit cost, signed
  qtyAfter: qty("qty_after"),
  avgCostAfter: numeric("avg_cost_after", { precision: 18, scale: 4, mode: "number" }).notNull().default(0),
  sourceType: text("source_type").$type<"invoice" | "bill" | "adjustment" | "item" | "receipt">(),
  sourceId: uuid("source_id"),
  entryId: uuid("entry_id").references(() => journalEntries.id),
  notes: text("notes").notNull().default(""),
  createdAt: created(),
}, (t) => [index("stock_moves_item").on(t.itemId, t.date)]);

// ---------- fixed assets (IAS 16) ----------
export type DepMethod = "straight_line" | "reducing_balance";

export const assetCategories = pgTable("asset_categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  method: text("method").$type<DepMethod>().notNull().default("straight_line"),
  usefulLifeMonths: integer("useful_life_months").notNull().default(60),
  rate: numeric("rate", { precision: 6, scale: 2, mode: "number" }).notNull().default(0), // annual %, reducing balance
  assetAccount: text("asset_account").notNull(),      // account codes
  accumDepAccount: text("accum_dep_account").notNull(),
  depExpenseAccount: text("dep_expense_account").notNull(),
});

export const fixedAssets = pgTable("fixed_assets", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  categoryId: uuid("category_id").notNull().references(() => assetCategories.id),
  projectId: uuid("project_id").references(() => projects.id),
  location: text("location").notNull().default(""),
  serialNo: text("serial_no").notNull().default(""),
  acquisitionDate: date("acquisition_date", { mode: "string" }).notNull(),
  availableDate: date("available_date", { mode: "string" }).notNull(), // depreciation starts the month the asset is available for use
  residualValue: money("residual_value"),
  usefulLifeMonths: integer("useful_life_months").notNull(),
  method: text("method").$type<DepMethod>().notNull(),
  rate: numeric("rate", { precision: 6, scale: 2, mode: "number" }).notNull().default(0),
  status: text("status").$type<"active" | "disposed">().notNull().default("active"),
  depreciatedTo: date("depreciated_to", { mode: "string" }), // last day of the last month depreciated
  createdAt: created(),
}, (t) => [uniqueIndex("assets_company_code").on(t.companyId, t.code)]);

/** Every movement of an asset. Cost and accumulated depreciation are the sum of these rows. */
export const assetMovements = pgTable("asset_movements", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  assetId: uuid("asset_id").notNull().references(() => fixedAssets.id, { onDelete: "cascade" }),
  date: date("date", { mode: "string" }).notNull(),
  type: text("type").$type<"acquisition" | "addition" | "depreciation" | "impairment" | "revaluation" | "disposal">().notNull(),
  cost: money("cost"),                 // change in gross carrying amount
  depreciation: money("depreciation"), // change in accumulated depreciation and impairment (positive increases it)
  proceeds: money("proceeds"),         // disposals
  gainLoss: money("gain_loss"),        // disposals and revaluations: positive is a gain or surplus
  entryId: uuid("entry_id").references(() => journalEntries.id),
  notes: text("notes").notNull().default(""),
  createdAt: created(),
}, (t) => [index("asset_movements_asset").on(t.assetId, t.date)]);

// ---------- project management: logical framework and budget execution ----------
export type LogframeLevel = "goal" | "outcome" | "output" | "activity" | "sub_activity";
/** Planned quantity and amount by quarter, keyed "Y1Q1". */
export type BudgetPlan = Record<string, { qty: number; amount: number }>;
/** A milestone of an indicator: what was planned for that period and what was achieved. */
export type Milestone = { label: string; planned: number | null; achieved: number | null };

/** One row of a project's results framework. Activities and sub-activities with no children are its budget lines. */
export const logframeItems = pgTable("logframe_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  parentId: uuid("parent_id"),
  level: text("level").$type<LogframeLevel>().notNull(),
  code: text("code").notNull(),
  title: text("title").notNull(),
  indicator: text("indicator").notNull().default(""),
  target: text("target").notNull().default(""),
  verification: text("verification").notNull().default(""), // means of verification
  assumptions: text("assumptions").notNull().default(""),
  accountId: uuid("account_id").references(() => accounts.id), // account debited when a voucher on this line is paid
  budget: money("budget"),
  sortOrder: integer("sort_order").notNull().default(0),
  // A budget line: what it buys, how many, and when, as on the project's activity-based budget.
  taskCode: text("task_code").notNull().default(""),
  category: text("category").notNull().default(""), // goods, service, works
  unit: text("unit").notNull().default(""),
  quantity: numeric("quantity", { precision: 18, scale: 3, mode: "number" }).notNull().default(0),
  unitCost: numeric("unit_cost", { precision: 18, scale: 4, mode: "number" }).notNull().default(0),
  ownContribution: money("own_contribution"), // the rest of the budget comes from the donor
  plan: jsonb("plan").$type<BudgetPlan>().notNull().default({}),
  // The workplan.
  responsible: text("responsible").notNull().default(""),
  startDate: date("start_date", { mode: "string" }),
  endDate: date("end_date", { mode: "string" }),
  // What was already done or spent before the project came into TAGPILOT.
  baselineQty: numeric("baseline_qty", { precision: 18, scale: 3, mode: "number" }).notNull().default(0),
  baselineSpent: money("baseline_spent"),
  createdAt: created(),
}, (t) => [index("logframe_project").on(t.projectId), index("logframe_parent").on(t.parentId)]);

/** draft, then the four signatures: submitted (prepared), reviewed, approved, authorized; then paid. "rejected" means cancelled. */
export type VoucherStatus = "draft" | "submitted" | "reviewed" | "approved" | "authorized" | "rejected" | "paid";

/** A fund request or payment voucher charged to one budget line. Budget and execution are frozen when it is submitted. */
export const paymentVouchers = pgTable("payment_vouchers", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  number: text("number").notNull(),
  date: date("date", { mode: "string" }).notNull(),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  budgetItemId: uuid("budget_item_id").notNull().references(() => logframeItems.id),
  contractId: uuid("contract_id"),
  partnerId: uuid("partner_id").references(() => partners.id),
  payee: text("payee").notNull().default(""),
  amount: money("amount"),
  description: text("description").notNull(),
  status: text("status").$type<VoucherStatus>().notNull().default("draft"),
  activityBudget: money("activity_budget"),
  previousExecution: money("previous_execution"),
  attachmentId: uuid("attachment_id").references(() => attachments.id),
  requestedBy: uuid("requested_by").notNull().references(() => users.id),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  decidedBy: uuid("decided_by").references(() => users.id),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNote: text("decision_note").notNull().default(""),
  paidBy: uuid("paid_by").references(() => users.id),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  paymentReference: text("payment_reference").notNull().default(""), // for organisations without the accounting module
  entryId: uuid("entry_id").references(() => journalEntries.id),
  createdAt: created(),
}, (t) => [uniqueIndex("vouchers_company_number").on(t.companyId, t.number), index("vouchers_budget_item").on(t.budgetItemId)]);

/** One line of a fund request: a request can draw on several budget lines. Budget and execution are frozen when it is submitted. */
export const voucherLines = pgTable("voucher_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  voucherId: uuid("voucher_id").notNull().references(() => paymentVouchers.id, { onDelete: "cascade" }),
  lineNo: integer("line_no").notNull().default(1),
  budgetItemId: uuid("budget_item_id").notNull().references(() => logframeItems.id),
  description: text("description").notNull().default(""),
  amount: money("amount"),
  activityBudget: money("activity_budget"),
  previousExecution: money("previous_execution"),
}, (t) => [index("voucher_lines_voucher").on(t.voucherId), index("voucher_lines_item").on(t.budgetItemId)]);

export type VoucherStep = "prepared" | "reviewed" | "approved" | "authorized" | "paid" | "returned" | "cancelled";

/** Who signed each step of a fund request, and when. */
export const voucherSteps = pgTable("voucher_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  voucherId: uuid("voucher_id").notNull().references(() => paymentVouchers.id, { onDelete: "cascade" }),
  step: text("step").$type<VoucherStep>().notNull(),
  userId: uuid("user_id").notNull().references(() => users.id),
  note: text("note").notNull().default(""),
  signature: text("signature"), // the picture of the electronic signature, kept with the step it signed
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("voucher_steps_voucher").on(t.voucherId)]);

/** The signature a person chose to keep for next time. A table of its own, so it is not read with every page. */
export const userSignatures = pgTable("user_signatures", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  image: text("image").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DocStatusValue = "submitted" | "pending" | "na";

/** The supporting documents a fund request needs, tracked one by one as on the register. */
export const voucherDocuments = pgTable("voucher_documents", {
  voucherId: uuid("voucher_id").notNull().references(() => paymentVouchers.id, { onDelete: "cascade" }),
  docType: text("doc_type").notNull(),
  status: text("status").$type<DocStatusValue>().notNull().default("na"),
  attachmentId: uuid("attachment_id").references(() => attachments.id),
}, (t) => [primaryKey({ columns: [t.voucherId, t.docType] })]);

/** What was actually done on a budget line. Set against its budget, this is the activity execution. */
/** A progress report for a period: what was achieved on the budget lines, weekly to yearly. */
export const achievementReports = pgTable("achievement_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  schedule: text("schedule").$type<"weekly" | "biweekly" | "monthly" | "quarterly" | "annually">().notNull(),
  periodFrom: date("period_from", { mode: "string" }).notNull(),
  periodTo: date("period_to", { mode: "string" }).notNull(),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: created(),
}, (t) => [index("achievement_reports_project").on(t.projectId, t.periodFrom)]);

export const achievements = pgTable("achievements", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  budgetItemId: uuid("budget_item_id").notNull().references(() => logframeItems.id),
  date: date("date", { mode: "string" }).notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 3, mode: "number" }).notNull(),
  description: text("description").notNull().default(""),
  attachmentId: uuid("attachment_id").references(() => attachments.id),
  enteredBy: uuid("entered_by").references(() => users.id),
  reportId: uuid("report_id").references(() => achievementReports.id, { onDelete: "cascade" }),
  createdAt: created(),
}, (t) => [index("achievements_item").on(t.budgetItemId), index("achievements_project").on(t.projectId)]);

/** An indicator of a result in the logical framework, with its milestones. */
export const indicators = pgTable("indicators", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  itemId: uuid("item_id").notNull().references(() => logframeItems.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull().default(0),
  name: text("name").notNull(),
  baseline: numeric("baseline", { precision: 18, scale: 3, mode: "number" }),
  target: numeric("target", { precision: 18, scale: 3, mode: "number" }),
  source: text("source").notNull().default(""),
  assumptions: text("assumptions").notNull().default(""),
  milestones: jsonb("milestones").$type<Milestone[]>().notNull().default([]),
}, (t) => [index("indicators_item").on(t.itemId)]);

/** Money received for a project, set against what has been requested. */
export const projectFunds = pgTable("project_funds", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  date: date("date", { mode: "string" }).notNull(),
  amount: money("amount"),
  reference: text("reference").notNull().default(""),
  createdAt: created(),
}, (t) => [index("project_funds_project").on(t.projectId)]);

// ---------- procurement ----------
export type TenderKind = "rfq" | "tender";
export type TenderStatus = "draft" | "published" | "opened" | "evaluated" | "provisional" | "final" | "negotiation" | "negotiated" | "draft_contract" | "signed" | "cancelled";
/** Steps recorded after bids close. Each one holds the text and file of that document. */
export type TenderStage = "opening" | "evaluation" | "provisional" | "final" | "negotiation" | "minutes" | "draft_contract" | "signed";

export const tenders = pgTable("tenders", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  number: text("number").notNull(),
  kind: text("kind").$type<TenderKind>().notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  requirements: text("requirements").notNull().default(""),
  projectId: uuid("project_id").references(() => projects.id),
  budgetItemId: uuid("budget_item_id").references(() => logframeItems.id),
  estimate: money("estimate"),
  deadline: timestamp("deadline", { withTimezone: true }),
  openToAll: boolean("open_to_all").notNull().default(false), // every supplier with an account can bid, not only those invited
  technicalWeight: integer("technical_weight").notNull().default(70), // percent; the rest is the financial score
  standstillDays: integer("standstill_days").notNull().default(7), // days between provisional and final notification
  attachmentId: uuid("attachment_id").references(() => attachments.id),
  status: text("status").$type<TenderStatus>().notNull().default("draft"),
  publishedAt: timestamp("published_at", { withTimezone: true }), // the issue date: when it was published to bidders
  // Who approves the award the evaluation recommends, before any notification goes out. Optional.
  awardApproverId: uuid("award_approver_id").references(() => users.id),
  awardApprovedAt: timestamp("award_approved_at", { withTimezone: true }),
  awardNote: text("award_note").notNull().default(""),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: created(),
}, (t) => [uniqueIndex("tenders_company_number").on(t.companyId, t.number)]);

/** A standard form bidders must fill and send back with their bid (bid form, price schedule, declarations...). */
export const tenderForms = pgTable("tender_forms", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  tenderId: uuid("tender_id").notNull().references(() => tenders.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  attachmentId: uuid("attachment_id").notNull().references(() => attachments.id),
  sortOrder: integer("sort_order").notNull().default(0),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: created(),
}, (t) => [index("tender_forms_tender").on(t.tenderId)]);

/** The bill of quantities: what is to be supplied, line by line. Bidders price each line. */
export const tenderItems = pgTable("tender_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  tenderId: uuid("tender_id").notNull().references(() => tenders.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull().default(0),
  description: text("description").notNull(),
  unit: text("unit").notNull().default(""),
  quantity: numeric("quantity", { precision: 18, scale: 3, mode: "number" }).notNull(),
}, (t) => [index("tender_items_tender").on(t.tenderId)]);

/** Who evaluates the bids. Each member declares having no conflict of interest before scoring. */
export const tenderCommittee = pgTable("tender_committee", {
  tenderId: uuid("tender_id").notNull().references(() => tenders.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id),
  isChair: boolean("is_chair").notNull().default(false),
  declaredAt: timestamp("declared_at", { withTimezone: true }),
  submittedAt: timestamp("submitted_at", { withTimezone: true }), // scores sent; they can no longer change
}, (t) => [primaryKey({ columns: [t.tenderId, t.userId] })]);

/** Technical criteria with the points each is worth; together they make the technical score out of 100. */
export const tenderCriteria = pgTable("tender_criteria", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  tenderId: uuid("tender_id").notNull().references(() => tenders.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull().default(0),
  name: text("name").notNull(),
  maxPoints: integer("max_points").notNull(),
}, (t) => [index("tender_criteria_tender").on(t.tenderId)]);

export const tenderInvites = pgTable("tender_invites", {
  tenderId: uuid("tender_id").notNull().references(() => tenders.id, { onDelete: "cascade" }),
  partnerId: uuid("partner_id").notNull().references(() => partners.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.tenderId, t.partnerId] })]);

export const bids = pgTable("bids", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  tenderId: uuid("tender_id").notNull().references(() => tenders.id, { onDelete: "cascade" }),
  partnerId: uuid("partner_id").notNull().references(() => partners.id),
  amount: money("amount"),
  note: text("note").notNull().default(""),
  attachmentId: uuid("attachment_id").references(() => attachments.id),
  submittedBy: uuid("submitted_by").references(() => users.id),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  responsive: boolean("responsive"), // null until evaluated
  technicalScore: numeric("technical_score", { precision: 6, scale: 2, mode: "number" }),
  financialScore: numeric("financial_score", { precision: 6, scale: 2, mode: "number" }),
  totalScore: numeric("total_score", { precision: 6, scale: 2, mode: "number" }),
  rank: integer("rank"),
  evaluationNote: text("evaluation_note").notNull().default(""),
  isWinner: boolean("is_winner").notNull().default(false),
}, (t) => [uniqueIndex("bids_tender_partner").on(t.tenderId, t.partnerId)]);

/** A bidder's unit price for each line of the bill of quantities. Sealed like the bid itself. */
export const bidItems = pgTable("bid_items", {
  bidId: uuid("bid_id").notNull().references(() => bids.id, { onDelete: "cascade" }),
  itemId: uuid("item_id").notNull().references(() => tenderItems.id, { onDelete: "cascade" }),
  unitPrice: money("unit_price"),
}, (t) => [primaryKey({ columns: [t.bidId, t.itemId] })]);

/** One committee member's points for one bid on one criterion. */
export const committeeScores = pgTable("committee_scores", {
  tenderId: uuid("tender_id").notNull().references(() => tenders.id, { onDelete: "cascade" }),
  bidId: uuid("bid_id").notNull().references(() => bids.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id),
  criterionId: uuid("criterion_id").notNull().references(() => tenderCriteria.id, { onDelete: "cascade" }),
  points: numeric("points", { precision: 6, scale: 2, mode: "number" }).notNull(),
  comment: text("comment").notNull().default(""),
}, (t) => [primaryKey({ columns: [t.bidId, t.userId, t.criterionId] })]);

export const tenderStages = pgTable("tender_stages", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  tenderId: uuid("tender_id").notNull().references(() => tenders.id, { onDelete: "cascade" }),
  stage: text("stage").$type<TenderStage>().notNull(),
  date: date("date", { mode: "string" }).notNull(),
  body: text("body").notNull().default(""),
  attachmentId: uuid("attachment_id").references(() => attachments.id),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: created(),
}, (t) => [uniqueIndex("tender_stages_unique").on(t.tenderId, t.stage)]);

// ---------- purchase requisitions ----------
export type RequisitionStatus = "draft" | "submitted" | "approved" | "rejected" | "converted" | "cancelled";

/** A request to buy, raised by anyone, approved level by level, then turned into a request for quotation or tender. */
export const requisitions = pgTable("requisitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  number: text("number").notNull(),
  title: text("title").notNull(),
  justification: text("justification").notNull().default(""),
  department: text("department").notNull().default(""),
  projectId: uuid("project_id").references(() => projects.id),
  budgetItemId: uuid("budget_item_id").references(() => logframeItems.id),
  neededBy: date("needed_by", { mode: "string" }),
  total: money("total"),
  status: text("status").$type<RequisitionStatus>().notNull().default("draft"),
  requestedBy: uuid("requested_by").notNull().references(() => users.id),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  tenderId: uuid("tender_id").references(() => tenders.id), // the request for quotation or tender made from it
  createdAt: created(),
}, (t) => [uniqueIndex("requisitions_company_number").on(t.companyId, t.number), index("requisitions_requested_by").on(t.requestedBy)]);

export const requisitionLines = pgTable("requisition_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  requisitionId: uuid("requisition_id").notNull().references(() => requisitions.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull().default(0),
  description: text("description").notNull(),
  unit: text("unit").notNull().default(""),
  quantity: numeric("quantity", { precision: 18, scale: 3, mode: "number" }).notNull(),
  unitCost: money("unit_cost"),
  amount: money("amount"),
}, (t) => [index("requisition_lines_req").on(t.requisitionId)]);

/** The organisation's approval levels: a level applies when the request reaches its amount, and its approver signs in order. */
export const requisitionLevels = pgTable("requisition_levels", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull().default(0),
  name: text("name").notNull(),
  minAmount: money("min_amount"),
  approverId: uuid("approver_id").notNull().references(() => users.id),
}, (t) => [index("requisition_levels_company").on(t.companyId)]);

export type StepStatus = "waiting" | "pending" | "approved" | "rejected";

/** The approvals one request needs, copied from the levels when it is submitted. */
export const requisitionSteps = pgTable("requisition_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  requisitionId: uuid("requisition_id").notNull().references(() => requisitions.id, { onDelete: "cascade" }),
  sortOrder: integer("sort_order").notNull(),
  name: text("name").notNull(),
  approverId: uuid("approver_id").notNull().references(() => users.id),
  status: text("status").$type<StepStatus>().notNull().default("waiting"),
  note: text("note").notNull().default(""),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
}, (t) => [index("requisition_steps_req").on(t.requisitionId), index("requisition_steps_approver").on(t.approverId)]);

// ---------- contract management ----------
export const contracts = pgTable("contracts", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  number: text("number").notNull(),
  tenderId: uuid("tender_id").references(() => tenders.id),
  partnerId: uuid("partner_id").notNull().references(() => partners.id),
  title: text("title").notNull(),
  scope: text("scope").notNull().default(""),
  projectId: uuid("project_id").references(() => projects.id),
  amount: money("amount"),                                // value when signed; approved amendments change it
  signedDate: date("signed_date", { mode: "string" }).notNull(),
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(), // end when signed; approved amendments change it
  status: text("status").$type<"active" | "completed" | "terminated">().notNull().default("active"),
  attachmentId: uuid("attachment_id").references(() => attachments.id),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: created(),
}, (t) => [uniqueIndex("contracts_company_number").on(t.companyId, t.number)]);

export const performanceGuarantees = pgTable("performance_guarantees", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  contractId: uuid("contract_id").notNull().references(() => contracts.id, { onDelete: "cascade" }),
  kind: text("kind").notNull().default(""),
  issuer: text("issuer").notNull().default(""),
  reference: text("reference").notNull().default(""),
  amount: money("amount"),
  issueDate: date("issue_date", { mode: "string" }).notNull(),
  expiryDate: date("expiry_date", { mode: "string" }).notNull(),
  status: text("status").$type<"active" | "released" | "called">().notNull().default("active"),
  attachmentId: uuid("attachment_id").references(() => attachments.id),
  createdAt: created(),
}, (t) => [index("guarantees_contract").on(t.contractId)]);

export const contractAmendments = pgTable("contract_amendments", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  contractId: uuid("contract_id").notNull().references(() => contracts.id, { onDelete: "cascade" }),
  no: integer("no").notNull(), // 1 to 10
  reason: text("reason").notNull(),
  amountChange: money("amount_change"), // positive or negative
  newEndDate: date("new_end_date", { mode: "string" }),
  status: text("status").$type<"requested" | "approved" | "rejected">().notNull().default("requested"),
  requestedBy: uuid("requested_by").references(() => users.id),
  fromSupplier: boolean("from_supplier").notNull().default(false),
  decidedBy: uuid("decided_by").references(() => users.id),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNote: text("decision_note").notNull().default(""),
  attachmentId: uuid("attachment_id").references(() => attachments.id),
  createdAt: created(),
}, (t) => [index("amendments_contract").on(t.contractId)]);

/** A bill a supplier sends through TAGPILOT against its contract, waiting for the buyer to accept it into the books. */
export const supplierBills = pgTable("supplier_bills", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }), // the buyer
  contractId: uuid("contract_id").notNull().references(() => contracts.id),
  partnerId: uuid("partner_id").notNull().references(() => partners.id),
  reference: text("reference").notNull(), // the supplier's own bill number
  date: date("date", { mode: "string" }).notNull(),
  dueDate: date("due_date", { mode: "string" }).notNull(),
  amount: money("amount"), // before VAT
  description: text("description").notNull(),
  attachmentId: uuid("attachment_id").references(() => attachments.id),
  status: text("status").$type<"received" | "accepted" | "rejected">().notNull().default("received"),
  decisionNote: text("decision_note").notNull().default(""),
  billId: uuid("bill_id"),
  submittedBy: uuid("submitted_by").references(() => users.id),
  createdAt: created(),
}, (t) => [index("supplier_bills_company").on(t.companyId), index("supplier_bills_contract").on(t.contractId)]);

// ---------- subscription & account recovery ----------
export const subscriptionPayments = pgTable("subscription_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  txRef: text("tx_ref").notNull().unique(),
  period: text("period").$type<"monthly" | "yearly">().notNull(),
  modules: jsonb("modules").$type<ModuleKey[]>().notNull().default([]), // what this payment covers
  amount: money("amount"),
  currency: text("currency").notNull(),
  status: text("status").$type<"pending" | "successful" | "failed">().notNull().default("pending"),
  providerTransactionId: text("provider_transaction_id"),
  periodStart: timestamp("period_start", { withTimezone: true }),
  periodEnd: timestamp("period_end", { withTimezone: true }),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: created(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
}, (t) => [index("subscription_payments_company").on(t.companyId)]);

/** Failed sign-ins, by login name and by network address, to slow down password guessing. */
export const loginFailures = pgTable("login_failures", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull(), // "u:<login>" or "ip:<address>"
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("login_failures_key_at").on(t.key, t.at)]);

export const passwordResets = pgTable("password_resets", {
  id: text("id").primaryKey(), // sha-256 of the token sent by email
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: created(),
});

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
