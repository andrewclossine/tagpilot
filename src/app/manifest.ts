import type { MetadataRoute } from "next";

/** Lets Chrome, Edge, Android and iPhone install TAGPILOT as an app with its own window and icon. It still works online. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "TAGPILOT",
    short_name: "TAGPILOT",
    description: "Accounting, project management and procurement.",
    start_url: "/apps",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#1e3a8a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
