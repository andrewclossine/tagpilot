import type { AccountSubtype, AccountType, CompanySettings, PayrollComponent, PayrollSettings } from "@/db/schema";

/** Starter chart of accounts (IFRS presentation). Companies can edit it freely. */
type StarterAccount = { code: string; type: AccountType; subtype?: AccountSubtype; en: string; fr: string };

/** What decides the starter chart: the kind of organisation, its sector and whether it charges VAT. */
export type ChartProfile = { orgType: string; sector: string; vatRegistered: boolean };

const a = (code: string, type: AccountType, en: string, fr: string, subtype?: AccountSubtype): StarterAccount => ({ code, type, en, fr, subtype });

/** Every account TAGPILOT may create, under its general name. The chart for an organisation picks from these. */
export const STARTER_ACCOUNTS: StarterAccount[] = [
  a("1100", "asset", "Cash on hand", "Caisse", "cash"),
  a("1110", "asset", "Bank account", "Banque", "bank"),
  a("1200", "asset", "Accounts receivable", "Clients", "ar"),
  a("1210", "asset", "Loans to customers", "Prêts à la clientèle"),
  a("1219", "asset", "Loan loss allowance", "Provision pour pertes sur prêts"),
  a("1220", "asset", "Receivable from medical insurers", "Créances sur assureurs maladie"),
  a("1250", "asset", "Contract assets (work done not yet billed)", "Actifs sur contrats (travaux non facturés)"),
  a("1260", "asset", "Retentions receivable", "Retenues de garantie à recevoir"),
  a("1300", "asset", "Inventory", "Stocks"),
  a("1310", "asset", "Raw materials", "Matières premières"),
  a("1320", "asset", "Work in progress", "En-cours de production"),
  a("1330", "asset", "Finished goods", "Produits finis"),
  a("1450", "asset", "VAT recoverable (input VAT)", "TVA déductible", "vat_in"),
  a("1500", "asset", "Prepayments", "Charges constatées d'avance"),
  a("1510", "asset", "Staff advances", "Avances au personnel"),
  ...FIXED_ASSET_ACCOUNTS(),
  a("1660", "asset", "Investment property", "Immeubles de placement"),
  a("1700", "asset", "Biological assets (livestock, plantations)", "Actifs biologiques (bétail, plantations)"),
  a("2100", "liability", "Accounts payable", "Fournisseurs", "ap"),
  a("2150", "liability", "Goods received not invoiced", "Marchandises reçues non facturées"),
  a("2160", "liability", "Customer deposits", "Dépôts de la clientèle"),
  a("2170", "liability", "Tenant security deposits", "Cautions des locataires"),
  a("2180", "liability", "Retentions payable to subcontractors", "Retenues de garantie dues aux sous-traitants"),
  a("2200", "liability", "VAT payable (output VAT)", "TVA collectée", "vat_out"),
  a("2300", "liability", "Income tax on salaries payable", "Impôt sur salaires à payer"),
  a("2310", "liability", "Social security contributions payable", "Cotisations sociales à payer"),
  a("2320", "liability", "Withholding tax payable", "Retenue à la source à payer", "wht"),
  a("2330", "liability", "Net salaries payable", "Salaires nets à payer"),
  a("2340", "liability", "Corporate income tax payable", "Impôt sur les sociétés à payer"),
  a("2350", "liability", "Patronage refunds payable to members", "Ristournes à payer aux membres"),
  a("2400", "liability", "Accrued expenses", "Charges à payer"),
  a("2450", "liability", "Contract liabilities (advances from customers)", "Passifs sur contrats (avances des clients)"),
  a("2460", "liability", "Fees received in advance", "Frais perçus d'avance"),
  a("2500", "liability", "Loans", "Emprunts"),
  a("2600", "liability", "Deferred grant income", "Subventions reçues d'avance"),
  a("3100", "equity", "Share capital", "Capital social"),
  a("3150", "equity", "Reserves", "Réserves"),
  a("3200", "equity", "Retained earnings", "Résultats reportés"),
  a("3300", "equity", "Revaluation surplus", "Écart de réévaluation"),
  a("4100", "income", "Sales of goods", "Ventes de marchandises"),
  a("4110", "income", "Sales of products", "Ventes de produits"),
  a("4200", "income", "Service revenue", "Prestations de services"),
  a("4210", "income", "Fees from customers", "Honoraires et redevances"),
  a("4220", "income", "Other operating revenue", "Autres produits d'exploitation"),
  a("4300", "income", "Grants & donations", "Subventions et dons"),
  a("4310", "income", "Restricted grants", "Subventions affectées"),
  a("4800", "income", "Gain on disposal of assets", "Plus-values de cession d'actifs"),
  a("4850", "income", "Foreign exchange gains", "Gains de change"),
  a("4900", "income", "Other income", "Autres produits"),
  a("4950", "income", "Fair value gains", "Gains de juste valeur"),
  a("5100", "expense", "Cost of goods sold", "Coût des marchandises vendues"),
  a("5110", "expense", "Direct materials and inputs", "Matières et intrants directs"),
  a("5120", "expense", "Direct labour", "Main-d'œuvre directe"),
  a("5130", "expense", "Production overheads", "Frais généraux de production"),
  a("5150", "expense", "Stock adjustments & losses", "Ajustements et pertes de stock"),
  a("5190", "expense", "Production costs absorbed into stock", "Coûts de production incorporés aux stocks"),
  a("5200", "expense", "Cost of services (subcontractors)", "Coût des services (sous-traitance)"),
  a("5210", "expense", "Interest expense on deposits", "Intérêts sur dépôts"),
  a("6100", "expense", "Salaries & wages", "Salaires et traitements"),
  a("6101", "expense", "Employer social contributions", "Charges sociales patronales"),
  a("6105", "expense", "Transport & fuel", "Transport et carburant"),
  a("6110", "expense", "Rent", "Loyer"),
  a("6120", "expense", "Electricity & water", "Eau et électricité"),
  a("6130", "expense", "Communication & internet", "Communication et internet"),
  a("6135", "expense", "Software & subscriptions", "Logiciels et abonnements"),
  a("6140", "expense", "Office supplies", "Fournitures de bureau"),
  a("6150", "expense", "Repairs & maintenance", "Entretien et réparations"),
  a("6155", "expense", "Vehicle maintenance, insurance & licences", "Entretien, assurance et licences des véhicules"),
  a("6160", "expense", "Professional fees", "Honoraires"),
  a("6170", "expense", "Bank charges", "Frais bancaires"),
  a("6180", "expense", "Travel & accommodation", "Déplacements et hébergement"),
  a("6190", "expense", "Training & workshops", "Formations et ateliers"),
  a("6200", "expense", "Depreciation", "Dotations aux amortissements"),
  a("6210", "expense", "Impairment losses", "Pertes de valeur"),
  a("6220", "expense", "Expected credit losses on loans", "Pertes de crédit attendues sur prêts"),
  a("6300", "expense", "Program activities", "Activités des programmes"),
  a("6310", "expense", "Sub-grants to partners", "Sous-subventions aux partenaires"),
  a("6800", "expense", "Loss on disposal of assets", "Moins-values de cession d'actifs"),
  a("6850", "expense", "Foreign exchange losses", "Pertes de change"),
  a("6900", "expense", "Other expenses", "Autres charges"),
  a("6950", "expense", "Income tax expense", "Charge d'impôt sur le résultat"),
];

