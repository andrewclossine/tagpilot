import type { AccountSubtype, AccountType, CompanySettings, PayrollComponent, PayrollSettings } from "@/db/schema";

/** Starter chart of accounts (IFRS presentation) for any company. Companies can edit it freely. */
type StarterAccount = { code: string; type: AccountType; subtype?: AccountSubtype; en: string; fr: string };

export const STARTER_ACCOUNTS: StarterAccount[] = [
  { code: "1100", type: "asset", subtype: "cash", en: "Cash on hand", fr: "Caisse" },
  { code: "1110", type: "asset", subtype: "bank", en: "Bank account", fr: "Banque" },
  { code: "1200", type: "asset", subtype: "ar", en: "Accounts receivable", fr: "Clients" },
  { code: "1300", type: "asset", en: "Inventory", fr: "Stocks" },
  { code: "1450", type: "asset", subtype: "vat_in", en: "VAT recoverable (input VAT)", fr: "TVA déductible" },
  { code: "1500", type: "asset", en: "Prepayments", fr: "Charges constatées d'avance" },
  { code: "1510", type: "asset", en: "Staff advances", fr: "Avances au personnel" },
  ...FIXED_ASSET_ACCOUNTS(),
  { code: "2100", type: "liability", subtype: "ap", en: "Accounts payable", fr: "Fournisseurs" },
  { code: "2200", type: "liability", subtype: "vat_out", en: "VAT payable (output VAT)", fr: "TVA collectée" },
  { code: "2300", type: "liability", en: "Income tax on salaries payable", fr: "Impôt sur salaires à payer" },
  { code: "2310", type: "liability", en: "Social security contributions payable", fr: "Cotisations sociales à payer" },
  { code: "2320", type: "liability", subtype: "wht", en: "Withholding tax payable", fr: "Retenue à la source à payer" },
  { code: "2330", type: "liability", en: "Net salaries payable", fr: "Salaires nets à payer" },
  { code: "2400", type: "liability", en: "Accrued expenses", fr: "Charges à payer" },
  { code: "2500", type: "liability", en: "Loans", fr: "Emprunts" },
  { code: "2600", type: "liability", en: "Deferred grant income", fr: "Subventions reçues d'avance" },
  { code: "3100", type: "equity", en: "Share capital", fr: "Capital social" },
  { code: "3200", type: "equity", en: "Retained earnings", fr: "Résultats reportés" },
  { code: "3300", type: "equity", en: "Revaluation surplus", fr: "Écart de réévaluation" },
  { code: "4100", type: "income", en: "Sales of goods", fr: "Ventes de marchandises" },
  { code: "4200", type: "income", en: "Service revenue", fr: "Prestations de services" },
  { code: "4300", type: "income", en: "Grants & donations", fr: "Subventions et dons" },
  { code: "4800", type: "income", en: "Gain on disposal of assets", fr: "Plus-values de cession d'actifs" },
  { code: "4900", type: "income", en: "Other income", fr: "Autres produits" },
  { code: "5100", type: "expense", en: "Cost of goods sold", fr: "Coût des marchandises vendues" },
  { code: "5150", type: "expense", en: "Stock adjustments & losses", fr: "Ajustements et pertes de stock" },
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
  { code: "6210", type: "expense", en: "Impairment losses", fr: "Pertes de valeur" },
  { code: "6800", type: "expense", en: "Loss on disposal of assets", fr: "Moins-values de cession d'actifs" },
  { code: "6900", type: "expense", en: "Other expenses", fr: "Autres charges" },
];

/** Property, plant and equipment accounts, cost and accumulated depreciation side by side (IAS 16). */
function FIXED_ASSET_ACCOUNTS(): StarterAccount[] {
  return [
    { code: "1610", type: "asset", en: "Land & buildings", fr: "Terrains et constructions" },
    { code: "1620", type: "asset", en: "Motor vehicles", fr: "Matériel de transport" },
    { code: "1630", type: "asset", en: "Computers & IT equipment", fr: "Matériel informatique" },
    { code: "1640", type: "asset", en: "Furniture & fittings", fr: "Mobilier et agencements" },
    { code: "1650", type: "asset", en: "Machinery & equipment", fr: "Machines et équipements" },
    { code: "1691", type: "asset", en: "Accumulated depreciation - buildings", fr: "Amortissements cumulés - constructions" },
    { code: "1692", type: "asset", en: "Accumulated depreciation - vehicles", fr: "Amortissements cumulés - matériel de transport" },
    { code: "1693", type: "asset", en: "Accumulated depreciation - IT equipment", fr: "Amortissements cumulés - matériel informatique" },
    { code: "1694", type: "asset", en: "Accumulated depreciation - furniture", fr: "Amortissements cumulés - mobilier" },
    { code: "1695", type: "asset", en: "Accumulated depreciation - machinery", fr: "Amortissements cumulés - machines" },
  ];
}

