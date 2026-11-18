import "server-only";
import PDFDocument from "pdfkit";
import { NOTE_FOR_LINE, numberNotes, tOf, type FsFigures, type FsLine, type LineFigures, type Pair } from "./fs";
import { fillTokens } from "./fs-templates";
import type { schema } from "@/db";

type Draft = typeof schema.fsDrafts.$inferSelect;
type Note = typeof schema.fsNotes.$inferSelect;
type Company = { name: string; currency: string; registrationNo: string; tin: string; logo: Buffer | null };

const INK = "#1b2430", MUTED = "#6b7684", LINE = "#c9d1db";
const L = 50, R = 545, W = R - L;

/** The whole set of financial statements as one PDF, laid out like printed annual financial statements. */
export function fsPdf(d: Draft, notes: Note[], f: FsFigures, c: Company, tokens: Record<string, string>): Promise<Buffer> {
  const t = tOf(d.lang);
  const cols = d.comparative ? 2 : 1;
  const heads = [d.periodTo.slice(0, 4), f.pTo.slice(0, 4)];
  const { byId, byKey } = numberNotes(notes);
  const ref = (line: FsLine) => { const k = NOTE_FOR_LINE[line]; return k ? byKey.get(k) ?? "" : ""; };
  const fmt = (n: number | null) => {
    if (n === null) return "";
    const r = Math.round(n);
    if (!r) return "-";
    const s = Math.abs(r).toLocaleString(d.lang === "fr" ? "fr-FR" : "en-US").replace(/[  ]/g, " ");
    return r < 0 ? `(${s})` : s;
  };

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true, info: { Title: d.title, Producer: "TAGPILOT", Creator: "TAGPILOT" } });
    const chunks: Buffer[] = [];
    doc.on("data", (b: Buffer) => chunks.push(b));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const room = (h: number) => { if (doc.y + h > doc.page.height - 70) doc.addPage(); };
    const title = (text: string, sub?: string) => {
      doc.font("Helvetica-Bold").fontSize(15).fillColor(INK).text(text, L, doc.y, { width: W });
      if (sub) doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(sub, { width: W });
      doc.moveDown(0.8);
    };
    // Columns: label, note, this year, last year.
    const xNote = 330, xCur = cols === 2 ? 375 : 455, xPrev = 465, wNum = 80;
    const tableHead = (withNote = true) => {
      room(30);
      const y = doc.y;
      doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED);
      if (withNote) doc.text(t("fs_note"), xNote, y, { width: 40 });
      doc.text(heads[0], xCur, y, { width: wNum, align: "right" });
      if (cols === 2) doc.text(heads[1], xPrev, y, { width: wNum, align: "right" });
      doc.moveTo(L, y + 12).lineTo(R, y + 12).lineWidth(0.5).strokeColor(LINE).stroke();
      doc.y = y + 16;
    };
    const row = (label: string, v: Pair | null, opts: { note?: string; bold?: boolean; indent?: boolean; head?: boolean; neg?: boolean } = {}) => {
      room(16);
      const y = doc.y, s = opts.neg ? -1 : 1;
      doc.font(opts.bold || opts.head ? "Helvetica-Bold" : "Helvetica").fontSize(9).fillColor(INK);
      doc.text(label, L + (opts.indent ? 12 : 0), y, { width: xNote - L - 14 - (opts.indent ? 12 : 0) });
      const h = doc.y - y;
      if (opts.note) doc.font("Helvetica").fillColor(MUTED).text(opts.note, xNote, y, { width: 40 });
      if (v) {
        doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica").fillColor(INK);
        doc.text(fmt(v[0] * s), xCur, y, { width: wNum, align: "right" });
        if (cols === 2) doc.text(fmt(v[1] === null ? null : v[1] * s), xPrev, y, { width: wNum, align: "right" });
        if (opts.bold) doc.moveTo(xCur, y - 2).lineTo(R, y - 2).lineWidth(0.5).strokeColor(LINE).stroke();
      }
      doc.y = y + Math.max(h, 12) + (opts.head ? 4 : 2);
    };
    const lines = (ls: FsLine[], neg = false) => ls.map((l) => f.lineOf(l)).filter((g): g is LineFigures => !!g && (!!g.v[0] || !!g.v[1]))
      .forEach((g) => row(t(`fs_line_${g.line}` as never), g.v, { note: ref(g.line), indent: true, neg }));
    const text = (s: string) => { doc.font("Helvetica").fontSize(9.5).fillColor(INK).text(s, L, doc.y, { width: W, lineGap: 2 }); doc.moveDown(0.6); };

    // ---- cover
    if (c.logo) { try { doc.image(c.logo, L + W / 2 - 75, 150, { fit: [150, 70], align: "center" }); } catch { /* the name stands */ } }
    doc.font("Helvetica-Bold").fontSize(24).fillColor(INK).text(c.name, L, 260, { width: W, align: "center" });
    doc.moveDown(0.6).font("Helvetica").fontSize(14).text(t("fs_cover_title").replace("{date}", d.periodTo), { width: W, align: "center" });
    doc.moveDown(0.6).fontSize(10).fillColor(MUTED).text(`${t(d.framework === "ifrs" ? "fs_fw_ifrs" : "fs_fw_sme")} · ${c.currency}`, { width: W, align: "center" });
    if (c.registrationNo) doc.text(`${t("co_reg")}: ${c.registrationNo}`, { width: W, align: "center" });
    if (c.tin) doc.text(`TIN: ${c.tin}`, { width: W, align: "center" });

    // ---- contents
    doc.addPage(); title(t("fs_contents"));
    const reports = notes.filter((n) => n.kind === "report" && n.included);
    [...reports.map((r) => r.title), t("fs_sofp"), t("fs_pl"), t("fs_soce"), t("fs_cf"), t("fs_policies"), t("fs_notes"), t("fs_detailed")]
      .forEach((s, i) => { doc.font("Helvetica").fontSize(10).fillColor(INK).text(`${i + 1}.  ${s}`, L, doc.y, { width: W }); doc.moveDown(0.4); });

    // ---- reports
    if (reports.length) {
      doc.addPage();
      for (const n of reports) { room(60); title(n.title); text(fillTokens(n.body, tokens)); doc.moveDown(0.6); }
    }

    // ---- statement of financial position
    doc.addPage(); title(t("fs_sofp"), t("fs_as_at").replace("{date}", d.periodTo)); tableHead();
    row(t("assets"), null, { head: true });
    row(t("r_non_current_assets"), null, { head: true }); lines(["ppe", "investment_property", "biological", "other_non_current_assets"]);
    row(t("r_total_non_current_assets"), f.nonCurrentAssets, { bold: true });
    row(t("r_current_assets"), null, { head: true }); lines(["inventories", "receivables", "other_current_assets", "cash"]);
    row(t("r_total_current_assets"), f.currentAssets, { bold: true });
    row(t("r_total_assets"), f.totalAssets, { bold: true });
    doc.moveDown(0.6);
    row(t("fs_equity_liabilities"), null, { head: true });
    row(t("equity"), null, { head: true });
    f.equity.forEach((r) => row(r.name, r.v, { note: byKey.get("n_equity"), indent: true }));
    row(f.retained.name, f.retained.v, { note: byKey.get("n_equity"), indent: true });
    row(t("r_total_equity"), f.equityTotal, { bold: true });
    if (f.nonCurrentLiabilities[0] || f.nonCurrentLiabilities[1]) {
      row(t("r_non_current_liabilities"), null, { head: true }); lines(["loans", "deferred_income", "other_non_current_liabilities"]);
      row(t("r_total_non_current_liabilities"), f.nonCurrentLiabilities, { bold: true });
    }
    if (f.currentLiabilities[0] || f.currentLiabilities[1]) {
      row(t("r_current_liabilities"), null, { head: true }); lines(["payables", "tax_payable", "other_current_liabilities"]);
      row(t("r_total_current_liabilities"), f.currentLiabilities, { bold: true });
    }
    row(t("r_total_liabilities"), f.totalLiabilities, { bold: true });
    row(t("total_le"), f.totalEquityLiabilities, { bold: true });

    // ---- profit or loss
    doc.addPage(); title(t("fs_pl"), t("fs_for_period").replace("{from}", d.periodFrom).replace("{to}", d.periodTo)); tableHead();
    lines(["revenue", "grants"]); lines(["cost_of_sales"], true);
    if (f.pl.cost_of_sales.v[0] || f.pl.cost_of_sales.v[1]) row(t("r_gross_profit"), f.gross, { bold: true });
    lines(["other_income"]); lines(["employee_costs", "depreciation", "other_expenses"], true);
    row(t("fs_operating_profit"), f.operating, { bold: true });
    lines(["finance_costs"], true);
    row(t("fs_before_tax"), f.beforeTax, { bold: true });
    lines(["income_tax"], true);
    row(t("fs_profit"), f.profit, { bold: true });

    // ---- changes in equity: as many columns as there are capital accounts, plus the total
    doc.addPage(); title(t("fs_soce"));
    const names = [...f.soce.columns, t("total")];
    const labelW = 150, colW = Math.min(90, (W - labelW) / names.length);
    const soceRow = (label: string, v: number[] | null, bold = false) => {
      room(16);
      const y = doc.y;
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor(INK).text(label, L, y, { width: labelW - 6 });
      const h = doc.y - y;
      if (v) [...v, v.reduce((s, x) => s + x, 0)].forEach((x, i) => doc.text(fmt(x), L + labelW + i * colW, y, { width: colW - 4, align: "right" }));
      doc.y = y + Math.max(h, 12) + 2;
    };
    { const y = doc.y; doc.font("Helvetica-Bold").fontSize(7.5).fillColor(MUTED); names.forEach((n, i) => doc.text(n, L + labelW + i * colW, y, { width: colW - 4, align: "right" })); doc.y = y + 28; }
    for (const p of f.soce.periods) {
      soceRow(t("fs_year_to").replace("{date}", p.label), null, true);
      soceRow(t("fs_balance_start"), p.opening, true); soceRow(t("fs_profit"), p.result); soceRow(t("fs_other_movements"), p.other); soceRow(t("fs_balance_end"), p.closing, true);
      doc.moveDown(0.5);
    }

    // ---- cash flows
    doc.addPage(); title(t("fs_cf"), t("fs_for_period").replace("{from}", d.periodFrom).replace("{to}", d.periodTo)); tableHead(false);
    for (const r of f.cf) {
      if (r.style === "head") row(r.label, null, { head: true });
      else row(r.label, r.v, { bold: r.style === "sub" || r.style === "total", indent: r.style === "line" });
    }

    // ---- policies and notes
    const noteFigures = (figures: string | null) => {
      if (!figures) return;
      if (figures === "ppe") {
        if (!f.ppe.length) return;
        const cw = [80, 95, 80, 80], x0 = L + 150;
        room(30);
        { const y = doc.y; doc.font("Helvetica-Bold").fontSize(7.5).fillColor(MUTED);
          [t("fs_cost"), t("fs_accum_dep"), `${t("fs_carrying")} ${heads[0]}`, ...(cols === 2 ? [`${t("fs_carrying")} ${heads[1]}`] : [])]
            .forEach((h, i) => doc.text(h, x0 + cw.slice(0, i).reduce((s, w) => s + w, 0), y, { width: cw[i] - 4, align: "right" }));
          doc.y = y + 22; }
        const pr = (label: string, v: (number | null)[], bold = false) => {
          room(14); const y = doc.y;
          doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor(INK).text(label, L, y, { width: 145 });
          v.forEach((x, i) => doc.text(fmt(x), x0 + cw.slice(0, i).reduce((s, w) => s + w, 0), y, { width: cw[i] - 4, align: "right" }));
          doc.y = Math.max(doc.y, y + 12) + 2;
        };
        f.ppe.forEach((p) => pr(p.name, [p.cost[0], p.accumulated[0], p.carrying[0], ...(cols === 2 ? [p.carrying[1]] : [])]));
        pr(t("total"), [f.ppe.reduce((s, p) => s + p.cost[0], 0), f.ppe.reduce((s, p) => s + p.accumulated[0], 0), f.ppe.reduce((s, p) => s + p.carrying[0], 0), ...(cols === 2 ? [f.ppe.reduce((s, p) => s + (p.carrying[1] ?? 0), 0)] : [])], true);
        doc.moveDown(0.6);
        return;
      }
      const rows = figures === "equity" ? [...f.equity, f.retained] : f.lineOf(figures as FsLine)?.accounts ?? [];
      if (!rows.length) return;
      tableHead(false);
      rows.forEach((r) => row(r.name, r.v, { indent: true }));
      row(t("total"), figures === "equity" ? f.equityTotal : f.lineOf(figures as FsLine)!.v, { bold: true });
      doc.moveDown(0.6);
    };
    doc.addPage(); title(`1. ${t("fs_policies")}`);
    for (const n of notes.filter((x) => x.kind === "policy" && x.included)) {
      room(50);
      doc.font("Helvetica-Bold").fontSize(10.5).fillColor(INK).text(`${byId.get(n.id) ?? ""} ${n.title}`, L, doc.y, { width: W }); doc.moveDown(0.3);
      if (n.body) text(fillTokens(n.body, tokens));
    }
    doc.addPage(); title(t("fs_notes"));
    for (const n of notes.filter((x) => x.kind === "note" && x.included)) {
      room(70);
      doc.font("Helvetica-Bold").fontSize(10.5).fillColor(INK).text(`${byId.get(n.id) ?? ""}. ${n.title}`, L, doc.y, { width: W }); doc.moveDown(0.3);
      if (n.body) text(fillTokens(n.body, tokens));
      noteFigures(n.figures);
      doc.moveDown(0.3);
    }

    // ---- detailed income statement
    doc.addPage(); title(t("fs_detailed"), t("fs_detailed_help")); tableHead(false);
    for (const g of f.detailed) {
      row(t(`fs_line_${g.line}` as never), null, { head: true });
      g.accounts.forEach((a) => row(`${a.code} ${a.name}`, a.v, { indent: true }));
      row(t("total"), g.v, { bold: true });
    }
    row(t("fs_profit"), f.profit, { bold: true });

    // ---- running footer: the organisation and the page number, on every page but the cover
    const range = doc.bufferedPageRange();
    for (let i = 1; i < range.count; i++) {
      doc.switchToPage(i);
      const bottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font("Helvetica").fontSize(7.5).fillColor(MUTED)
        .text(`${c.name} · ${d.title}`, L, doc.page.height - 35, { width: W / 2, lineBreak: false })
        .text(`${i + 1}`, L + W / 2, doc.page.height - 35, { width: W / 2, align: "right", lineBreak: false });
      doc.page.margins.bottom = bottom;
    }
    doc.end();
  });
}
