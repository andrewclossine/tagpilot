import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4";
import { UserError } from "./ledger";

const MODEL = "claude-opus-5-5";

const Proposal = z.object({
  doc_type: z.string(),
  date: z.string().nullable(),
  reference: z.string(),
  partner: z.object({
    existing_id: z.string().nullable(),
    name: z.string(),
    tin: z.string(),
    kind: z.enum(["supplier", "customer"]),
  }).nullable(),
  project_code: z.string().nullable(),
  total: z.number(),
  vat: z.number(),
  memo: z.string(),
  lines: z.array(z.object({ account_code: z.string(), debit: z.number(), credit: z.number(), description: z.string() })),
  confidence: z.number(),
  warnings: z.array(z.string()),
});
export type DocProposal = z.infer<typeof Proposal>;

const BankSuggestions = z.object({
  suggestions: z.array(z.object({ id: z.string(), account_code: z.string() })),
});

export type BookContext = {
  companyName: string; tin: string; country: string; currency: string; vatRegistered: boolean; vatRate: number;
  vatIn: string; vatOut: string; policies: string; language: "English" | "French";
  accounts: { code: string; name: string; type: string }[];
  partners: { id: string; name: string; kind: string; tin: string }[];
  projects: { code: string; name: string }[];
  recent: string[];
};

function client() {
  if (!process.env.ANTHROPIC_API_KEY) throw new UserError("err_no_api_key");
  return new Anthropic();
}

function contextText(c: BookContext): string {
  return `COMPANY: ${c.companyName} · country ${c.country || "-"} · tax number ${c.tin || "-"} · currency ${c.currency} · VAT registered: ${c.vatRegistered ? "yes" : "no"} · VAT rate ${c.vatRate}% · input VAT account ${c.vatIn} · output VAT account ${c.vatOut}

COMPANY ACCOUNTING POLICY (follow it; it overrides general practice):
${c.policies || "(none given; use standard IFRS practice)"}

CHART OF ACCOUNTS (use only these codes) - code | name | type:
${c.accounts.map((a) => `${a.code} | ${a.name} | ${a.type}`).join("\n")}

PROJECTS / PROGRAMS - code | name:
${c.projects.map((p) => `${p.code} | ${p.name}`).join("\n") || "(none)"}`;
}

/** Reads one supporting document (image or PDF) and proposes a balanced journal entry. */
export async function readDocument(file: { bytes: Buffer; mimeType: string; fileName: string }, c: BookContext): Promise<DocProposal> {
  const data = file.bytes.toString("base64");
  const doc: Anthropic.Beta.BetaContentBlockParam = file.mimeType === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
    : { type: "image", source: { type: "base64", media_type: file.mimeType as "image/jpeg" | "image/png" | "image/webp" | "image/gif", data } };

  const prompt = `You are a senior accountant working under IFRS and the tax rules of ${c.country || "the company's country"}.
The attached file (${file.fileName}) is one supporting document. Read it carefully and propose ONE balanced journal entry for the books of the company below.

${contextText(c)}

KNOWN SUPPLIERS AND CUSTOMERS - id | name | kind | TIN:
${c.partners.map((p) => `${p.id} | ${p.name} | ${p.kind} | ${p.tin || "-"}`).join("\n") || "(none yet)"}

RECENT APPROVED ENTRIES (follow the company's habits for similar documents):
${c.recent.join("\n") || "(none yet)"}

Rules:
- Total debits must equal total credits. Each line has either a debit or a credit; the other is 0. Amounts are plain numbers in ${c.currency}; if the document is in another currency, convert at the rate shown on it, or say in a warning that a rate is needed.
- If VAT applies and the company is VAT registered, split the VAT to the VAT account.
- partner.existing_id is the id from the list above when the document's supplier or customer is already known, otherwise null.
- date is YYYY-MM-DD, or null if unreadable.
- Write memo, line descriptions and warnings in ${c.language}. The memo follows any memo rule in the policy.
- If a value is hard to read, make your best reading, lower the confidence (0 to 1) and add a warning.
- If the file is not a financial document, return no lines and explain why in warnings. Never invent account codes.`;

  const res = await client().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(Proposal) },
    messages: [{ role: "user", content: [doc, { type: "text", text: prompt }] }],
  });
  if (res.stop_reason === "refusal") throw new UserError("err_ai_refused");
  if (!res.parsed_output) throw new UserError("err_ai_failed");
  return res.parsed_output;
}