/** Asset classes created with each company; lives and rates are common starting points, editable per company. */
export const STARTER_ASSET_CATEGORIES = [
  { name: "Buildings", months: 600, asset: "1610", accum: "1691" },
  { name: "Motor vehicles", months: 60, asset: "1620", accum: "1692" },
  { name: "Computers & IT equipment", months: 36, asset: "1630", accum: "1693" },
  { name: "Furniture & fittings", months: 120, asset: "1640", accum: "1694" },
  { name: "Machinery & equipment", months: 120, asset: "1650", accum: "1695" },
];

export const DEFAULT_SETTINGS: CompanySettings = {
  arAccount: "1200", apAccount: "2100", vatIn: "1450", vatOut: "2200", whtAccount: "2320",
};

export const PAYROLL_DEFAULTS: PayrollSettings = {
  country: "", components: [], accSalary: "6100", accNet: "2330", accAdv: "1510", reviewed: false,
};

/** Rwanda's payroll rules as an example preset. They must be checked against current law before use. */
export const RWANDA_COMPONENTS: PayrollComponent[] = [
  { code: "PAYE", name: "PAYE", kind: "employee", method: "brackets", rate: 0, brackets: "60000:0, 100000:10, 200000:20, *:30", base: "gross", liabilityAccount: "2300", expenseAccount: "" },
  { code: "PEN_E", name: "Pension (employee)", kind: "employee", method: "percent", rate: 6, brackets: "", base: "gross", liabilityAccount: "2310", expenseAccount: "" },
  { code: "MAT_E", name: "Maternity leave (employee)", kind: "employee", method: "percent", rate: 0.3, brackets: "", base: "gross", liabilityAccount: "2310", expenseAccount: "" },
  { code: "CBHI", name: "CBHI", kind: "employee", method: "percent", rate: 0.5, brackets: "", base: "remaining", liabilityAccount: "2310", expenseAccount: "" },
  { code: "PEN_R", name: "Pension (employer)", kind: "employer", method: "percent", rate: 6, brackets: "", base: "gross", liabilityAccount: "2310", expenseAccount: "6101" },
  { code: "MAT_R", name: "Maternity leave (employer)", kind: "employer", method: "percent", rate: 0.3, brackets: "", base: "gross", liabilityAccount: "2310", expenseAccount: "6101" },
  { code: "OH", name: "Occupational hazards (employer)", kind: "employer", method: "percent", rate: 2, brackets: "", base: "gross", liabilityAccount: "2310", expenseAccount: "6101" },
];

export const DEFAULT_POLICIES = `1. Supplier invoice prices include VAT unless the invoice says otherwise. When the supplier is VAT registered, split the VAT to the input VAT account (1450).
2. Fuel, vehicle repairs and taxi costs go to 6105 Transport & fuel.
3. Items that cost more than the capitalisation threshold and last more than one year are fixed assets: book them to the right 16xx account, not to an expense.
4. Unpaid supplier invoices: credit 2100 Accounts payable. Paid in cash: credit 1100. Paid by bank transfer: credit 1110.
5. Fees paid to individuals who are not VAT registered: apply the withholding tax required by law and credit it to 2320.
6. Costs of a donor-funded activity must carry that program's project code. Office running costs use the general project.
7. Memo format: <what was bought or sold> - <supplier or customer> - <invoice number>.`;

export const ORG_TYPES = ["company", "ngo", "cooperative", "government", "sole_trader", "other"] as const;
export const SECTORS = [
  "agriculture", "consultancy", "construction", "education", "finance", "fuel_station", "health", "hotel_restaurant", "ict",
  "manufacturing", "ngo_programs", "real_estate", "retail", "transport", "wholesale", "other",
] as const;

/** Organisation profile fields read from the onboarding or settings form. */
export function companyProfile(fd: FormData) {
  const s = (k: string) => { const v = fd.get(k); return typeof v === "string" ? v.trim() : ""; };
  return {
    registrationNo: s("registrationNo"), tin: s("tin"), country: s("country"), city: s("city"), address: s("address"),
    phone: s("phone"), email: s("email"),
    orgType: (ORG_TYPES as readonly string[]).includes(s("orgType")) ? s("orgType") : "company",
    sector: (SECTORS as readonly string[]).includes(s("sector")) ? s("sector") : "other",
  };
}

export const CURRENCIES = ["USD", "EUR", "GBP", "RWF", "KES", "UGX", "TZS", "BIF", "CDF", "NGN", "GHS", "ZAR", "XOF", "XAF", "ETB", "INR", "CAD", "AUD", "CHF", "CNY", "JPY", "AED"];
