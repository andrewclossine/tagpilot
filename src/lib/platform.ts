import "server-only";
import { notFound } from "next/navigation";
import { getCurrentUser } from "./auth";

/**
 * The people who run TAGPILOT itself, by email, from PLATFORM_OWNER_EMAILS (comma separated).
 * Emails are unique on TAGPILOT, so an address is only added once its owner has signed up with it.
 */
const owners = () => (process.env.PLATFORM_OWNER_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

export const isPlatformOwner = (user: { email: string | null } | null | undefined) =>
  !!user?.email && owners().includes(user.email.trim().toLowerCase());

/** For the platform pages: anyone else gets "not found", so the pages do not even show that they exist. */
export async function requirePlatformOwner() {
  const user = await getCurrentUser();
  if (!isPlatformOwner(user)) notFound();
  return user!;
}

export type CompanyStatus = "suspended" | "paid" | "trial" | "expired";

export function companyStatus(c: { suspendedAt: Date | null; paidUntil: Date | null; trialEndsAt: Date }, now = Date.now()): { status: CompanyStatus; days: number } {
  if (c.suspendedAt) return { status: "suspended", days: 0 };
  if (c.paidUntil && c.paidUntil.getTime() > now) return { status: "paid", days: Math.ceil((c.paidUntil.getTime() - now) / 86400000) };
  const left = Math.ceil((c.trialEndsAt.getTime() - now) / 86400000);
  return left > 0 ? { status: "trial", days: left } : { status: "expired", days: -left };
}
