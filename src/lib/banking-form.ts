import { isUuid, parseAmount } from "./format";
import { UserError } from "./ledger";
import type { BankLine } from "./banking";

/** Reads the rows of a cheque or deposit. Empty rows are skipped; a row with an amount needs an account. */
export function addLine(fd: FormData): BankLine[] {
  const accounts = fd.getAll("lineAccount").map(String), amounts = fd.getAll("lineAmount").map(String);
  const projects = fd.getAll("lineProject").map(String), notes = fd.getAll("lineDescription").map(String);
  const lines: BankLine[] = [];
  accounts.forEach((accountId, i) => {
    const amount = parseAmount(amounts[i]);
    if (!accountId && !amount) return;
    if (!isUuid(accountId)) throw new UserError("err_account");
    if (!(amount > 0)) throw new UserError("err_amount");
    lines.push({ accountId, amount, description: (notes[i] ?? "").trim(), projectId: isUuid(projects[i] ?? "") ? projects[i] : null });
  });
  if (!lines.length) throw new UserError("err_required");
  return lines;
}
