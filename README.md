# TAGPILOT

Accounting software for Rwandan companies and NGOs, with AI that reads supporting documents and proposes the booking.
Interface in English and French. Amounts in RWF. IFRS presentation, RRA VAT and withholding tax, RSSB payroll.

## Modules

| Module | What it does |
|---|---|
| Scan & book | Upload a photo or PDF of an invoice, receipt, EBM or slip. Claude reads it with the company's chart of accounts and written accounting policy, and creates a **draft** entry with date, memo, partner, project and debit/credit lines. A person reviews and approves it. |
| Journal | Manual entries, drafts, posting with sequential numbers, reversal of posted entries (posted entries are never edited or deleted), CSV export. |
| Sales | Customer invoices with VAT, issuing (posts AR / income / output VAT), payments received, ageing. |
| Purchases | Supplier bills with VAT and withholding tax, approval (posts expenses / input VAT / AP), payments (withholding tax kept back), ageing. |
| Banking | Bank, cash and MoMo accounts. Paste a statement (CSV or from Excel), match lines to the books automatically, book the rest (optionally with AI suggestions), reconcile. |
| Payroll | Employees, monthly payroll with PAYE, RSSB pension, maternity, occupational hazards and CBHI; one draft entry split by project; payslips. All rates are editable. |
| Budgets | Annual budget per account, for the whole company or per project/program; budget vs actual. |
| Reports | Trial balance, income statement, balance sheet, VAT summary, by project, general ledger, customer and supplier ageing. |
| Settings | Several companies per user, chart of accounts, projects, accounting policy for the AI, users with roles (owner, accountant, viewer). |
| Audit trail | Who did what and when. |

## Run it on your computer (Windows)

Requirements: [Node.js](https://nodejs.org) 20 or newer.

1. Copy `.env.example` to `.env.local` and put your Claude API key in `ANTHROPIC_API_KEY` (from https://console.anthropic.com). Without a key everything works except AI reading.
2. Double-click `Tangira.bat`, or run:

```bash
npm install
npm run dev
```

3. Open http://localhost:3000, create an account, then your company.

On your computer the data is kept in `./data` (a built-in PostgreSQL called PGlite) and uploaded documents in `./storage`. Back up both folders.

## Put it online (production)

1. A Linux server or a platform that runs Node.js (for example a VPS, Railway, Render, Fly.io), and a PostgreSQL database.
2. Set the environment variables: `DATABASE_URL` (PostgreSQL), `ANTHROPIC_API_KEY`, `STORAGE_DIR` (a persistent disk for documents).
3. `npm ci && npm run build && npm start`. Database tables are created and updated automatically at start.
4. Serve it over HTTPS only (session cookies are marked secure in production).

Before taking paying customers: automated tests, daily database backups, monitoring, rate limits on sign-in, password reset by email, and a review of the payroll and tax rates by a Rwandan tax adviser.

## How the code is organised

```
src/db/schema.ts        all database tables (Drizzle ORM, PostgreSQL)
src/db/index.ts         connection: PostgreSQL when DATABASE_URL is set, PGlite otherwise
src/lib/ledger.ts       posting rules: balanced entries, numbering, reversal, balances
src/lib/documents.ts    invoices and bills: totals, posting, payments, withholding tax, void
src/lib/payroll.ts      PAYE brackets and payslip calculation
src/lib/ai.ts           Claude calls: reading a document, suggesting bank accounts
src/lib/statement.ts    bank statement parser (CSV / pasted from Excel)
src/lib/template.ts     Rwanda starter chart of accounts, default payroll rates, example policy
src/lib/i18n-dict.ts    every English and French label
src/app/(app)/...       one folder per module (page + server actions)
drizzle/                database migrations (generate new ones with `npm run db:generate`)
```

Rules the code keeps everywhere: every server action checks the user's role for the current company; every query is limited to the current company; posted entries are locked.

## Not done yet

EBM / RRA integration, inventory, fixed assets register and depreciation runs, PDF invoices and email sending, MoMo API, multiple currencies, closing the financial year, PAYE and RSSB declaration files, automated tests.
