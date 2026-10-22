# TAGPILOT

Accounting software for companies and organisations anywhere, with AI that reads supporting documents and proposes the booking.
Interface in English and French. Any home currency. IFRS presentation (IAS 16 for fixed assets).

## How accounts work

- One subscription opens one organisation. The person who signs up is its **administrator** and starts a free 30-day trial.
- The administrator creates every other user (username + first password) and gives each a role: Administrator, Accountant, Sales, Purchases, Payroll or Viewer. Everyone signs in on the same page with their username and lands in their organisation.
- The administrator pays on the **Subscription** page (monthly or yearly, one plan) through Flutterwave: cards and mobile money. A payment counts only after the server verifies it with Flutterwave (on the return page and through the webhook), and it extends the subscription from the end of the current period.
- When the trial or the paid period ends, the books stay readable but nothing can change until the next payment.
- Forgotten password: users with an email address get a one-hour reset link by email (SMTP). Users without one ask their administrator, who can reset it on the Users page.

### Setting up payments and email

1. Flutterwave dashboard > Settings > API keys: put the secret key in `FLW_SECRET_KEY` (test key first, live key in production).
2. Flutterwave dashboard > Settings > Webhooks: URL `<APP_URL>/api/flutterwave/webhook`, choose a secret hash and put the same value in `FLW_SECRET_HASH`.
3. Set the prices: `SUBSCRIPTION_CURRENCY`, `SUBSCRIPTION_PRICE_MONTHLY`, `SUBSCRIPTION_PRICE_YEARLY`.
4. Email: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` from your mail provider. Without SMTP on your computer, reset links are printed in the terminal.

## Modules

| Module | What it does |
|---|---|
| Dashboard | Sales this month and growth, cash & bank, receivables, payables, sales vs expenses by month, cash trend, largest expenses. |
| Scan & book | Upload a photo or PDF of an invoice, receipt or slip. Claude reads it with the organisation's chart of accounts and written accounting policy and creates a **draft** entry for a person to approve. |
| Journal | Manual entries, drafts, numbered posting, reversal (posted entries are never edited), CSV export. |
| Chart of accounts | Accounts grouped by type with balances; add, edit, deactivate. |
| Sales / Purchases | Invoices and bills with VAT, payments, withholding tax on supplier payments, ageing. Invoices download as PDF and are emailed to the customer with the PDF attached. |
| Banking | Paste a bank statement, automatic matching, book the rest (optionally with AI suggestions). |
| Fixed assets | Register, asset classes, straight-line or reducing-balance depreciation run by month, additions, impairment, revaluation (elimination method), disposal with gain/loss, and the IAS 16.73 movement schedule. |
| Payroll | Upload an Excel sheet (Name, Position, Project, Gross, optional Advance) or use the employee list. Taxes and contributions come from the organisation's payroll rules, which the AI can draft for any country and a person must confirm. One draft entry per month, split by project. Payslips as PDF, emailed to each person who has an email address (employee list or an Email column in the sheet). |
| Budgets | Annual budget per account, company-wide or per project; budget vs actual. |
| Reports | Trial balance, income statement, balance sheet, VAT summary, by project, general ledger, customer and supplier ageing. |
| Settings, Users, Audit trail | Organisation profile (type, sector, registration number, address, currency, VAT), projects, accounting policy for the AI, users and roles, who did what and when. |

## Run it on your computer (Windows)

Requirements: [Node.js](https://nodejs.org) 20 or newer.

1. Copy `.env.example` to `.env.local` and put your Claude API key in `ANTHROPIC_API_KEY`. Without a key everything works except the AI features.
2. Double-click `Tangira.bat`, or run `npm install` then `npm run dev`.
3. Open http://localhost:3000 and start a free trial.

Data is kept in `./data` (PGlite, a built-in PostgreSQL) and uploaded documents in `./storage`. Back up both folders.

## Put it online (production)

Set `DATABASE_URL` (PostgreSQL), `ANTHROPIC_API_KEY` and `STORAGE_DIR` (a persistent disk), then `npm ci && npm run build && npm start` behind HTTPS. Tables are created and updated automatically at start.

Before taking paying customers: a test payment with Flutterwave test keys end to end, automated tests, daily backups, monitoring and rate limits on sign-in.

## How the code is organised

```
src/db/schema.ts        database tables (Drizzle ORM, PostgreSQL); migrations in drizzle/
src/lib/roles.ts        what each role may read and change
src/lib/ledger.ts       posting rules: balanced entries, numbering, reversal, balances
src/lib/documents.ts    invoices and bills: totals, posting, payments, withholding tax, void
src/lib/assets.ts       fixed assets: balances, monthly depreciation, impairment, revaluation, disposal
src/lib/payroll.ts      payroll rules engine (percentages and progressive bands)
src/lib/excel.ts        staff sheet reader
src/lib/ai.ts           Claude calls: reading documents, bank suggestions, payroll rules
src/lib/template.ts     starter chart of accounts, asset classes, sectors, currencies
src/lib/i18n-dict.ts    every English and French label
src/app/(app)/...       one folder per module (page + server actions)
```

Every server action checks the user's role; every query is limited to the user's organisation; posted entries are locked.
