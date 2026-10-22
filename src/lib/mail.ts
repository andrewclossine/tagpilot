import "server-only";
import nodemailer from "nodemailer";

export const mailConfigured = () => Boolean(process.env.SMTP_HOST);

/**
 * Sends one email through the SMTP server in the environment. Without SMTP on a developer's computer the
 * message is printed in the terminal instead, so password reset can still be tried.
 */
export type Attachment = { filename: string; content: Buffer; contentType: string };

export async function sendMail(to: string, subject: string, text: string, html: string, attachments: Attachment[] = []) {
  if (!mailConfigured()) {
    if (process.env.NODE_ENV === "production") throw new Error("SMTP is not configured");
    console.log(`\n--- email to ${to} (SMTP not configured) ---\n${subject}\n\n${text}\n${attachments.map((a) => `[attachment: ${a.filename}, ${a.content.length} bytes]`).join("\n")}\n---\n`);
    return;
  }
  const port = Number(process.env.SMTP_PORT || 587);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port, secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  await transport.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, text, html, attachments });
}