/** Accounts every organisation gets: money, people, payroll, fixed assets and running costs. */
const BASE = ["1100", "1110", "1200", "1500", "1510", "1610", "1620", "1630", "1640", "1650", "1691", "1692", "1693", "1694", "1695",
  "2100", "2300", "2310", "2320", "2330", "2400", "2500", "3200", "3300", "4200", "4800", "4850", "4900",
  "6100", "6101", "6105", "6110", "6120", "6130", "6140", "6150", "6160", "6170", "6180", "6190", "6200", "6210", "6800", "6850", "6900"];
const GOODS = ["1300", "2150", "4100", "5100", "5150"];
const VAT = ["1450", "2200"];

type Extra = { codes: string[]; names?: Record<string, [string, string]> };

/** Equity and tax follow the legal form: shareholders, an owner, members, or funds held for a purpose. */
const BY_ORG_TYPE: Record<string, Extra> = {
  company: { codes: ["3100", "2340", "6950"] },
  other: { codes: ["3100", "2340", "6950"] },
  sole_trader: { codes: ["3100", "3150"], names: { "3100": ["Owner's capital", "Capital de l'exploitant"], "3150": ["Owner's drawings", "Prélèvements de l'exploitant"], "3200": ["Accumulated profits", "Bénéfices cumulés"] } },
  ngo: { codes: ["3100", "3150", "2600", "4300", "4310", "6300", "6310"], names: { "3100": ["Unrestricted funds", "Fonds non affectés"], "3150": ["Restricted funds", "Fonds affectés"], "3200": ["Accumulated surplus", "Excédents cumulés"], "4300": ["Unrestricted grants & donations", "Subventions et dons non affectés"] } },
  cooperative: { codes: ["3100", "3150", "2350", "4300"], names: { "3100": ["Members' share capital", "Parts sociales des membres"], "3150": ["Statutory reserve", "Réserve statutaire"], "3200": ["Accumulated surplus", "Excédents cumulés"] } },
  government: { codes: ["3100", "2600", "4300"], names: { "3100": ["Accumulated fund", "Fonds cumulés"], "3200": ["Accumulated surplus", "Excédents cumulés"], "4300": ["Government transfers & grants", "Transferts et subventions de l'État"] } },
};

