import "server-only";
import { z } from "zod/v4";
import { UserError } from "./ledger";

const JournalLines = z.array(z.object({
  accountId: z.string(), debit: z.number().min(0), credit: z.number().min(0),
  description: z.string().default(""), projectId: z.string().nullable().default(null),
}));

const DocLines = z.array(z.object({
  description: z.string(), quantity: z.number(), unitPrice: z.number(), vatApplies: z.boolean(),
  accountId: z.string(), projectId: z.string().nullable().default(null),
}));

export function parseJournalLines(fd: FormData) {
  try { return JournalLines.parse(JSON.parse(String(fd.get("lines") ?? "[]"))); } catch { throw new UserError("err_lines"); }
}

export function parseDocLines(fd: FormData) {
  try {
    const lines = DocLines.parse(JSON.parse(String(fd.get("lines") ?? "[]"))).filter((l) => l.description || l.unitPrice);
    if (!lines.length) throw new UserError("err_no_lines");
    if (lines.some((l) => !l.accountId)) throw new UserError("err_account");
    return lines;
  } catch (e) { if (e instanceof UserError) throw e; throw new UserError("err_no_lines"); }
}
