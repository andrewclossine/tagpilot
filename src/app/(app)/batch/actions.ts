"use server";
import { revalidatePath } from "next/cache";
import { getCtx } from "@/lib/auth";
import { str } from "@/lib/format";
import { saveBatch, type BatchKind, type BatchResult, type BatchRow } from "@/lib/batch";

/** What the grid gets back: how many were saved, or which rows are wrong and why (i18n keys). */
export type BatchState = BatchResult & { kind: BatchKind | null };

const AREA = { invoice: "sales", bill: "purchases", bank: "banking" } as const;

export async function saveBatchAction(_prev: BatchState, fd: FormData): Promise<BatchState> {
  const ctx = await getCtx();
  const kind: BatchKind = str(fd, "kind") === "bill" ? "bill" : str(fd, "kind") === "bank" ? "bank" : "invoice";
  if (!ctx.can(AREA[kind], "write") || !ctx.can("journal", "write")) return { kind, saved: 0, errors: [{ row: -1, message: "err_no_access" }] };
  let rows: BatchRow[];
  try {
    const parsed = JSON.parse(String(fd.get("rows") ?? "[]"));
    if (!Array.isArray(parsed)) throw new Error("rows");
    rows = parsed.map((r) => ({
      date: String(r?.date ?? ""), dueDate: String(r?.dueDate ?? ""), direction: String(r?.direction ?? ""), partner: String(r?.partner ?? ""),
      reference: String(r?.reference ?? ""), account: String(r?.account ?? ""), description: String(r?.description ?? ""),
      amount: String(r?.amount ?? ""), vat: r?.vat === true, project: String(r?.project ?? ""),
    }));
  } catch { return { kind, saved: 0, errors: [{ row: -1, message: "err_batch_empty" }] }; }
  const result = await saveBatch(
    { companyId: ctx.company.id, userId: ctx.user.id, vatRate: ctx.company.vatRegistered ? ctx.company.vatRate : 0, settings: ctx.company.settings },
    kind, rows, { post: str(fd, "post") !== "0", bankId: str(fd, "bankId"), createPartners: str(fd, "createPartners") === "1" },
  );
  if (result.saved) {
    revalidatePath(kind === "invoice" ? "/sales/invoices" : kind === "bill" ? "/purchases/bills" : "/banking");
    revalidatePath("/journal");
    revalidatePath("/dashboard");
  }
  return { ...result, kind };
}
