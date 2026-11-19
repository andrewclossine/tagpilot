import "server-only";
import PDFDocument from "pdfkit";
import { NOTE_FOR_LINE, numberNotes, SIGNED_REPORTS, signersOf, tOf, type FsFigures, type FsLine, type LineFigures, type Pair } from "./fs";
import { fillTokens } from "./fs-templates";
import type { schema } from "@/db";

type Draft = typeof schema.fsDrafts.$inferSelect;
type Note = typeof schema.fsNotes.$inferSelect;
type Company = { name: string; currency: string; registrationNo: string; tin: string; logo: Buffer | null; orgType: string; place: string };

const INK = "#1b2430", MUTED = "#6b7684", LINE = "#c9d1db";
// Normal margins, as in a word processor: one inch (72 points) on every side of an A4 page.
const MARGIN = 72;
const L = MARGIN, R = 595.28 - MARGIN, W = R - L;
// The writing: size 12, justified, with 1.5 line spacing (Helvetica has the same letter widths as Arial).
const BODY_SIZE = 12, BODY_GAP = BODY_SIZE * 0.6;

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
    const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true, info: { Title: d.title, Producer: "TAGPILOT", Creator: "TAGPILOT" } });
    const chunks: Buffer[] = [];
    doc.on("data", (b: Buffer) => chunks.push(b));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const room = (h: number) => { if (doc.y + h > doc.page.height - 70) doc.addPage(); };
    // The printed page number of where the writing is now (the cover is page 1).
    const pageNow = () => { const r = doc.bufferedPageRange(); return r.start + r.count; };
    const contents: { label: string; page: number }[] = [];
    const mark = (label: string) => contents.push({ label, page: pageNow() });
    const title = (text: string, sub?: string) => {
      doc.font("Helvetica-Bold").fontSize(15).fillColor(INK).text(text, L, doc.y, { width: W });
      if (sub) doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(sub, { width: W });
      doc.moveDown(0.8);
    };
    // Columns: label, note, this year, last year.
    const wNum = 80, xPrev = R - wNum, xCur = cols === 2 ? xPrev - wNum - 10 : xPrev, xNote = xCur - 45;
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
    const text = (s: string) => { doc.font("Helvetica").fontSize(BODY_SIZE).fillColor(INK).text(s, L, doc.y, { width: W, align: "justify", lineGap: BODY_GAP, paragraphGap: BODY_GAP }); doc.moveDown(0.4); };
    // Signature lines: a dotted line to sign on, then the name, position, place and date, side by side.
    const signers = signersOf(d.approvedBy, c.orgType, d.lang);
    const signatures = (intro: string) => {
      const perRow = Math.min(3, signers.length), w = W / perRow;
      room(30 + Math.ceil(signers.length / perRow) * 85);
      doc.moveDown(0.6);
      doc.font("Helvetica").fontSize(9).fillColor(INK).text(intro, L, doc.y, { width: W });
      doc.moveDown(0.4);
      for (let i = 0; i < signers.length; i += perRow) {
        room(85);
        const y = doc.y + 34;
        signers.slice(i, i + perRow).forEach((sg, k) => {
          const x = L + k * w;
          doc.moveTo(x, y).lineTo(x + w - 30, y).dash(1.5, { space: 2 }).lineWidth(0.7).strokeColor(INK).stroke().undash();
          doc.font("Helvetica-Bold").fontSize(9).fillColor(INK).text(sg.name || " ", x, y + 5, { width: w - 30 });
          doc.font("Helvetica").fontSize(8.5).fillColor(MUTED).text(sg.position, x, y + 17, { width: w - 30 });
          doc.text(`${c.place ? `${c.place}, ` : ""}${t("fs_sig_date")}: ${d.approvedOn ?? "………………"}`, x, y + 28, { width: w - 30 });
        });
        doc.x = L; doc.y = y + 48;
      }
    };

    // ---- cover
    if (c.logo) { try { doc.image(c.logo, L + W / 2 - 75, 150, { fit: [150, 70], align: "center" }); } catch { /* the name stands */ } }
    doc.font("Helvetica-Bold").fontSize(24).fillColor(INK).text(c.name, L, 260, { width: W, align: "center" });
    doc.moveDown(0.6).font("Helvetica").fontSize(14).text(t("fs_cover_title").replace("{date}", d.periodTo), { width: W, align: "center" });
    doc.moveDown(0.6).fontSize(10).fillColor(MUTED).text(`${t(d.framework === "ifrs" ? "fs_fw_ifrs" : "fs_fw_sme")} · ${c.currency}`, { width: W, align: "center" });
    if (c.registrationNo) doc.text(`${t("co_reg")}: ${c.registrationNo}`, { width: W, align: "center" });
    if (c.tin) doc.text(`TIN: ${c.tin}`, { width: W, align: "center" });

    // ---- contents
    doc.addPage();
    const contentsPage = pageNow() - 1; // 0-based, for switchToPage
    const reports = notes.filter((n) => n.kind === "report" && n.included);

    // ---- reports
    if (reports.length) {
      doc.addPage();
      reports.forEach((n, i) => {
        room(60); mark(n.title); title(n.title); text(fillTokens(n.body, tokens));
        if (SIGNED_REPORTS[n.key]) {
          signatures(t(SIGNED_REPORTS[n.key]));
          // The signatures are the last thing on their page.
          if (i < reports.length - 1) doc.addPage();
        } else doc.moveDown(0.8);
      });
    }

    // ---- statement of financial position
    doc.addPage(); mark(t("fs_sofp")); title(t("fs_sofp"), t("fs_as_at").replace("{date}", d.periodTo)); tableHead();
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
    signatures(t("fs_sofp_approved").replace("{date}", d.approvedOn ?? "………………"));

    // ---- profit or loss
    doc.addPage(); mark(t("fs_pl")); title(t("fs_pl"), t("fs_for_period").replace("{from}", d.periodFrom).replace("{to}", d.periodTo)); tableHead();
    lines(["revenue", "grants"]); lines(["cost_of_sales"], true);
    if (f.pl.cost_of_sales.v[0] || f.pl.cost_of_sales.v[1]) row(t("r_gross_profit"), f.gross, { bold: true });
    lines(["other_income"]); lines(["employee_costs", "depreciation", "other_expenses"], true);
    row(t("fs_operating_profit"), f.operating, { bold: true });
    lines(["finance_costs"], true);
    row(t("fs_before_tax"), f.beforeTax, { bold: true });
    lines(["income_tax"], true);
    row(t("fs_profit"), f.profit, { bold: true });

    // ---- changes in equity: as many columns as there are capital accounts, plus the total
    doc.addPage(); mark(t("fs_soce")); title(t("fs_soce"));
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
    doc.addPage(); mark(t("fs_cf")); title(t("fs_cf"), t("fs_for_period").replace("{from}", d.periodFrom).replace("{to}", d.periodTo)); tableHead(false);
    for (const r of f.cf) {
      if (r.style === "head") row(r.label, null, { head: true });
      else row(r.label, r.v, { bold: r.style === "sub" || r.style === "total", indent: r.style === "line" });
    }

    // ---- policies and notes
    const noteFigures = (figures: string | null) => {
      if (!figures) return;
      if (figures === "ppe") {
        if (!f.ppe.length) return;
        const cw = [72, 86, 76, 76], x0 = L + W - 310;
        room(30);
        { const y = doc.y; doc.font("Helvetica-Bold").fontSize(7.5).fillColor(MUTED);
          [t("fs_cost"), t("fs_accum_dep"), `${t("fs_carrying")} ${heads[0]}`, ...(cols === 2 ? [`${t("fs_carrying")} ${heads[1]}`] : [])]
            .forEach((h, i) => doc.text(h, x0 + cw.slice(0, i).reduce((s, w) => s + w, 0), y, { width: cw[i] - 4, align: "right" }));
          doc.y = y + 22; }
        const pr = (label: string, v: (number | null)[], bold = false) => {
          room(14); const y = doc.y;
          doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor(INK).text(label, L, y, { width: x0 - L - 6 });
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
    doc.addPage(); mark(t("fs_policies")); title(`1. ${t("fs_policies")}`);
    for (const n of notes.filter((x) => x.kind === "policy" && x.included)) {
      room(50);
      doc.font("Helvetica-Bold").fontSize(BODY_SIZE).fillColor(INK).text(`${byId.get(n.id) ?? ""} ${n.title}`, L, doc.y, { width: W }); doc.moveDown(0.4);
      if (n.body) text(fillTokens(n.body, tokens));
    }
    doc.addPage(); mark(t("fs_notes")); title(t("fs_notes"));
    for (const n of notes.filter((x) => x.kind === "note" && x.included)) {
      room(70);
      doc.font("Helvetica-Bold").fontSize(BODY_SIZE).fillColor(INK).text(`${byId.get(n.id) ?? ""}. ${n.title}`, L, doc.y, { width: W }); doc.moveDown(0.4);
      if (n.body) text(fillTokens(n.body, tokens));
      noteFigures(n.figures);
      doc.moveDown(0.3);
    }

    // ---- detailed income statement
    doc.addPage(); mark(t("fs_detailed")); title(t("fs_detailed"), t("fs_detailed_help")); tableHead(false);
    for (const g of f.detailed) {
      row(t(`fs_line_${g.line}` as never), null, { head: true });
      g.accounts.forEach((a) => row(`${a.code} ${a.name}`, a.v, { indent: true }));
      row(t("total"), g.v, { bold: true });
    }
    row(t("fs_profit"), f.profit, { bold: true });

    // ---- contents, now that every section's page is known: title, dotted leader, page number
    doc.switchToPage(contentsPage);
    doc.x = L; doc.y = doc.page.margins.top;
    title(t("fs_contents"));
    { const y0 = doc.y; doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED).text(t("fs_page"), L, y0, { width: W, align: "right" }); doc.y = y0 + 16; }
    contents.forEach((e, i) => {
      const y = doc.y, label = `${i + 1}.  ${e.label}`;
      doc.font("Helvetica").fontSize(10.5).fillColor(INK).text(label, L, y, { width: W - 40, lineBreak: false });
      const used = doc.widthOfString(label) + 6, dots = ".".repeat(Math.max(3, Math.floor((W - 40 - used) / doc.widthOfString("."))));
      doc.fillColor(LINE).text(dots, L + used, y, { width: W - 40 - used, lineBreak: false });
      doc.fillColor(INK).text(String(e.page), L + W - 36, y, { width: 36, align: "right", lineBreak: false });
      doc.y = y + 20;
    });

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
