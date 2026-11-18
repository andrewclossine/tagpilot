import "server-only";
import type { FsNoteKind } from "@/db/schema";
import type { FsFigures, FsLine } from "./fs";

type Lang = "en" | "fr";
type Text = { en: string; fr: string };
export type Company = { name: string; country: string; orgType: string; sector: string; currency: string; vatRegistered: boolean; registrationNo: string; tin: string };
type Ctx = { f: FsFigures; c: Company; framework: "ifrs_sme" | "ifrs" };

export type Template = {
  key: string; kind: FsNoteKind; title: Text; body: (x: Ctx) => Text;
  /** The table of figures printed under the text. */
  figures?: FsLine | "ppe" | "equity";
  /** Whether a new draft has it at all; otherwise it can be added from the list. */
  when?: (x: Ctx) => boolean;
  /** Whether it is printed until someone says otherwise. */
  on?: (x: Ctx) => boolean;
  /** Offered in "Add a note". */
  optional?: boolean;
};

const has = (x: Ctx, ...lines: FsLine[]) => lines.some((l) => { const g = x.f.lineOf(l); return !!g && (g.v[0] !== 0 || (g.v[1] ?? 0) !== 0); });
const isCompany = (x: Ctx) => ["company", "other"].includes(x.c.orgType);
const governing = (x: Ctx): Text => (
  x.c.orgType === "company" ? { en: "directors", fr: "administrateurs" }
    : x.c.orgType === "ngo" ? { en: "board of trustees", fr: "conseil d'administration" }
      : x.c.orgType === "cooperative" ? { en: "board of directors", fr: "conseil d'administration" }
        : { en: "management", fr: "direction" });
const orgKind = (x: Ctx): Text => ({
  company: { en: "a limited company", fr: "une société" }, ngo: { en: "a non-profit organisation", fr: "une organisation à but non lucratif" },
  cooperative: { en: "a cooperative", fr: "une coopérative" }, government: { en: "a public institution", fr: "une institution publique" },
  sole_trader: { en: "a sole proprietorship", fr: "une entreprise individuelle" },
}[x.c.orgType] ?? { en: "an organisation", fr: "une organisation" });
const frameworkName = (x: Ctx): Text => (x.framework === "ifrs"
  ? { en: "International Financial Reporting Standards (IFRS)", fr: "les normes internationales d'information financière (IFRS)" }
  : { en: "the International Financial Reporting Standard for Small and Medium-sized Entities (IFRS for SMEs)", fr: "la norme internationale d'information financière pour les PME (IFRS pour les PME)" });
const years = (months: number) => (months % 12 ? `${months} months` : `${months / 12} years`);
const ans = (months: number) => (months % 12 ? `${months} mois` : `${months / 12} ans`);

/**
 * Wording a new draft starts from: reports, accounting policies and notes. Words in braces ({company}, {period_end}...)
 * are filled in when printed, so they follow later changes to the organisation or the dates.
 */