/** Suggests the counter-account for unexplained bank statement lines. */
export async function suggestBankAccounts(
  lines: { id: string; date: string; description: string; amount: number }[], c: BookContext,
): Promise<Map<string, string>> {
  const prompt = `You are an accountant. For each bank statement line below, choose the account it should be booked against (the other side of the bank account). Positive amounts are money received, negative amounts are money paid out.

${contextText(c)}

STATEMENT LINES - id | date | description | amount:
${lines.map((l) => `${l.id} | ${l.date} | ${l.description} | ${l.amount}`).join("\n")}

Return one suggestion per line, using only account codes from the chart of accounts. Never suggest the bank account itself.`;
  const res = await client().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: betaZodOutputFormat(BankSuggestions) },
    messages: [{ role: "user", content: prompt }],
  });
  if (res.stop_reason === "refusal") throw new UserError("err_ai_refused");
  return new Map((res.parsed_output?.suggestions ?? []).map((s) => [s.id, s.account_code]));
}

const PayrollRules = z.object({
  components: z.array(z.object({
    code: z.string(), name: z.string(), kind: z.enum(["employee", "employer"]), method: z.enum(["percent", "brackets"]),
    rate: z.number(), brackets: z.string(), base: z.enum(["gross", "remaining"]),
    liability_account: z.string(), expense_account: z.string(),
  })),
  new_accounts: z.array(z.object({ code: z.string(), name: z.string(), type: z.enum(["liability", "expense"]) })),
  notes: z.array(z.string()),
});
export type PayrollRulesProposal = z.infer<typeof PayrollRules>;

/** Drafts the monthly payroll taxes and contributions of a country, mapped to the company's accounts, for a person to review. */
export async function suggestPayrollRules(country: string, currency: string, accounts: { code: string; name: string; type: string }[], language: "English" | "French") {
  const prompt = `You are a payroll specialist. Write the statutory monthly payroll deductions and employer contributions that apply to an ordinary salaried employee in ${country}, as of your latest knowledge. Currency: ${currency}.

Each component is either deducted from the employee's gross pay ("employee") or paid by the employer on top of it ("employer").
- method "percent": rate is the percentage of the base.
- method "brackets": progressive monthly bands written as "upTo:rate%" pairs, e.g. "60000:0, 100000:10, 200000:20, *:30" ("*" means everything above). Convert annual bands to monthly.
- base "gross": gross pay. base "remaining": gross minus the employee components listed before this one (use it only when the law computes the item on net pay). Order the list so that "remaining" items come after what they depend on.
- code: short uppercase id (e.g. PAYE, PENSION_EE). name: the official name, in ${language}.
- liability_account: the account code, from the chart below, that is credited with the amount owed to the authority. expense_account: for employer components, the expense account debited; empty for employee components.
- If the chart has no suitable account, invent a code that is free in the chart, use it, and list it in new_accounts.
- Leave out anything that depends on facts you cannot know (voluntary schemes, allowances, family situation). If thresholds or ceilings apply, approximate and explain in notes.
- notes: what the accountant must check, the year of the rates, and any simplification, in ${language}.

CHART OF ACCOUNTS - code | name | type:
${accounts.map((a) => `${a.code} | ${a.name} | ${a.type}`).join("\n")}`;
  const res = await client().beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "high", format: betaZodOutputFormat(PayrollRules) },
    messages: [{ role: "user", content: prompt }],
  });
  if (res.stop_reason === "refusal") throw new UserError("err_ai_refused");
  if (!res.parsed_output) throw new UserError("err_ai_failed");
  return res.parsed_output;
}
