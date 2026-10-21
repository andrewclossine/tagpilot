import "server-only";
import { redirect } from "next/navigation";
import { UserError } from "./ledger";

/** Sends the user back to `path` with an error message key when an action fails for a reason they can fix. */
export function fail(e: unknown, path: string): never {
  const code = (e as { code?: string; cause?: { code?: string } })?.cause?.code ?? (e as { code?: string })?.code;
  if (e instanceof UserError) redirect(withParam(path, "error", e.message));
  if (code === "23505") redirect(withParam(path, "error", "err_duplicate_code"));
  throw e;
}

export function withParam(path: string, key: string, value: string) {
  return `${path}${path.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
}

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function sp(searchParams: SearchParams) {
  const p = await searchParams;
  return (k: string) => { const v = p[k]; return typeof v === "string" ? v : Array.isArray(v) ? v[0] ?? "" : ""; };
}
