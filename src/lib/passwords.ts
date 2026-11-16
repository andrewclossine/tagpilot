import "server-only";
import crypto from "node:crypto";
import { eq, or } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { hashPassword } from "./auth";
import { appUrl } from "./billing";
import { audit } from "./audit";
import { sendMail } from "./mail";
import { UserError } from "./ledger";

/** How long a one-time password from the platform owner works. */
export const TEMP_PASSWORD_HOURS = 2;
// No 0/O, 1/I/L: the code is often read out over the phone.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function oneTimePassword() {
  const bytes = crypto.randomBytes(10);
  const chars = [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/**
 * The platform owner resets someone's password. The old password stops working, every session of theirs ends, and they get
 * a one-time password by email that works for two hours; signing in with it, they must choose their own password.
 * Returns the code only when the email could not be sent, so the owner can pass it on another way.
 */
export async function ownerResetPassword(userId: string, companyId: string, ownerEmail: string) {
  const db = await getDb();
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!u) throw new UserError("err_not_found");
  const code = oneTimePassword();
  const expires = new Date(Date.now() + TEMP_PASSWORD_HOURS * 3600000);
  await db.transaction(async (tx) => {
    await tx.update(schema.users).set({ passwordHash: await hashPassword(code), tempPasswordExpiresAt: expires, mustChangePassword: true }).where(eq(schema.users.id, u.id));
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, u.id));
    // A lock from earlier failed attempts would stop them using the new password.
    await tx.delete(schema.loginFailures).where(or(eq(schema.loginFailures.key, `u:${u.username}`), eq(schema.loginFailures.key, `u:${(u.email ?? "").toLowerCase()}`)));
    await audit(tx, companyId, null, "platform_reset_password", "user", u.username, { by: ownerEmail, until: expires.toISOString() });
  });
  const until = `${expires.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  const login = `${await appUrl()}/login`;
  let sent = false;
  if (u.email) {
    const en = [`Hello ${u.name},`, "The TAGPILOT administrator has reset your password. Your one-time password is:", code,
      `Sign in with your username (${u.username}) and this password before ${until}. You will then choose your own password.`, "If you did not ask for this, contact your administrator."];
    const fr = [`Bonjour ${u.name},`, "L'administrateur de TAGPILOT a réinitialisé votre mot de passe. Votre mot de passe à usage unique est :", code,
      `Connectez-vous avec votre identifiant (${u.username}) et ce mot de passe avant le ${until}. Vous choisirez ensuite votre propre mot de passe.`, "Si vous n'avez rien demandé, contactez votre administrateur."];
    const p = (l: string) => (l === code ? `<p style="font-size:22px;font-weight:700;letter-spacing:2px;font-family:monospace">${esc(l)}</p>` : `<p>${esc(l)}</p>`);
    try {
      await sendMail(u.email, "TAGPILOT - new password / nouveau mot de passe",
        [...en, "", login, "", "---", "", ...fr].join("\n"),
        `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5">${en.map(p).join("")}<p><a href="${esc(login)}">${esc(login)}</a></p><hr>${fr.map(p).join("")}</div>`);
      sent = true;
    } catch (e) { console.error("temporary password email not sent", (e as Error).message); }
  }
  return { sent, code: sent ? null : code, email: u.email, username: u.username, expires };
}
