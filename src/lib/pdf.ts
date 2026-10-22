import "server-only";
import PDFDocument from "pdfkit";
import type { PayrollComponent, PayslipRow } from "@/db/schema";
import { money as fmt, type Lang } from "./format";

// The built-in PDF fonts lack the narrow spaces French number formatting uses; plain spaces print the same.
const amount = (n: number, lang: Lang) => fmt(n, lang, 2).replace(/[  ]/g, " ");

const BLUE = "#1d4ed8", INK = "#121c2e", MUTED = "#56647a", LINE = "#d3dbe8", SOFT = "#eef3fd";

type Company = {
  name: string; registrationNo: string; tin: string; address: string; city: string; country: string; phone: string; email: string; currency: string;
  logo?: Buffer | null; // PNG or JPEG
};

function render(build: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50, info: { Producer: "TAGPILOT", Creator: "TAGPILOT" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    build(doc);
    doc.end();
  });
}

/** The TAGPILOT mark, drawn as vectors so it stays sharp when printed. */
function mark(doc: PDFKit.PDFDocument, x: number, y: number, size: number) {
  const s = size / 40;
  doc.save().translate(x, y).scale(s);
  doc.roundedRect(0, 0, 40, 40, 10).fill(BLUE);
  doc.lineWidth(3.2).lineCap("round").lineJoin("round").moveTo(8, 29).lineTo(16, 21.5).lineTo(21, 25.5).lineTo(29.5, 15).stroke("#ffffff");
  doc.polygon([24.2, 12.6], [32.6, 11.4], [31.4, 19.8]).fill("#ffffff");
  doc.circle(8, 29, 2.4).fill("#93c5fd");
  doc.restore();
}

/** Company block on the left, document title and number on the right, then a blue rule. */
function header(doc: PDFKit.PDFDocument, c: Company, title: string, lines: [string, string][]) {
  const top = 50;
  let nameY = top;
  if (c.logo) {
    // A logo that cannot be read must not stop the document; it is simply left out.
    try { doc.image(c.logo, 50, top, { fit: [150, 50] }); nameY = top + 58; } catch (e) { console.error("Logo not embedded", e); }
  }
  doc.fillColor(INK).font("Helvetica-Bold").fontSize(16).text(c.name, 50, nameY, { width: 280 });
  doc.font("Helvetica").fontSize(9).fillColor(MUTED);
  const info = [
    [c.address, c.city, c.country].filter(Boolean).join(", "),
    [c.phone, c.email].filter(Boolean).join(" · "),
    c.registrationNo ? `Reg. No ${c.registrationNo}` : "", c.tin ? `Tax ID ${c.tin}` : "",
  ].filter(Boolean);
  for (const l of info) doc.text(l, { width: 280 });
  const leftEnd = doc.y; // the right-hand block moves doc.y, so remember where the company details end
  doc.font("Helvetica-Bold").fontSize(20).fillColor(BLUE).text(title.toUpperCase(), 330, top, { width: 215, align: "right" });
  doc.font("Helvetica").fontSize(9);
  let y = top + 28;
  for (const [k, v] of lines) {
    doc.fillColor(MUTED).text(k, 330, y, { width: 105, align: "right" });
    doc.fillColor(INK).font("Helvetica-Bold").text(v, 440, y, { width: 105, align: "right" }).font("Helvetica");
    y += 14;
  }
  const below = Math.max(leftEnd, y) + 14;
  doc.moveTo(50, below).lineTo(545, below).lineWidth(2).strokeColor(BLUE).stroke();
  doc.y = below + 16;
}

function footer(doc: PDFKit.PDFDocument, note: string) {
  // The footer sits inside the bottom margin; lift the margin so PDFKit does not start a new page for it.
  doc.page.margins.bottom = 0;
  const y = doc.page.height - 60;
  doc.moveTo(50, y).lineTo(545, y).lineWidth(0.5).strokeColor(LINE).stroke();
  mark(doc, 50, y + 10, 14);
  doc.font("Helvetica").fontSize(8).fillColor(MUTED).text(note, 70, y + 13, { width: 475, lineBreak: false });
}

type Col = { label: string; width: number; align?: "left" | "right" | "center" };

function table(doc: PDFKit.PDFDocument, cols: Col[], rows: string[][]) {
  const x0 = 50;
  let y = doc.y;
  doc.rect(x0, y, 495, 20).fill(SOFT);
  doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED);
  let x = x0 + 6;
  for (const c of cols) { doc.text(c.label.toUpperCase(), x, y + 6, { width: c.width - 12, align: c.align ?? "left" }); x += c.width; }
  y += 24;
  doc.font("Helvetica").fontSize(9.5).fillColor(INK);
  for (const r of rows) {
    const h = Math.max(...r.map((v, i) => doc.heightOfString(v, { width: cols[i].width - 12 }))) + 8;
    if (y + h > doc.page.height - 120) { doc.addPage(); y = 50; }
    x = x0 + 6;
    r.forEach((v, i) => { doc.text(v, x, y + 3, { width: cols[i].width - 12, align: cols[i].align ?? "left" }); x += cols[i].width; });
    y += h;
    doc.moveTo(x0, y).lineTo(x0 + 495, y).lineWidth(0.5).strokeColor(LINE).stroke();
  }
  doc.y = y + 10;
}