export const TEMPLATES: Template[] = [
  // ---------------- reports ----------------
  {
    key: "r_responsibility", kind: "report",
    title: { en: "Statement of responsibility", fr: "Déclaration de responsabilité" },
    body: (x) => ({
      en: `The ${governing(x).en} are responsible for the preparation and fair presentation of the financial statements of {company} for the period ended {period_end}, in accordance with {framework}, and for such internal control as they determine is necessary to enable the preparation of financial statements that are free from material misstatement, whether due to fraud or error.\n\nThe ${governing(x).en} have assessed the ability of {company} to continue as a going concern and have no reason to believe that it will not be a going concern in the year ahead.`,
      fr: `Les ${governing(x).fr} sont responsables de l'établissement et de la présentation fidèle des états financiers de {company} pour la période close le {period_end}, conformément à {framework}, ainsi que du contrôle interne qu'ils jugent nécessaire pour permettre l'établissement d'états financiers exempts d'anomalies significatives, que celles-ci résultent de fraudes ou d'erreurs.\n\nLes ${governing(x).fr} ont évalué la capacité de {company} à poursuivre son exploitation et n'ont aucune raison de penser qu'elle ne pourra pas la poursuivre au cours de l'année à venir.`,
    }),
  },
  {
    key: "r_approval", kind: "report",
    title: { en: "Approval of the financial statements", fr: "Approbation des états financiers" },
    body: (x) => ({
      en: `The financial statements set out on the following pages were approved by the ${governing(x).en} on {approved_on} and signed on their behalf by:\n\n{approved_by}`,
      fr: `Les états financiers présentés dans les pages suivantes ont été approuvés par les ${governing(x).fr} le {approved_on} et signés en leur nom par :\n\n{approved_by}`,
    }),
  },

  // ---------------- accounting policies ----------------
  {
    key: "p_general", kind: "policy",
    title: { en: "General information", fr: "Informations générales" },
    body: (x) => ({
      en: `{company} is ${orgKind(x).en} registered in {country}${x.c.registrationNo ? " under number " + x.c.registrationNo : ""}. These financial statements cover the period from {period_start} to {period_end}.`,
      fr: `{company} est ${orgKind(x).fr} enregistrée au/en {country}${x.c.registrationNo ? " sous le numéro " + x.c.registrationNo : ""}. Ces états financiers couvrent la période du {period_start} au {period_end}.`,
    }),
  },
  {
    key: "p_basis", kind: "policy",
    title: { en: "Basis of preparation", fr: "Base de préparation" },
    body: () => ({
      en: "The financial statements have been prepared in accordance with {framework}, on the historical cost basis, except where stated otherwise in the policies below. They are presented in {currency}, rounded to the nearest unit. The policies set out below have been applied consistently to all periods presented.",
      fr: "Les états financiers ont été établis conformément à {framework}, selon la convention du coût historique, sauf indication contraire dans les méthodes ci-dessous. Ils sont présentés en {currency}, arrondis à l'unité. Les méthodes ci-dessous ont été appliquées de façon constante à toutes les périodes présentées.",
    }),
  },
  {
    key: "p_going_concern", kind: "policy",
    title: { en: "Going concern", fr: "Continuité d'exploitation" },
    body: () => ({
      en: "The financial statements have been prepared on the going concern basis, which assumes that {company} will be able to meet its obligations as they fall due in the foreseeable future.",
      fr: "Les états financiers ont été établis selon le principe de continuité d'exploitation, qui suppose que {company} pourra faire face à ses obligations à leur échéance dans un avenir prévisible.",
    }),
  },
  {
    key: "p_revenue", kind: "policy", when: (x) => has(x, "revenue"),
    title: { en: "Revenue", fr: "Produits" },
    body: (x) => ({
      en: `Revenue is measured at the fair value of the consideration received or receivable${x.c.vatRegistered ? ", excluding value added tax," : ""} and net of discounts. Revenue from the sale of goods is recognised when the goods are delivered and the significant risks and rewards of ownership have passed to the buyer. Revenue from services is recognised as the service is rendered.`,
      fr: `Les produits sont évalués à la juste valeur de la contrepartie reçue ou à recevoir${x.c.vatRegistered ? ", hors taxe sur la valeur ajoutée," : ""} et nets des remises. Les ventes de biens sont comptabilisées à la livraison, lorsque les risques et avantages importants ont été transférés à l'acheteur. Les prestations de services sont comptabilisées au fur et à mesure de leur réalisation.`,
    }),
  },
  {
    key: "p_grants", kind: "policy", when: (x) => has(x, "grants", "deferred_income"),
    title: { en: "Grants and donations", fr: "Subventions et dons" },
    body: () => ({
      en: "Grants and donations are recognised as income when there is reasonable assurance that the conditions attached to them will be met and the funds will be received. Grants received for specific activities that have not yet been carried out are held as deferred grant income and recognised as income as the related expenditure is incurred.",
      fr: "Les subventions et dons sont comptabilisés en produits lorsqu'il existe une assurance raisonnable que les conditions qui s'y rattachent seront remplies et que les fonds seront reçus. Les subventions reçues pour des activités précises non encore réalisées sont présentées en subventions reçues d'avance et rapportées au résultat au rythme des dépenses correspondantes.",
    }),
  },
  {
    key: "p_ppe", kind: "policy", when: (x) => has(x, "ppe"),
    title: { en: "Property, plant and equipment", fr: "Immobilisations corporelles" },
    body: (x) => {
      const lives = x.f.ppe.filter((p) => p.months).map((p) => p);
      return {
        en: `Property, plant and equipment are stated at cost less accumulated depreciation and any impairment losses. Cost includes the purchase price and the costs directly attributable to bringing the asset to working condition. Depreciation is charged so as to write off the cost of assets over their estimated useful lives, using the ${lives.some((l) => l.method === "reducing_balance") ? "straight-line or reducing balance" : "straight-line"} method, as follows:\n${lives.map((l) => `- ${l.name}: ${l.method === "reducing_balance" ? `${l.rate}% a year, reducing balance` : years(l.months)}`).join("\n")}\n\nUseful lives and residual values are reviewed at each reporting date. Gains and losses on disposal are recognised in profit or loss.`,
        fr: `Les immobilisations corporelles sont comptabilisées au coût diminué du cumul des amortissements et des pertes de valeur. Le coût comprend le prix d'achat et les coûts directement attribuables à la mise en état de fonctionnement. L'amortissement est calculé de façon à répartir le coût sur la durée d'utilité estimée, selon la méthode ${lives.some((l) => l.method === "reducing_balance") ? "linéaire ou dégressive" : "linéaire"} :\n${lives.map((l) => `- ${l.name} : ${l.method === "reducing_balance" ? `${l.rate} % par an, dégressif` : ans(l.months)}`).join("\n")}\n\nLes durées d'utilité et valeurs résiduelles sont revues à chaque clôture. Les plus et moins-values de cession sont comptabilisées en résultat.`,
      };
    },
  },
  {
    key: "p_inventories", kind: "policy", when: (x) => has(x, "inventories", "cost_of_sales"),
    title: { en: "Inventories", fr: "Stocks" },
    body: (x) => {
      const made = x.c.sector === "manufacturing";
      return {
        en: `Inventories are measured at the lower of cost and estimated selling price less costs to complete and sell. Cost is determined using the weighted average cost formula.${made ? " The cost of work in progress and finished goods comprises raw materials, direct labour and a systematic allocation of production overheads." : ""}`,
        fr: `Les stocks sont évalués au plus bas du coût et du prix de vente estimé diminué des coûts d'achèvement et de vente. Le coût est déterminé selon la méthode du coût moyen pondéré.${made ? " Le coût des en-cours et des produits finis comprend les matières premières, la main-d'œuvre directe et une affectation systématique des frais généraux de production." : ""}`,
      };
    },
  },
  {
    key: "p_financial_instruments", kind: "policy", when: (x) => has(x, "receivables", "payables", "loans"),
    title: { en: "Financial instruments", fr: "Instruments financiers" },
    body: () => ({
      en: "Trade and other receivables are measured at the transaction price less any allowance for amounts not expected to be recovered. Trade and other payables are measured at the transaction price. Loans are measured at amortised cost; interest is recognised in profit or loss as it accrues.",
      fr: "Les créances clients et autres débiteurs sont évalués au prix de transaction diminué de toute provision pour montants jugés irrécouvrables. Les dettes fournisseurs et autres créditeurs sont évaluées au prix de transaction. Les emprunts sont évalués au coût amorti ; les intérêts sont comptabilisés en résultat au fur et à mesure.",
    }),
  },
  {
    key: "p_cash", kind: "policy", when: (x) => has(x, "cash"),
    title: { en: "Cash and cash equivalents", fr: "Trésorerie et équivalents de trésorerie" },
    body: () => ({
      en: "Cash and cash equivalents comprise cash on hand, balances with banks and mobile money accounts.",
      fr: "La trésorerie et les équivalents de trésorerie comprennent les espèces en caisse, les soldes bancaires et les comptes de monnaie mobile.",
    }),
  },
  {
    key: "p_vat", kind: "policy", when: (x) => x.c.vatRegistered,
    title: { en: "Value added tax", fr: "Taxe sur la valeur ajoutée" },
    body: () => ({
      en: "Revenue, expenses and assets are recognised net of value added tax. The net amount of VAT recoverable from, or payable to, the tax authority is included in receivables or payables.",
      fr: "Les produits, charges et actifs sont comptabilisés hors taxe sur la valeur ajoutée. Le montant net de TVA à récupérer auprès de l'administration fiscale, ou à lui payer, figure parmi les créances ou les dettes.",
    }),
  },
  {
    key: "p_income_tax", kind: "policy", when: (x) => isCompany(x) || has(x, "income_tax", "tax_payable"),
    title: { en: "Income tax", fr: "Impôt sur le résultat" },
    body: () => ({
      en: "The tax expense for the period is the tax payable on the taxable profit for the period, calculated using the tax rates enacted at the reporting date, adjusted for any changes in tax payable for previous periods.",
      fr: "La charge d'impôt de la période correspond à l'impôt dû sur le bénéfice imposable de la période, calculé selon les taux en vigueur à la date de clôture, ajusté des variations de l'impôt dû au titre des périodes antérieures.",
    }),
  },
  {
    key: "p_fx", kind: "policy", when: (x) => x.f.pl.other_income.accounts.some((a) => a.code === "4850") || x.f.pl.other_expenses.accounts.some((a) => a.code === "6850"),
    title: { en: "Foreign currencies", fr: "Opérations en devises" },
    body: () => ({
      en: "Transactions in foreign currencies are recorded at the exchange rate on the date of the transaction. Monetary assets and liabilities in foreign currencies are translated at the closing rate at the reporting date. Exchange differences are recognised in profit or loss.",
      fr: "Les opérations en devises sont enregistrées au cours du jour de l'opération. Les actifs et passifs monétaires en devises sont convertis au cours de clôture. Les écarts de change sont comptabilisés en résultat.",
    }),
  },
  {
    key: "p_employee", kind: "policy", when: (x) => has(x, "employee_costs"),
    title: { en: "Employee benefits", fr: "Avantages du personnel" },
    body: () => ({
      en: "Salaries, wages, leave pay and other short-term benefits are recognised as an expense in the period in which the employees render the related service. Contributions to the national social security scheme are recognised as an expense when they fall due.",
      fr: "Les salaires, congés payés et autres avantages à court terme sont comptabilisés en charges de la période au cours de laquelle les services sont rendus. Les cotisations au régime national de sécurité sociale sont comptabilisées en charges à leur échéance.",
    }),
  },
  {
    key: "p_judgements", kind: "policy",
    title: { en: "Significant judgements and estimates", fr: "Jugements et estimations significatifs" },
    body: () => ({
      en: "Preparing financial statements requires estimates and judgements that affect the amounts reported. The main ones relate to the useful lives of property, plant and equipment and the recoverability of receivables. Estimates are reviewed regularly and any revision is recognised in the period in which it is made.",
      fr: "L'établissement des états financiers requiert des estimations et des jugements qui affectent les montants présentés. Les principaux portent sur la durée d'utilité des immobilisations corporelles et le caractère recouvrable des créances. Les estimations sont revues régulièrement et toute révision est comptabilisée dans la période où elle intervient.",
    }),
  },

  // ---------------- notes with figures ----------------
  { key: "n_ppe", kind: "note", figures: "ppe", when: (x) => has(x, "ppe"), title: { en: "Property, plant and equipment", fr: "Immobilisations corporelles" },
    body: () => ({ en: "", fr: "" }) },
  { key: "n_investment_property", kind: "note", figures: "investment_property", when: (x) => has(x, "investment_property"), title: { en: "Investment property", fr: "Immeubles de placement" },
    body: () => ({ en: "Investment property is held to earn rentals or for capital appreciation.", fr: "Les immeubles de placement sont détenus pour en retirer des loyers ou valoriser le capital." }) },
  { key: "n_biological", kind: "note", figures: "biological", when: (x) => has(x, "biological"), title: { en: "Biological assets", fr: "Actifs biologiques" },
    body: () => ({ en: "", fr: "" }) },
  { key: "n_inventories", kind: "note", figures: "inventories", when: (x) => has(x, "inventories"), title: { en: "Inventories", fr: "Stocks" }, body: () => ({ en: "", fr: "" }) },
  { key: "n_receivables", kind: "note", figures: "receivables", when: (x) => has(x, "receivables"), title: { en: "Trade and other receivables", fr: "Créances clients et autres débiteurs" }, body: () => ({ en: "", fr: "" }) },
  { key: "n_cash", kind: "note", figures: "cash", when: (x) => has(x, "cash"), title: { en: "Cash and cash equivalents", fr: "Trésorerie et équivalents de trésorerie" }, body: () => ({ en: "", fr: "" }) },
  { key: "n_equity", kind: "note", figures: "equity", when: (x) => x.f.equity.length > 0, title: { en: "Capital and reserves", fr: "Capitaux propres" }, body: () => ({ en: "", fr: "" }) },
  {
    key: "n_loans", kind: "note", figures: "loans", when: (x) => has(x, "loans"), title: { en: "Borrowings", fr: "Emprunts" },
    body: () => ({
      en: "[Name of lender], [amount] repayable over [period] in [monthly] instalments, bearing interest at [rate]% a year. The loan is secured by [security].",
      fr: "[Nom du prêteur], [montant] remboursable sur [durée] par mensualités, portant intérêt au taux de [taux] % l'an. L'emprunt est garanti par [garantie].",
    }),
  },
  { key: "n_deferred_income", kind: "note", figures: "deferred_income", when: (x) => has(x, "deferred_income"), title: { en: "Deferred grant income", fr: "Subventions reçues d'avance" },
    body: () => ({ en: "Grants received for activities not yet carried out.", fr: "Subventions reçues pour des activités non encore réalisées." }) },
  { key: "n_payables", kind: "note", figures: "payables", when: (x) => has(x, "payables"), title: { en: "Trade and other payables", fr: "Dettes fournisseurs et autres créditeurs" }, body: () => ({ en: "", fr: "" }) },
  { key: "n_revenue", kind: "note", figures: "revenue", when: (x) => has(x, "revenue"), title: { en: "Revenue", fr: "Chiffre d'affaires" }, body: () => ({ en: "", fr: "" }) },
  { key: "n_grants", kind: "note", figures: "grants", when: (x) => has(x, "grants"), title: { en: "Grants and donations", fr: "Subventions et dons" }, body: () => ({ en: "", fr: "" }) },
  { key: "n_other_income", kind: "note", figures: "other_income", when: (x) => has(x, "other_income"), title: { en: "Other income", fr: "Autres produits" }, body: () => ({ en: "", fr: "" }) },
  { key: "n_cost_of_sales", kind: "note", figures: "cost_of_sales", when: (x) => has(x, "cost_of_sales"), title: { en: "Cost of sales", fr: "Coût des ventes" }, body: () => ({ en: "", fr: "" }) },
  { key: "n_employee_costs", kind: "note", figures: "employee_costs", when: (x) => has(x, "employee_costs"), title: { en: "Employee costs", fr: "Charges de personnel" }, body: () => ({ en: "", fr: "" }) },
  { key: "n_other_expenses", kind: "note", figures: "other_expenses", when: (x) => has(x, "other_expenses"), title: { en: "Other operating expenses", fr: "Autres charges d'exploitation" }, body: () => ({ en: "", fr: "" }) },
  { key: "n_finance_costs", kind: "note", figures: "finance_costs", when: (x) => has(x, "finance_costs"), title: { en: "Finance costs", fr: "Charges financières" }, body: () => ({ en: "", fr: "" }) },
  { key: "n_income_tax", kind: "note", figures: "income_tax", when: (x) => has(x, "income_tax", "tax_payable"), title: { en: "Income tax", fr: "Impôt sur le résultat" },
    body: () => ({ en: "Income tax is calculated on the taxable profit for the period at the rate enacted in {country}.", fr: "L'impôt est calculé sur le bénéfice imposable de la période au taux en vigueur au/en {country}." }) },

  // ---------------- notes without figures ----------------
  {
    key: "n_related_parties", kind: "note", title: { en: "Related parties", fr: "Parties liées" },
    body: () => ({
      en: "Related parties include the members of the governing body, key management and entities they control. [Describe any transactions with related parties during the period and balances at the end of the period, or state that there were none.]",
      fr: "Les parties liées comprennent les membres de l'organe de direction, les principaux dirigeants et les entités qu'ils contrôlent. [Décrivez les transactions avec les parties liées au cours de la période et les soldes à la clôture, ou indiquez qu'il n'y en a pas eu.]",
    }),
  },
  {
    key: "n_events_after", kind: "note", title: { en: "Events after the reporting period", fr: "Événements postérieurs à la clôture" },
    body: () => ({
      en: "No event that would require adjustment of, or disclosure in, these financial statements has occurred between the reporting date and the date the financial statements were approved.",
      fr: "Aucun événement nécessitant un ajustement ou une mention dans les présents états financiers n'est survenu entre la date de clôture et la date d'approbation des états financiers.",
    }),
  },
  {
    key: "n_contingent", kind: "note", optional: true, on: () => false, title: { en: "Contingent liabilities", fr: "Passifs éventuels" },
    body: () => ({
      en: "At the reporting date, {company} was a defendant in a legal case brought by [claimant] claiming [amount] for [reason]. Based on legal advice, the outcome is [not expected to result in a material loss / uncertain]; no provision has been made.",
      fr: "À la date de clôture, {company} était défenderesse dans une procédure engagée par [demandeur] réclamant [montant] pour [motif]. Sur avis juridique, l'issue [ne devrait pas entraîner de perte significative / est incertaine] ; aucune provision n'a été constituée.",
    }),
  },
  {
    key: "n_commitments", kind: "note", optional: true, on: () => false, title: { en: "Commitments", fr: "Engagements" },
    body: () => ({
      en: "At the reporting date, {company} had contracted capital or operating commitments of [amount] for [description], not provided for in these financial statements.",
      fr: "À la date de clôture, {company} avait des engagements contractuels de [montant] pour [description], non provisionnés dans les présents états financiers.",
    }),
  },
  {
    key: "n_guarantees", kind: "note", optional: true, on: () => false, title: { en: "Guarantees and securities", fr: "Garanties et sûretés" },
    body: () => ({
      en: "[Asset] with a carrying amount of [amount] is pledged as security for [loan / facility] from [bank].",
      fr: "[Actif] d'une valeur comptable de [montant] est donné en garantie de [l'emprunt / la facilité] auprès de [banque].",
    }),
  },
  {
    key: "n_going_concern", kind: "note", optional: true, on: () => false, title: { en: "Going concern", fr: "Continuité d'exploitation" },
    body: () => ({
      en: "[Describe the events or conditions that cast doubt on the ability of {company} to continue as a going concern, and the plans of the governing body to address them.]",
      fr: "[Décrivez les événements ou conditions qui jettent un doute sur la capacité de {company} à poursuivre son exploitation, et les mesures prévues par l'organe de direction.]",
    }),
  },
];

/** The drafts' starting notes, in print order, in one language. */
export function startingNotes(x: Ctx, lang: Lang) {
  return TEMPLATES.filter((t) => !t.optional && (!t.when || t.when(x)))
    .map((t, i) => ({ kind: t.kind, key: t.key, title: t.title[lang], body: t.body(x)[lang], figures: t.figures ?? null, included: t.on ? t.on(x) : true, sortOrder: (i + 1) * 10 }));
}

/** What can be added later: the optional notes, and any other note this draft does not have yet. */
export function addableTemplates(present: string[]) {
  return TEMPLATES.filter((t) => t.kind !== "report" && (t.optional || !present.includes(t.key)));
}

/** Fills the words in braces with the draft's and the organisation's details. */
export function fillTokens(text: string, v: Record<string, string>) {
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
}
