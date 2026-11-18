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
    title: { en: "Statement of responsibilities and approval", fr: "Déclaration de responsabilités et approbation" },
    body: (x) => {
      const g = governing(x);
      const law = isCompany(x) ? { en: "the law on companies of {country}", fr: "la loi sur les sociétés au/en {country}" } : { en: "the laws of {country} and its constitution", fr: "les lois du/de {country} et ses statuts" };
      return {
        en: `The ${g.en} are required by ${law.en} to maintain adequate accounting records and are responsible for the content and integrity of the annual financial statements of {company} and the related financial information included in this report. It is their responsibility to ensure that the annual financial statements comply with {framework} as to form and content, and present fairly the financial position of {company} at {period_end} and the results of its operations and its cash flows for the period then ended. The annual financial statements are based on appropriate accounting policies, consistently applied and supported by reasonable and prudent judgements and estimates.\n\nThe ${g.en} acknowledge that they are ultimately responsible for the system of internal financial control established by {company} and place considerable importance on maintaining a strong control environment. To enable them to meet these responsibilities, they set standards for internal control aimed at reducing the risk of error or loss in a cost-effective manner. These standards include the proper delegation of responsibilities within a clearly defined framework, effective accounting procedures and adequate segregation of duties. These controls are monitored throughout {company}, and all employees are required to maintain the highest ethical standards.\n\nThe ${g.en} are of the opinion, based on the information and explanations given by management, that the system of internal control provides reasonable assurance that the financial records may be relied on for the preparation of the annual financial statements. The ${g.en} have reviewed the ability of {company} to continue as a going concern and have no reason to believe that it will not be a going concern in the year ahead.`,
        fr: `Les ${g.fr} sont tenus par ${law.fr} de tenir une comptabilité adéquate et sont responsables du contenu et de l'intégrité des états financiers annuels de {company} et des informations financières qui s'y rapportent. Il leur appartient de veiller à ce que les états financiers annuels soient conformes à {framework} quant à la forme et au fond, et donnent une image fidèle de la situation financière de {company} au {period_end}, ainsi que de ses résultats et de ses flux de trésorerie pour la période close à cette date. Les états financiers annuels reposent sur des méthodes comptables appropriées, appliquées de façon constante et étayées par des jugements et estimations raisonnables et prudents.\n\nLes ${g.fr} reconnaissent être les responsables ultimes du système de contrôle interne financier mis en place par {company} et attachent une grande importance au maintien d'un environnement de contrôle solide. À cette fin, ils fixent des normes de contrôle interne visant à réduire le risque d'erreur ou de perte de manière économique, notamment une délégation claire des responsabilités, des procédures comptables efficaces et une séparation adéquate des tâches. Ces contrôles sont suivis dans toute l'organisation et tous les employés sont tenus au plus haut niveau d'éthique.\n\nLes ${g.fr} estiment, sur la base des informations et explications fournies par la direction, que le système de contrôle interne donne une assurance raisonnable que les documents comptables sont fiables pour l'établissement des états financiers annuels. Ils ont examiné la capacité de {company} à poursuivre son exploitation et n'ont aucune raison de penser qu'elle ne pourra pas la poursuivre au cours de l'année à venir.`,
      };
    },
  },
  {
    key: "r_directors", kind: "report", when: (x) => isCompany(x) || x.c.orgType === "cooperative",
    title: { en: "Report of the directors", fr: "Rapport des administrateurs" },
    body: () => ({
      en: "The directors submit their report together with the financial statements for the period ended {period_end}.\n\n1. Principal activity\nThe principal activity of {company} is [describe the principal activity].\n\n2. Results\nProfit (loss) before tax for the period: {currency} {profit_before_tax}.\nProfit (loss) after tax for the period: {currency} {profit_after_tax}.\n\n3. Dividends\n[No dividends were declared for the period.]\n\n4. Directorate\nThe directors who held office during the period and to the date of this report are: {approved_by}.\n\n5. Financial statements\nAt the date of this report, the directors were not aware of any circumstances which would render the values attributed to the assets in the financial statements misleading.",
      fr: "Les administrateurs présentent leur rapport accompagné des états financiers de la période close le {period_end}.\n\n1. Activité principale\nL'activité principale de {company} est [décrivez l'activité principale].\n\n2. Résultats\nRésultat avant impôt de la période : {currency} {profit_before_tax}.\nRésultat après impôt de la période : {currency} {profit_after_tax}.\n\n3. Dividendes\n[Aucun dividende n'a été déclaré pour la période.]\n\n4. Administrateurs\nLes administrateurs en fonction au cours de la période et à la date du présent rapport sont : {approved_by}.\n\n5. États financiers\nÀ la date du présent rapport, les administrateurs n'avaient connaissance d'aucune circonstance qui rendrait trompeuses les valeurs attribuées aux actifs dans les états financiers.",
    }),
  },
  {
    key: "r_approval", kind: "report",
    title: { en: "Approval of the financial statements", fr: "Approbation des états financiers" },
    body: (x) => ({
      en: `The financial statements set out on the following pages were approved by the ${governing(x).en} on {approved_on} and signed on their behalf by the signatories below.`,
      fr: `Les états financiers présentés dans les pages suivantes ont été approuvés par les ${governing(x).fr} le {approved_on} et signés en leur nom par les signataires ci-dessous.`,
    }),
  },

  // ---------------- accounting policies ----------------
  {
    key: "p_general", kind: "policy",
    title: { en: "General information", fr: "Informations générales" },
    body: (x) => ({
      en: `{company} is ${orgKind(x).en} domiciled in {country}${x.c.registrationNo ? ", registered under number " + x.c.registrationNo : ""}. Its registered office and principal place of business is {address}. The principal activity of {company} is [describe the principal activity]. These financial statements cover the period from {period_start} to {period_end}.`,
      fr: `{company} est ${orgKind(x).fr} domiciliée au/en {country}${x.c.registrationNo ? ", enregistrée sous le numéro " + x.c.registrationNo : ""}. Son siège et son principal lieu d'activité se trouvent à {address}. L'activité principale de {company} est [décrivez l'activité principale]. Ces états financiers couvrent la période du {period_start} au {period_end}.`,
    }),
  },
  {
    key: "p_basis", kind: "policy",
    title: { en: "Basis of preparation", fr: "Base de préparation" },
    body: (x) => ({
      en: `The financial statements are prepared on a going concern basis and in compliance with {framework}${x.framework === "ifrs" ? "" : " issued by the International Accounting Standards Board"}. They are presented in {currency}, which is also the functional currency of {company}, rounded to the nearest unit. The measurement basis used is the historical cost basis except where otherwise stated in the accounting policies below. The policies have been applied consistently to all the periods presented.`,
      fr: `Les états financiers sont établis selon le principe de continuité d'exploitation et conformément à {framework}${x.framework === "ifrs" ? "" : " publiée par l'International Accounting Standards Board"}. Ils sont présentés en {currency}, qui est aussi la monnaie fonctionnelle de {company}, arrondis à l'unité. La base d'évaluation est le coût historique, sauf indication contraire dans les méthodes ci-dessous, appliquées de façon constante à toutes les périodes présentées.`,
    }),
  },
  {
    key: "p_revenue", kind: "policy", when: (x) => has(x, "revenue"),
    title: { en: "Revenue recognition", fr: "Comptabilisation des produits" },
    body: () => ({
      en: "Revenue is measured at the fair value of the consideration received or receivable, net of discounts and of sales-related taxes collected on behalf of the government. Revenue from the sale of goods is recognised when the goods have been delivered and title has passed to the buyer. Revenue from services and contracts is recognised by reference to the stage of completion of the work at the reporting date, when the outcome can be estimated reliably.",
      fr: "Les produits sont évalués à la juste valeur de la contrepartie reçue ou à recevoir, nets des remises et des taxes sur les ventes perçues pour le compte de l'État. Les ventes de biens sont comptabilisées lorsque les biens ont été livrés et que la propriété en a été transférée à l'acheteur. Les produits des services et des contrats sont comptabilisés en fonction du degré d'avancement des travaux à la date de clôture, lorsque leur issue peut être estimée de façon fiable.",
    }),
  },
  {
    key: "p_grants", kind: "policy", when: (x) => has(x, "grants", "deferred_income"),
    title: { en: "Grants and donations", fr: "Subventions et dons" },
    body: () => ({
      en: "Grants and donations are recognised as income when there is reasonable assurance that the conditions attached to them will be met and the funds will be received. Grants received for specific activities that have not yet been carried out are held as deferred grant income and recognised as income as the related expenditure is incurred. Grants related to assets are recognised as income over the useful lives of the assets concerned.",
      fr: "Les subventions et dons sont comptabilisés en produits lorsqu'il existe une assurance raisonnable que les conditions qui s'y rattachent seront remplies et que les fonds seront reçus. Les subventions reçues pour des activités précises non encore réalisées sont présentées en subventions reçues d'avance et rapportées au résultat au rythme des dépenses correspondantes. Les subventions liées à des actifs sont rapportées au résultat sur la durée d'utilité de ces actifs.",
    }),
  },
  {
    key: "p_ppe", kind: "policy", when: (x) => has(x, "ppe"),
    title: { en: "Property, plant and equipment", fr: "Immobilisations corporelles" },
    body: (x) => {
      const lives = x.f.ppe.filter((p) => p.months || p.rate);
      const rate = (p: (typeof lives)[number]) => (p.method === "reducing_balance" ? p.rate : Math.round((1200 / p.months) * 100) / 100);
      return {
        en: `Items of property, plant and equipment are measured at cost less accumulated depreciation and any impairment losses. Cost includes the purchase price and the costs directly attributable to bringing the asset to the location and condition necessary for it to operate. Depreciation is charged so as to allocate the cost of assets less their residual values over their estimated useful lives, using the ${lives.some((l) => l.method === "reducing_balance") ? "straight-line or reducing balance" : "straight-line"} method. The following annual rates are used:\n${lives.map((l) => `- ${l.name}: ${rate(l)}%${l.method === "reducing_balance" ? " (reducing balance)" : ` (${years(l.months)})`}`).join("\n")}\n\nIf there is an indication that there has been a significant change in the useful life or residual value of an asset, its depreciation is revised prospectively to reflect the new expectations. On disposal, the difference between the net disposal proceeds and the carrying amount of the item is recognised in profit or loss.`,
        fr: `Les immobilisations corporelles sont évaluées au coût diminué du cumul des amortissements et des pertes de valeur. Le coût comprend le prix d'achat et les coûts directement attribuables à l'acheminement et à la mise en état de fonctionnement de l'actif. L'amortissement répartit le coût des actifs, diminué de leur valeur résiduelle, sur leur durée d'utilité estimée, selon la méthode ${lives.some((l) => l.method === "reducing_balance") ? "linéaire ou dégressive" : "linéaire"}. Les taux annuels suivants sont appliqués :\n${lives.map((l) => `- ${l.name} : ${rate(l)} %${l.method === "reducing_balance" ? " (dégressif)" : ` (${ans(l.months)})`}`).join("\n")}\n\nLorsqu'un indice montre un changement important de la durée d'utilité ou de la valeur résiduelle d'un actif, son amortissement est révisé de manière prospective. Lors d'une cession, la différence entre le produit net de cession et la valeur comptable de l'actif est comptabilisée en résultat.`,
      };
    },
  },
  {
    key: "p_inventories", kind: "policy", when: (x) => has(x, "inventories", "cost_of_sales"),
    title: { en: "Inventories", fr: "Stocks" },
    body: (x) => {
      const made = x.c.sector === "manufacturing";
      return {
        en: `Inventories are measured at the lower of cost and estimated selling price less costs to complete and sell. Cost is determined using the weighted average cost formula and includes the purchase price and other costs incurred in bringing the inventories to their present location and condition.${made ? " The cost of work in progress and finished goods comprises raw materials, direct labour and a systematic allocation of production overheads." : ""} At each reporting date, inventories are assessed for impairment and any loss is recognised immediately in profit or loss.`,
        fr: `Les stocks sont évalués au plus bas du coût et du prix de vente estimé diminué des coûts d'achèvement et de vente. Le coût est déterminé selon la méthode du coût moyen pondéré et comprend le prix d'achat et les autres coûts engagés pour amener les stocks à l'endroit et dans l'état où ils se trouvent.${made ? " Le coût des en-cours et des produits finis comprend les matières premières, la main-d'œuvre directe et une affectation systématique des frais généraux de production." : ""} À chaque clôture, les stocks font l'objet d'un test de dépréciation et toute perte est comptabilisée immédiatement en résultat.`,
      };
    },
  },
  {
    key: "p_financial_instruments", kind: "policy", when: (x) => has(x, "receivables", "payables", "loans"),
    title: { en: "Financial assets and liabilities", fr: "Actifs et passifs financiers" },
    body: () => ({
      en: "Trade and other receivables are initially recognised at the transaction price. Most sales are made on normal credit terms, and receivables do not bear interest. Where credit is extended beyond normal credit terms, receivables are measured at amortised cost using the effective interest method. At the end of each reporting period, the carrying amounts of trade and other receivables are reviewed to determine whether there is any objective evidence that the amounts are not recoverable; if so, an impairment loss is recognised immediately in profit or loss.\n\nTrade and other payables are obligations on the basis of normal credit terms and do not bear interest; they are measured at the transaction price. Borrowings are initially recognised at the transaction price and subsequently measured at amortised cost; interest expense is recognised in profit or loss as it accrues.",
      fr: "Les créances clients et autres débiteurs sont initialement comptabilisés au prix de transaction. La plupart des ventes sont conclues aux conditions normales de crédit et les créances ne portent pas intérêt. Lorsque le crédit dépasse les conditions normales, les créances sont évaluées au coût amorti selon la méthode du taux d'intérêt effectif. À chaque clôture, la valeur comptable des créances est examinée afin de déterminer s'il existe une indication objective qu'elles ne sont pas recouvrables ; le cas échéant, une perte de valeur est comptabilisée immédiatement en résultat.\n\nLes dettes fournisseurs et autres créditeurs sont des obligations aux conditions normales de crédit, ne portant pas intérêt, évaluées au prix de transaction. Les emprunts sont initialement comptabilisés au prix de transaction puis évalués au coût amorti ; la charge d'intérêts est comptabilisée en résultat au fur et à mesure.",
    }),
  },
  {
    key: "p_cash", kind: "policy", when: (x) => has(x, "cash"),
    title: { en: "Cash and cash equivalents", fr: "Trésorerie et équivalents de trésorerie" },
    body: () => ({
      en: "Cash and cash equivalents include cash in hand, mobile money balances and demand and term deposits with maturities of three months or less from the date of acquisition, that are readily convertible to known amounts of cash and are subject to an insignificant risk of changes in value, net of bank overdrafts. In the statement of financial position, bank overdrafts are included in borrowings under current liabilities.",
      fr: "La trésorerie et les équivalents de trésorerie comprennent les espèces en caisse, les soldes de monnaie mobile et les dépôts à vue et à terme d'une échéance de trois mois au plus à la date d'acquisition, facilement convertibles en un montant connu de trésorerie et soumis à un risque négligeable de changement de valeur, nets des découverts bancaires. Dans l'état de la situation financière, les découverts bancaires figurent parmi les emprunts dans les passifs courants.",
    }),
  },
  {
    key: "p_provisions", kind: "policy",
    title: { en: "Provisions", fr: "Provisions" },
    body: () => ({
      en: "Provisions are recognised when {company} has a present legal or constructive obligation as a result of past events, it is probable that an outflow of resources embodying economic benefits will be required to settle the obligation, and a reliable estimate of the amount of the obligation can be made.",
      fr: "Des provisions sont comptabilisées lorsque {company} a une obligation actuelle, juridique ou implicite, résultant d'événements passés, qu'il est probable qu'une sortie de ressources représentatives d'avantages économiques sera nécessaire pour l'éteindre, et que son montant peut être estimé de façon fiable.",
    }),
  },
  {
    key: "p_impairment", kind: "policy", when: (x) => has(x, "ppe", "investment_property", "inventories", "receivables"),
    title: { en: "Impairment of assets", fr: "Dépréciation des actifs" },
    body: () => ({
      en: "At each reporting date, assets are reviewed to determine whether there is any indication that they have suffered an impairment loss. If there is such an indication, the recoverable amount of the asset is estimated and an impairment loss is recognised as an expense, unless the asset is carried at a revalued amount, in which case the impairment loss is treated as a decrease in the revaluation surplus.",
      fr: "À chaque clôture, les actifs sont examinés afin de déterminer s'il existe un indice de perte de valeur. Le cas échéant, la valeur recouvrable de l'actif est estimée et une perte de valeur est comptabilisée en charges, sauf si l'actif est comptabilisé à sa valeur réévaluée, auquel cas la perte de valeur est imputée sur l'écart de réévaluation.",
    }),
  },
  {
    key: "p_leases", kind: "policy",
    title: { en: "Leases", fr: "Contrats de location" },
    body: (x) => ({
      en: x.framework === "ifrs"
        ? "At the commencement of a lease, a right-of-use asset and a lease liability are recognised, except for short-term leases and leases of low-value assets, whose payments are recognised as an expense on a straight-line basis over the lease term. The right-of-use asset is depreciated over the lease term and interest is charged on the lease liability."
        : "Leases under which a significant portion of the risks and rewards of ownership is retained by the lessor are classified as operating leases. Payments under operating leases are charged to profit or loss on a straight-line basis over the period of the lease.",
      fr: x.framework === "ifrs"
        ? "Au début d'un contrat de location, un actif au titre du droit d'utilisation et une dette locative sont comptabilisés, sauf pour les contrats de courte durée et ceux portant sur des actifs de faible valeur, dont les paiements sont comptabilisés en charges de façon linéaire sur la durée du contrat. L'actif est amorti sur la durée du contrat et des intérêts sont comptabilisés sur la dette locative."
        : "Les contrats de location par lesquels le bailleur conserve une part importante des risques et avantages inhérents à la propriété sont des contrats de location simple. Les paiements y afférents sont comptabilisés en charges de façon linéaire sur la durée du contrat.",
    }),
  },
  {
    key: "p_vat", kind: "policy", when: (x) => x.c.vatRegistered,
    title: { en: "Value added tax", fr: "Taxe sur la valeur ajoutée" },
    body: () => ({
      en: "Revenue, expenses and assets are recognised net of value added tax. The net amount of VAT recoverable from, or payable to, the tax authority is included in receivables or payables in the statement of financial position.",
      fr: "Les produits, charges et actifs sont comptabilisés hors taxe sur la valeur ajoutée. Le montant net de TVA à récupérer auprès de l'administration fiscale, ou à lui payer, figure parmi les créances ou les dettes dans l'état de la situation financière.",
    }),
  },
  {
    key: "p_fx", kind: "policy", when: (x) => x.f.pl.other_income.accounts.some((a) => a.code === "4850") || x.f.pl.other_expenses.accounts.some((a) => a.code === "6850"),
    title: { en: "Foreign currency transactions", fr: "Opérations en devises" },
    body: () => ({
      en: "Transactions in foreign currencies during the period are converted into {currency} using the rate prevailing at the date of the transaction. Assets and liabilities expressed in foreign currencies are converted into {currency} using the rate ruling at the reporting date. The resulting gains and losses are recognised in profit or loss.",
      fr: "Les opérations en devises de la période sont converties en {currency} au cours du jour de l'opération. Les actifs et passifs libellés en devises sont convertis en {currency} au cours de clôture. Les gains et pertes qui en résultent sont comptabilisés en résultat.",
    }),
  },
  {
    key: "p_income_tax", kind: "policy", when: (x) => isCompany(x) || has(x, "income_tax", "tax_payable"),
    title: { en: "Income tax", fr: "Impôt sur le résultat" },
    body: () => ({
      en: "Tax expense is the aggregate amount included in profit or loss for the period in respect of current tax and deferred tax.\n\nCurrent tax is the amount of income tax payable or refundable in respect of the taxable profit or loss for the current and prior periods, determined in accordance with the tax laws of {country}.\n\nDeferred tax is recognised for tax recoverable or payable in future periods as a result of past transactions or events. It arises from differences (timing differences) between the carrying amounts of assets and liabilities and their corresponding tax bases, and from the carry-forward of unused tax losses. Deferred tax is measured at the tax rates that are expected to apply in the periods in which the asset is realised or the liability settled, on the basis of tax rates that have been enacted or substantively enacted by the end of the reporting period.",
      fr: "La charge d'impôt correspond au montant total comptabilisé en résultat au titre de l'impôt exigible et de l'impôt différé.\n\nL'impôt exigible est le montant de l'impôt sur le résultat dû ou remboursable au titre du bénéfice ou de la perte fiscale de la période et des périodes antérieures, déterminé selon la législation fiscale du/de {country}.\n\nL'impôt différé est comptabilisé au titre de l'impôt recouvrable ou payable au cours des périodes futures du fait de transactions ou événements passés. Il résulte des différences temporaires entre la valeur comptable des actifs et passifs et leur base fiscale, ainsi que des pertes fiscales reportables. Il est évalué aux taux d'impôt dont l'application est attendue lors de la réalisation de l'actif ou du règlement du passif, sur la base des taux adoptés ou quasi adoptés à la clôture.",
    }),
  },
  {
    key: "p_share_capital", kind: "policy", when: (x) => isCompany(x),
    title: { en: "Share capital, share premium and dividends", fr: "Capital social, primes d'émission et dividendes" },
    body: () => ({
      en: "Ordinary shares are recognised at par value and classified as share capital in equity. Any amounts received from the issue of shares in excess of par value are classified as share premium. Dividends are recognised as a liability in the period in which they are declared.",
      fr: "Les actions ordinaires sont comptabilisées à leur valeur nominale et classées en capital social dans les capitaux propres. Les montants reçus lors de l'émission d'actions au-delà de la valeur nominale sont classés en primes d'émission. Les dividendes sont comptabilisés en dettes dans la période au cours de laquelle ils sont déclarés.",
    }),
  },
  {
    key: "p_employee", kind: "policy", when: (x) => has(x, "employee_costs"),
    title: { en: "Employee benefits", fr: "Avantages du personnel" },
    body: () => ({
      en: "Salaries, wages, leave pay and other short-term benefits are recognised as an expense in the period in which the employees render the related service. Contributions to the national social security scheme are defined contribution obligations and are recognised as an expense when they fall due.",
      fr: "Les salaires, congés payés et autres avantages à court terme sont comptabilisés en charges de la période au cours de laquelle les services sont rendus. Les cotisations au régime national de sécurité sociale sont des obligations à cotisations définies, comptabilisées en charges à leur échéance.",
    }),
  },
  {
    key: "p_judgements", kind: "policy",
    title: { en: "Judgements and key sources of estimation uncertainty", fr: "Jugements et principales sources d'incertitude" },
    body: () => ({
      en: "Preparing financial statements requires estimates and judgements that affect the amounts reported. The main ones relate to the useful lives and residual values of property, plant and equipment and to the recoverability of receivables. Estimates are reviewed regularly and any revision is recognised in the period in which it is made. [State here if no significant judgements had to be made.]",
      fr: "L'établissement des états financiers requiert des estimations et des jugements qui affectent les montants présentés. Les principaux portent sur la durée d'utilité et la valeur résiduelle des immobilisations corporelles et sur le caractère recouvrable des créances. Les estimations sont revues régulièrement et toute révision est comptabilisée dans la période où elle intervient. [Indiquez ici si aucun jugement important n'a été nécessaire.]",
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

  // ---------------- risk, fair value and capital (as audited statements in Rwanda set them out) ----------------
  {
    key: "n_financial_risk", kind: "note", when: (x) => has(x, "receivables", "payables", "loans", "cash"),
    title: { en: "Financial risk management objectives and policies", fr: "Objectifs et politique de gestion des risques financiers" },
    body: (x) => ({
      en: `The activities of {company} expose it to a variety of financial risks, including credit, liquidity and market risks. Risk management is carried out by management under policies approved by the ${governing(x).en}. These policies aim to minimise the potential adverse effects of such risks on performance by setting acceptable levels of risk. {company} has not hedged against any risks in the current period.\n\nMarket risk\nMarket risk is the risk that the fair value or future cash flows of financial instruments will fluctuate because of changes in market variables such as interest rates, foreign exchange rates and prices.\n\n(i) Interest rate risk\nInterest rate risk is the risk that future profitability or cash flows will fluctuate because of changes in market interest rates. ${has(x, "loans") ? "{company} is exposed to interest rate risk on its borrowings. [Describe whether rates are fixed or variable.]" : "{company} did not have any interest-bearing instruments and was not exposed to interest rate risk."}\n\n(ii) Foreign exchange risk\nForeign exchange risk arises from future transactions and from recognised assets and liabilities in foreign currencies. [State whether {company} had transactions in foreign currencies during the period.]\n\n(iii) Price risk\nPrice risk arises from fluctuations in the prices of goods and services purchased, which are set by market forces outside the control of {company}. [Describe the effect of price changes on operations.]\n\n(iv) Credit risk\nCredit risk is the risk of financial loss if a counterparty fails to meet its contractual obligations. The largest concentrations of credit exposure arise from receivables and from cash and bank balances. [State whether management considers the exposure significant.]\n\n(v) Liquidity risk\nLiquidity risk is the risk that {company} will have difficulty meeting the obligations of its financial liabilities. The approach to managing liquidity is to ensure, as far as possible, that there will always be sufficient liquidity to meet liabilities when due, under both normal and stressed conditions, without incurring unacceptable losses or risking damage to its reputation.`,
      fr: `Les activités de {company} l'exposent à divers risques financiers, notamment les risques de crédit, de liquidité et de marché. La gestion des risques est assurée par la direction selon des politiques approuvées par les ${governing(x).fr}, qui visent à limiter les effets défavorables de ces risques en fixant des niveaux de risque acceptables. {company} n'a pas eu recours à la couverture au cours de la période.\n\nRisque de marché\nLe risque de marché est le risque que la juste valeur ou les flux de trésorerie futurs des instruments financiers varient en raison de l'évolution des taux d'intérêt, des cours de change et des prix.\n\n(i) Risque de taux d'intérêt\nC'est le risque que la rentabilité ou les flux de trésorerie futurs varient avec les taux d'intérêt du marché. ${has(x, "loans") ? "{company} est exposée au risque de taux sur ses emprunts. [Précisez si les taux sont fixes ou variables.]" : "{company} ne détenait aucun instrument portant intérêt et n'était pas exposée au risque de taux."}\n\n(ii) Risque de change\nLe risque de change résulte des transactions futures et des actifs et passifs comptabilisés en devises. [Indiquez si {company} a réalisé des opérations en devises au cours de la période.]\n\n(iii) Risque de prix\nLe risque de prix résulte des variations des prix des biens et services achetés, fixés par le marché hors du contrôle de {company}. [Décrivez l'effet des variations de prix sur l'activité.]\n\n(iv) Risque de crédit\nC'est le risque de perte financière si une contrepartie ne respecte pas ses obligations contractuelles. Les principales concentrations proviennent des créances et des soldes de trésorerie. [Indiquez si la direction juge l'exposition significative.]\n\n(v) Risque de liquidité\nC'est le risque que {company} éprouve des difficultés à honorer ses passifs financiers. Sa gestion vise à disposer en permanence, autant que possible, de liquidités suffisantes pour faire face à ses échéances, en situation normale comme en situation de crise, sans pertes inacceptables ni atteinte à sa réputation.`,
    }),
  },
  {
    key: "n_fair_value", kind: "note", when: (x) => has(x, "receivables", "payables", "loans"),
    title: { en: "Fair value", fr: "Juste valeur" },
    body: (x) => ({
      en: `In the opinion of the ${governing(x).en}, the carrying amounts of the financial assets and liabilities of {company} in the statement of financial position approximate their fair values.`,
      fr: `De l'avis des ${governing(x).fr}, la valeur comptable des actifs et passifs financiers de {company} figurant dans l'état de la situation financière avoisine leur juste valeur.`,
    }),
  },
  {
    key: "n_capital_management", kind: "note", when: (x) => isCompany(x) || x.c.orgType === "cooperative",
    title: { en: "Capital management", fr: "Gestion du capital" },
    body: () => ({
      en: "{company} manages its capital to ensure that it will be able to continue as a going concern while maximising the return to its shareholders through the optimisation of the balance between debt and equity.",
      fr: "{company} gère son capital de manière à pouvoir poursuivre son exploitation tout en maximisant le rendement pour ses actionnaires par l'optimisation de l'équilibre entre dettes et capitaux propres.",
    }),
  },

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
