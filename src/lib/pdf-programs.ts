import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { TenderStage } from "@/db/schema";
import type { Ctx } from "./auth";
import { canSeeVoucher } from "./access";
import { advertFor } from "./bidding";
import { isUuid, money as fmtMoney } from "./format";
import { getI18n } from "./i18n";
import { UserError } from "./ledger";
import { letterPdf, voucherPdf, type LetterPdfData } from "./pdf";
import { printedCompany } from "./pdf-data";
import { executionOn } from "./programs";
import { supplierCanSee, supplierSeesStage } from "./procurement";

/** The fund request as a PDF. Staff can only print their own. */
export async function buildVoucherPdf(ctx: Ctx, id: string) {
  if (!isUuid(id)) throw new UserError("err_not_found");
  const { t, lang } = await getI18n();
  const db = await getDb();
  const [row] = await db.select({ v: schema.paymentVouchers, project: schema.projects }).from(schema.paymentVouchers)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.paymentVouchers.projectId))
    .where(and(eq(schema.paymentVouchers.id, id), eq(schema.paymentVouchers.companyId, ctx.company.id)));
  if (!row || !canSeeVoucher(ctx, row.v)) throw new UserError("err_not_found");
  const { v, project } = row;
  const rows = await db.select({ l: schema.voucherLines, item: schema.logframeItems }).from(schema.voucherLines)
    .innerJoin(schema.logframeItems, eq(schema.logframeItems.id, schema.voucherLines.budgetItemId)).where(eq(schema.voucherLines.voucherId, id)).orderBy(schema.voucherLines.lineNo);
  const steps = await db.select({ s: schema.voucherSteps, name: schema.users.name }).from(schema.voucherSteps)
    .innerJoin(schema.users, eq(schema.users.id, schema.voucherSteps.userId)).where(eq(schema.voucherSteps.voucherId, id));
  // A draft shows each line as it stands now; from preparation on, the figures frozen on the request.
  const draft = v.status === "draft";
  const lines = await Promise.all(rows.map(async ({ l, item }) => ({
    code: item.taskCode || item.code, title: item.title, amount: l.amount,
    budget: draft ? item.budget : l.activityBudget, previous: draft ? await executionOn(db, l.budgetItemId, v.id) : l.previousExecution,
  })));
  const pdf = await voucherPdf({
    company: await printedCompany(ctx), lang,
    labels: {
      title: t("pv_voucher"), number: t("pv_fr_no"), date: t("date"), status: t("status"), project: t("project"), line: t("pv_budget_line"), payee: t("pv_payee"),
      amountRequested: t("pv_amount_requested"), activityBudget: t("pv_activity_budget"), previousExecution: t("pv_previous_execution"), totalExecution: t("pv_total_execution"),
      balance: t("balance_left"), description: t("pv_description"), signature: t("pv_signature"), total: t("total"), footer: t("pdf_footer"),
    },
    voucher: { number: v.number, date: v.date, status: t(`vs_${v.status}`), amount: v.amount, description: v.description, payee: v.payee },
    project: `${project.code} - ${project.name}`, lines,
    signatures: (["prepared", "reviewed", "approved", "authorized"] as const).map((s) => {
      const done = steps.find((x) => x.s.step === s);
      return { label: t(`step_${s}`), name: done?.name ?? "", at: done ? done.s.at.toISOString().slice(0, 10) : "" };
    }),
  });
  return { pdf, filename: `${v.number.replace(/[^A-Za-z0-9-]/g, "-")}.pdf` };
}