/** What a sector buys, makes and earns. Accounts it does not need are left out; they come back when a module needs them. */
const BY_SECTOR: Record<string, Extra & { goods?: boolean }> = {
  manufacturing: { goods: true, codes: ["1310", "1320", "1330", "4110", "5110", "5120", "5130", "5190"], names: { "4110": ["Sales of manufactured products", "Ventes de produits fabriqués"] } },
  retail: { goods: true, codes: [], names: { "1300": ["Merchandise inventory", "Stock de marchandises"] } },
  wholesale: { goods: true, codes: [], names: { "1300": ["Merchandise inventory", "Stock de marchandises"] } },
  fuel_station: { goods: true, codes: ["4110"], names: { "1300": ["Fuel & lubricants stock", "Stock de carburants et lubrifiants"], "4100": ["Fuel sales", "Ventes de carburant"], "4110": ["Lubricants & shop sales", "Ventes de lubrifiants et boutique"], "5150": ["Fuel losses & stock adjustments", "Pertes de carburant et ajustements de stock"] } },
  hotel_restaurant: { goods: true, codes: ["4210"], names: { "1300": ["Food & beverage stock", "Stock d'aliments et boissons"], "4100": ["Food & beverage sales", "Ventes d'aliments et boissons"], "4210": ["Room revenue", "Hébergement"], "5100": ["Cost of food & beverages", "Coût des aliments et boissons"] } },
  construction: { goods: true, codes: ["1250", "1260", "2180", "2450", "4210", "5110", "5120", "5200"], names: { "1300": ["Construction materials", "Matériaux de construction"], "4210": ["Contract revenue", "Produits des contrats"], "5110": ["Site materials used", "Matériaux utilisés sur chantier"], "5120": ["Site labour", "Main-d'œuvre de chantier"], "5200": ["Subcontractors", "Sous-traitants"] } },
  consultancy: { codes: ["1250", "2450", "4210", "5200"], names: { "4210": ["Consulting fees", "Honoraires de conseil"] } },
  ict: { goods: true, codes: ["1250", "2450", "4210", "5200", "6135"], names: { "4100": ["Hardware sales", "Ventes de matériel"], "4210": ["Software & IT services", "Logiciels et services informatiques"] } },
  education: { codes: ["2460", "4210", "4220"], names: { "4210": ["Tuition fees", "Frais de scolarité"], "4220": ["Boarding & other school fees", "Internat et autres frais scolaires"] } },
  finance: { codes: ["1210", "1219", "2160", "4210", "4220", "5210", "6220"], names: { "4210": ["Interest income on loans", "Intérêts sur prêts"], "4220": ["Fees & commissions", "Frais et commissions"] } },
  health: { goods: true, codes: ["1220", "4210", "4220"], names: { "1300": ["Medicines & medical supplies", "Médicaments et fournitures médicales"], "4210": ["Patient fees", "Frais des patients"], "4220": ["Medical insurance claims", "Remboursements des assurances maladie"], "5100": ["Cost of medicines & supplies", "Coût des médicaments et fournitures"] } },
  agriculture: { goods: true, codes: ["1700", "4110", "4950", "5110"], names: { "1300": ["Produce & farm inputs stock", "Stock de récoltes et intrants"], "4110": ["Sales of produce", "Ventes de récoltes"], "4950": ["Fair value gains on biological assets", "Gains de juste valeur sur actifs biologiques"], "5110": ["Seeds, fertiliser & farm inputs", "Semences, engrais et intrants"] } },
  real_estate: { codes: ["1660", "2170", "4210", "4220", "4950"], names: { "4210": ["Rental income", "Revenus locatifs"], "4220": ["Service charges", "Charges locatives refacturées"], "4950": ["Fair value gains on investment property", "Gains de juste valeur sur immeubles de placement"] } },
  transport: { codes: ["4210", "6155"], names: { "4210": ["Transport & freight revenue", "Produits du transport et du fret"] } },
  ngo_programs: { codes: ["2600", "4300", "4310", "6300", "6310"] },
  other: { goods: true, codes: [] },
};

/**
 * The starter chart for one organisation: the base, then what its legal form, its sector and VAT need, with names that fit
 * (an NGO has funds, not share capital; a hotel sells food and rooms). Sector names win over the legal form's.
 */
export function chartFor(p: ChartProfile): StarterAccount[] {
  const org = BY_ORG_TYPE[p.orgType] ?? BY_ORG_TYPE.company;
  const sec = BY_SECTOR[p.sector] ?? BY_SECTOR.other;
  const codes = new Set([...BASE, ...org.codes, ...sec.codes, ...(sec.goods ? GOODS : []), ...(p.vatRegistered ? VAT : [])]);
  const names = { ...org.names, ...sec.names };
  return STARTER_ACCOUNTS.filter((x) => codes.has(x.code)).map((x) => (names[x.code] ? { ...x, en: names[x.code][0], fr: names[x.code][1] } : x));
}

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
