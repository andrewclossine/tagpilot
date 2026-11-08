"use client";
import { useEffect, useState } from "react";

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

/** Already running as an installed app: from the browser's "Install", or inside the TAGPILOT desktop app. */
function runningAsApp() {
  return window.matchMedia("(display-mode: standalone)").matches || navigator.userAgent.includes("TAGPILOT-Desktop");
}

/**
 * Offers to install TAGPILOT as an app. Where the browser can install it (Chrome, Edge, Android) the button installs it
 * at once; elsewhere it opens the page that explains how, with the Windows installer. Hidden inside the app itself.
 */
export function InstallApp({ label, className = "btn sm" }: { label: string; className?: string }) {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    if (runningAsApp()) return;
    setHidden(false);
    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e as InstallPrompt); };
    const onInstalled = () => { setPrompt(null); setHidden(true); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  if (hidden) return null;
  if (!prompt) return <a className={className} href="/download">{label}</a>;
  return (
    <button type="button" className={className} onClick={async () => {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === "accepted") setHidden(true);
      setPrompt(null);
    }}>{label}</button>
  );
}