/** A procurement document. Staff need procurement access; a supplier gets what the portal shows them, and never the opening or evaluation records. */
export async function buildTenderPdf(ctx: Ctx, id: string, stageParam: string | null) {
  if (!isUuid(id)) throw new UserError("err_not_found");
  const { t, lang } = await getI18n();
  const db = await getDb();
  const [tender] = await db.select().from(schema.tenders).where(eq(schema.tenders.id, id));
  if (!tender) throw new UserError("err_not_found");
  // Three kinds of reader: the organisation's own people, its invited suppliers, and supplier organisations bidding on an advert.
  const own = tender.companyId === ctx.company.id;
  const supplier = own && ctx.role === "supplier" ? ctx.partnerId : null;
  let mine: typeof schema.bids.$inferSelect | undefined;
  let printed = ctx.company;
  if (!own) {
    const ad = ctx.can("bidding") ? await advertFor(db, ctx, id) : null;
    if (!ad) throw new UserError("err_not_found");
    mine = ad.bid; printed = ad.buyer;
  } else if (ctx.role === "supplier") {
    if (!supplier) throw new UserError("err_not_found");
    [mine] = await db.select().from(schema.bids).where(and(eq(schema.bids.tenderId, id), eq(schema.bids.partnerId, supplier)));
    if (!mine && !(await supplierCanSee(db, tender, supplier))) throw new UserError("err_not_found");
  } else if (!ctx.can("procurement")) throw new UserError("err_not_found");
  const outsider = !own || !!supplier;
  const footer = t("pdf_footer"), company = await printedCompany({ company: printed });
  const stage = stageParam as TenderStage | null;
  const amount = (n: number) => fmtMoney(n, lang, 2).replace(/[  ]/g, " ");

  if (!stage) {
    const pdf = await letterPdf({
      company, title: t(tender.kind === "rfq" ? "tn_rfq" : "tn_tender"), subject: tender.title, footer,
      lines: [[t("number"), tender.number], [t("tn_deadline"), tender.deadline ? `${tender.deadline.toISOString().slice(0, 16).replace("T", " ")} UTC` : "-"]],
      body: [tender.description, tender.requirements ? `${t("tn_requirements")}:\n${tender.requirements}` : ""].filter(Boolean).join("\n\n"),
    });
    return { pdf, filename: `${tender.number}.pdf` };
  }

  const [st] = await db.select().from(schema.tenderStages).where(and(eq(schema.tenderStages.tenderId, id), eq(schema.tenderStages.stage, stage)));
  if (!st || (outsider && !supplierSeesStage(stage, mine))) throw new UserError("err_not_found");
  let columns: LetterPdfData["columns"], rows: LetterPdfData["rows"];
  if (!outsider && (stage === "opening" || stage === "evaluation")) {
    const bids = await db.select({ b: schema.bids, name: schema.partners.name }).from(schema.bids)
      .innerJoin(schema.partners, eq(schema.partners.id, schema.bids.partnerId)).where(eq(schema.bids.tenderId, id));
    if (stage === "opening") {
      columns = [{ label: t("supplier"), width: 345 }, { label: `${t("amount")} (${printed.currency})`, width: 150, align: "right" }];
      rows = bids.sort((a, b) => a.name.localeCompare(b.name)).map(({ b, name }) => [name, amount(b.amount)]);
    } else {
      columns = [
        { label: t("supplier"), width: 165 }, { label: t("amount"), width: 95, align: "right" }, { label: t("tn_tech"), width: 60, align: "right" },
        { label: t("tn_fin"), width: 60, align: "right" }, { label: t("total"), width: 60, align: "right" }, { label: t("tn_rank"), width: 55, align: "right" },
      ];
      rows = bids.sort((a, b) => (a.b.rank ?? 999) - (b.b.rank ?? 999)).map(({ b, name }) => [
        `${name}${b.isWinner ? " *" : ""}`, amount(b.amount), String(b.technicalScore ?? ""), String(b.financialScore ?? ""), String(b.totalScore ?? ""), b.rank ? String(b.rank) : "-",
      ]);
    }
  }
  const pdf = await letterPdf({
    company, title: t(`stage_${stage}`), subject: `${tender.number} - ${tender.title}`, footer,
    lines: [[t("number"), tender.number], [t("date"), st.date]], body: st.body, columns, rows,
  });
  return { pdf, filename: `${tender.number}-${stage}.pdf` };
}