/** Label-value lines aligned to the right edge; `strong` lines are bold and set on a tinted band. */
function totals(doc: PDFKit.PDFDocument, lines: { label: string; value: string; strong?: boolean }[]) {
  let y = doc.y;
  for (const l of lines) {
    if (l.strong) doc.rect(320, y - 4, 225, 20).fill(SOFT);
    doc.font(l.strong ? "Helvetica-Bold" : "Helvetica").fontSize(l.strong ? 11 : 9.5).fillColor(l.strong ? INK : MUTED)
      .text(l.label, 326, y, { width: 110 }).fillColor(INK).text(l.value, 430, y, { width: 109, align: "right" });
    y += l.strong ? 24 : 16;
  }
  doc.y = y + 6;
}

export type InvoicePdfData = {
  company: Company; lang: Lang;
  labels: Record<"title" | "number" | "date" | "due" | "billTo" | "description" | "qty" | "price" | "vat" | "amount" | "subtotal" | "total" | "paid" | "balance" | "notes" | "footer" | "tin", string>;
  invoice: { number: string; date: string; dueDate: string; subtotal: number; vat: number; total: number; amountPaid: number; notes: string };
  customer: { name: string; tin: string; address: string; email: string; phone: string };
  lines: { description: string; quantity: number; unitPrice: number; vatApplies: boolean; amount: number }[];
  vatRate: number;
};

export function invoicePdf(d: InvoicePdfData): Promise<Buffer> {
  const m = (n: number) => amount(n, d.lang);
  const cur = d.company.currency;
  return render((doc) => {
    header(doc, d.company, d.labels.title, [[d.labels.number, d.invoice.number], [d.labels.date, d.invoice.date], [d.labels.due, d.invoice.dueDate]]);
    doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED).text(d.labels.billTo.toUpperCase(), 50);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(INK).text(d.customer.name);
    doc.font("Helvetica").fontSize(9).fillColor(MUTED);
    for (const l of [d.customer.address, [d.customer.phone, d.customer.email].filter(Boolean).join(" · "), d.customer.tin ? `${d.labels.tin} ${d.customer.tin}` : ""]) if (l) doc.text(l);
    doc.moveDown(1.2);
    table(doc, [
      { label: d.labels.description, width: 215 }, { label: d.labels.qty, width: 50, align: "right" },
      { label: d.labels.price, width: 90, align: "right" }, { label: d.labels.vat, width: 45, align: "center" },
      { label: `${d.labels.amount} (${cur})`, width: 95, align: "right" },
    ], d.lines.map((l) => [l.description, String(l.quantity), m(l.unitPrice), l.vatApplies ? `${d.vatRate}%` : "-", m(l.amount)]));
    totals(doc, [
      { label: d.labels.subtotal, value: m(d.invoice.subtotal) },
      { label: `${d.labels.vat} ${d.vatRate}%`, value: m(d.invoice.vat) },
      { label: `${d.labels.total} ${cur}`, value: m(d.invoice.total), strong: true },
      ...(d.invoice.amountPaid ? [{ label: d.labels.paid, value: m(d.invoice.amountPaid) }, { label: `${d.labels.balance} ${cur}`, value: m(d.invoice.total - d.invoice.amountPaid), strong: true }] : []),
    ]);
    if (d.invoice.notes) {
      doc.moveDown(0.5).font("Helvetica-Bold").fontSize(8).fillColor(MUTED).text(d.labels.notes.toUpperCase(), 50);
      doc.font("Helvetica").fontSize(9.5).fillColor(INK).text(d.invoice.notes, { width: 495 });
    }
    footer(doc, d.labels.footer);
  });
}

export type PayslipPdfData = {
  company: Company; lang: Lang; month: string;
  labels: Record<"title" | "month" | "employee" | "position" | "gross" | "deductions" | "other" | "net" | "employer" | "footer", string>;
  row: PayslipRow; components: PayrollComponent[];
};

export function payslipPdf(d: PayslipPdfData): Promise<Buffer> {
  const m = (n: number) => amount(n, d.lang);
  const cur = d.company.currency, r = d.row;
  return render((doc) => {
    header(doc, d.company, d.labels.title, [[d.labels.month, d.month]]);
    doc.font("Helvetica-Bold").fontSize(8).fillColor(MUTED).text(d.labels.employee.toUpperCase(), 50);
    doc.font("Helvetica-Bold").fontSize(12).fillColor(INK).text(r.name);
    if (r.position) doc.font("Helvetica").fontSize(9.5).fillColor(MUTED).text(`${d.labels.position}: ${r.position}`);
    doc.moveDown(1.2);
    const emp = d.components.filter((c) => c.kind === "employee"), er = d.components.filter((c) => c.kind === "employer");
    table(doc, [{ label: d.labels.deductions, width: 345 }, { label: cur, width: 150, align: "right" }], [
      [d.labels.gross, m(r.gross)],
      ...emp.map((c) => [`${c.name}${c.method === "percent" ? ` (${c.rate}%)` : ""}`, `-${m(r.deductions[c.code] ?? 0)}`]),
      ...(r.otherDeduction ? [[d.labels.other, `-${m(r.otherDeduction)}`]] : []),
    ]);
    totals(doc, [{ label: `${d.labels.net} ${cur}`, value: m(r.net), strong: true }]);
    if (er.length) {
      doc.moveDown(0.5).font("Helvetica-Bold").fontSize(8).fillColor(MUTED).text(d.labels.employer.toUpperCase(), 50);
      doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(er.map((c) => `${c.name}: ${m(r.employer[c.code] ?? 0)}`).join("   ·   "), { width: 495 });
    }
    footer(doc, d.labels.footer);
  });
}
