import type { AccountSubtype, AccountType, CompanySettings, PayrollSettings } from "@/db/schema";

/** Starter chart of accounts for a Rwandan company (IFRS presentation). Companies can edit it freely. */
export const RWANDA_ACCOUNTS: { code: string; type: AccountType; subtype?: AccountSubtype; en: string; fr: string }[] = [
  { code: "1100", type: "asset", subtype: "cash", en: "Cash on hand", fr: "Caisse" },
  { code: "1110", type: "asset", subtype: "bank", en: "Bank account", fr: "Banque" },
  { code: "1120", type: "asset", subtype: "momo", en: "Mobile money (MoMo)", fr: "Mobile money (MoMo)" },
  { code: "1200", type: "asset", subtype: "ar", en: "Accounts receivable", fr: "Clients" },
  { code: "1300", type: "asset", en: "Inventory", fr: "Stocks" },
  { code: "1450", type: "asset", subtype: "vat_in", en: "VAT recoverable (input VAT)", fr: "TVA déductible" },
  { code: "1500", type: "asset", en: "Prepayments", fr: "Charges constatées d'avance" },
  { code: "1510", type: "asset", en: "Staff advances", fr: "Avances au personnel" },
  { code: "1600", type: "asset", en: "Property, plant & equipment", fr: "Immobilisations corporelles" },
  { code: "1690", type: "asset", en: "Accumulated depreciation", fr: "Amortissements cumulés" },
  { code: "2100", type: "liability", subtype: "ap", en: "Accounts payable", fr: "Fournisseurs" },
  { code: "2200", type: "liability", subtype: "vat_out", en: "VAT payable (output VAT)", fr: "TVA collectée" },
  { code: "2300", type: "liability", en: "PAYE payable", fr: "IPR à payer" },
  { code: "2310", type: "liability", en: "RSSB contributions payable", fr: "Cotisations RSSB à payer" },
  { code: "2320", type: "liability", subtype: "wht", en: "Withholding tax payable", fr: "Retenue à la source à payer" },
  { code: "2330", type: "liability", en: "Net salaries payable", fr: "Salaires nets à payer" },
  { code: "2400", type: "liability", en: "Accrued expenses", fr: "Charges à payer" },
  { code: "2500", type: "liability", en: "Loans", fr: "Emprunts" },
  { code: "2600", type: "liability", en: "Deferred grant income", fr: "Subventions reçues d'avance" },
  { code: "3100", type: "equity", en: "Share capital", fr: "Capital social" },
  { code: "3200", type: "equity", en: "Retained earnings", fr: "Résultats reportés" },
  { code: "4100", type: "income", en: "Sales of goods", fr: "Ventes de marchandises" },
  { code: "4200", type: "income", en: "Service revenue", fr: "Prestations de services" },
  { code: "4300", type: "income", en: "Grants & donations", fr: "Subventions et dons" },
  { code: "4900", type: "income", en: "Other income", fr: "Autres produits" },
  { code: "5100", type: "expense", en: "Cost of goods sold", fr: "Coût des marchandises vendues" },
  { code: "6100", type: "expense", en: "Salaries & wages", fr: "Salaires et traitements" },
  { code: "6101", type: "expense", en: "Employer social contributions", fr: "Charges sociales patronales" },
  { code: "6105", type: "expense", en: "Transport & fuel", fr: "Transport et carburant" },
  { code: "6110", type: "expense", en: "Rent", fr: "Loyer" },
  { code: "6120", type: "expense", en: "Electricity & water", fr: "Eau et électricité" },
  { code: "6130", type: "expense", en: "Communication & internet", fr: "Communication et internet" },
  { code: "6140", type: "expense", en: "Office supplies", fr: "Fournitures de bureau" },
  { code: "6150", type: "expense", en: "Repairs & maintenance", fr: "Entretien et réparations" },
  { code: "6160", type: "expense", en: "Professional fees", fr: "Honoraires" },
  { code: "6170", type: "expense", en: "Bank charges", fr: "Frais bancaires" },
  { code: "6180", type: "expense", en: "Travel & accommodation", fr: "Déplacements et hébergement" },
  { code: "6190", type: "expense", en: "Training & workshops", fr: "Formations et ateliers" },
  { code: "6200", type: "expense", en: "Depreciation", fr: "Dotations aux amortissements" },
  { code: "6900", type: "expense", en: "Other expenses", fr: "Autres charges" },
];

export const DEFAULT_SETTINGS: CompanySettings = {
  arAccount: "1200", apAccount: "2100", vatIn: "1450", vatOut: "2200", whtAccount: "2320",
};

/** Rwanda payroll defaults. They must be checked against current RRA and RSSB rules; every value is editable. */
export const PAYROLL_DEFAULTS: PayrollSettings = {
  brackets: "60000:0, 100000:10, 200000:20, *:30",
  pensionEmp: 6, pensionEr: 6, matEmp: 0.3, matEr: 0.3, ohEr: 2, cbhi: 0.5,
  payeTransport: true, rssbTransport: false,
  accSalary: "6100", accEmployer: "6101", accPaye: "2300", accRssb: "2310", accNet: "2330", accAdv: "1510",
};

export const DEFAULT_POLICIES = `1. EBM invoice prices include VAT at 18% unless the invoice says otherwise. When the supplier is VAT registered (TIN + EBM), split the VAT to the input VAT account (1450).
2. Fuel, vehicle repairs and taxi costs go to 6105 Transport & fuel.
3. Any item costing 500,000 RWF or more that lasts more than one year is an asset: book it to 1600, not to an expense.
4. Unpaid supplier invoices: credit 2100 Accounts payable. Paid in cash: credit 1100. Paid by MoMo: credit 1120. Paid by bank transfer: credit 1110.
5. Fees paid to individuals who are not VAT registered: withhold 15% and credit it to 2320 Withholding tax payable.
6. Costs of a donor-funded activity must carry that program's project code. Office running costs use the general project.
7. Memo format: <what was bought or sold> - <supplier or customer> - <invoice number>.`;
