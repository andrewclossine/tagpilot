import type { Metadata, Viewport } from "next";
import { getI18n } from "@/lib/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "TAGPILOT", template: "%s · TAGPILOT" },
  description: "Smart accounting, with AI that reads your supporting documents.",
  appleWebApp: { capable: true, title: "TAGPILOT", statusBarStyle: "default" },
};

export const viewport: Viewport = { themeColor: "#1e3a8a" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { lang } = await getI18n();
  return (
    <html lang={lang}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400&family=JetBrains+Mono:wght@400;500&display=swap" />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
