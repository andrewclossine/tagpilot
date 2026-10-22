import type { Metadata } from "next";
import { getI18n } from "@/lib/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "TAGPILOT", template: "%s · TAGPILOT" },
  description: "Smart accounting, with AI that reads your supporting documents.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { lang } = await getI18n();
  return (
    <html lang={lang}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&family=Source+Sans+3:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
