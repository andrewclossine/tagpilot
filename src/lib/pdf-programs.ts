import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { TenderStage } from "@/db/schema";
import type { Ctx } from "./auth";
import { canSeeVoucher } from "./access";
import { isUuid, money as fmtMoney } from "./format";
import { getI18n } from "./i18n";
import { UserError } from "./ledger";
import { letterPdf, voucherPdf, type LetterPdfData } from "./pdf";
import { printedCompany } from "./pdf-data";
import { executionOn } from "./programs";
import { supplierCanSee, supplierSeesStage } from "./procurement";

/** The payment voucher as a PDF. Staff can only print their own. */
export async function buildVoucherPdf(ctx: Ctx, id: string) {
  if (!isUuid(id)) throw new UserError("err_not_found");
  const { t, lang } = await getI18n();
  const db = await getDb();
  const [row] = await db.select({ v: schema.paymentVouchers, project: schema.projects, line: schema.logframeItems }).from(schema.paymentVouchers)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.paymentVouchers.projectId))
    .innerJoin(schema.logframeItems, eq(schema.logframeItems.id, schema.paymentVouchers.budgetItemId))
    .where(and(eq(schema.paymentVouchers.id, id), eq(schema.paymentVouchers.companyId, ctx.company.id)));
  if (!row || !canSeeVoucher(ctx, row.v)) throw new UserError("err_not_found");
  const { v, project, line } = row;
  // By the people named on the voucher, so someone who has since left is still shown.
  const names = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users)
    .where(inArray(schema.users.id, [v.requestedBy, v.decidedBy, v.paidBy].filter((u): u is string => !!u)));
  const who = (uid: string | null) => names.find((n) => n.id === uid)?.name ?? "";
  // A draft shows the line as it stands now; from submission on, the figures frozen on the voucher.
  const draft = v.status === "draft";
  const pdf = await voucherPdf({
    company: await printedCompany(ctx), lang,
    labels: {
      title: t("pv_voucher"), number: t("number"), date: t("date"), status: t("status"), project: t("project"), line: t("pv_budget_line"), payee: t("pv_payee"),
      amountRequested: t("pv_amount_requested"), activityBudget: t("pv_activity_budget"), previousExecution: t("pv_previous_execution"), totalExecution: t("pv_total_execution"),
      balance: t("balance_left"), description: t("pv_description"), requestedBy: t("pv_requested_by"), approvedBy: t("pv_approved_by"), paidBy: t("pv_paid_by"), signature: t("pv_signature"), footer: t("pdf_footer"),
    },
    voucher: {
      number: v.number, date: v.date, status: t(`vs_${v.status}`), amount: v.amount, description: v.description, payee: v.payee,
      activityBudget: draft ? line.budget : v.activityBudget,
      previousExecution: draft ? await executionOn(db, v.budgetItemId, v.id) : v.previousExecution,
    },
    project: `${project.code} - ${project.name}`, line: `${line.code} ${line.title}`,
    requestedBy: who(v.requestedBy), approvedBy: v.status === "rejected" ? "" : who(v.decidedBy), paidBy: who(v.paidBy),
  });
  return { pdf, filename: `${v.number}.pdf` };
}

/** A procurement document. Staff need procurement access; a supplier gets what the portal shows them, and never the opening or evaluation records. */
export async function buildTenderPdf(ctx: Ctx, id: string, stageParam: string | null) {
  if (!isUuid(id)) throw new UserError("err_not_found");
  const { t, lang } = await getI18n();
  const db = await getDb();
  const [tender] = await db.select().from(schema.tenders).where(and(eq(schema.tenders.id, id), eq(schema.tenders.companyId, ctx.company.id)));
  if (!tender) throw new UserError("err_not_found");
  const supplier = ctx.role === "supplier" ? ctx.partnerId : null;
  if (ctx.role === "supplier" ? !supplier : !ctx.can("procurement")) throw new UserError("err_not_found");
  const [mine] = supplier ? await db.select().from(schema.bids).where(and(eq(schema.bids.tenderId, id), eq(schema.bids.partnerId, supplier))) : [];
  if (supplier && !mine && !(await supplierCanSee(db, tender, supplier))) throw new UserError("err_not_found");
  const footer = t("pdf_footer"), company = await printedCompany(ctx);
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
  if (!st || (supplier && !supplierSeesStage(stage, mine))) throw new UserError("err_not_found");
  let columns: LetterPdfData["columns"], rows: LetterPdfData["rows"];
  if (!supplier && (stage === "opening" || stage === "evaluation")) {
    const bids = await db.select({ b: schema.bids, name: schema.partners.name }).from(schema.bids)
      .innerJoin(schema.partners, eq(schema.partners.id, schema.bids.partnerId)).where(eq(schema.bids.tenderId, id));
    if (stage === "opening") {
      columns = [{ label: t("supplier"), width: 345 }, { label: `${t("amount")} (${ctx.company.currency})`, width: 150, align: "right" }];
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
