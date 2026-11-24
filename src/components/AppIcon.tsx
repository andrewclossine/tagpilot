export type AppKey = "accounting" | "projects" | "procurement" | "files" | "esign" | "qr";

const LINE = { fill: "none", stroke: "#fff", strokeWidth: 3, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/**
 * The icon of each app: a white mark on a solid tile in the app's colour (the --app-* tokens in globals.css), with a
 * soft light across the top so it reads as a tile, not a flat square.
 */
export function AppIcon({ app, size = 64 }: { app: AppKey; size?: number }) {
  const shine = `shine-${app}`;
  return (
    <svg className={`app-icon ${app}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={shine} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".22" />
          <stop offset=".55" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" />
      <rect width="64" height="64" rx="16" fill={`url(#${shine})`} className="shine" />
      {app === "accounting" ? (
        // A ledger page with a rising line: the books, and what they show.
        <g {...LINE}>
          <rect x="15" y="13" width="34" height="38" rx="5" />
          <path d="M22 22h20" strokeWidth="3.4" />
          <path d="M22 42l6-7 5 4 9-10" />
          <circle cx="42" cy="29" r="1.2" fill="#fff" stroke="none" />
        </g>
      ) : app === "projects" ? (
        // A target with an arrow in it: results reached.
        <g {...LINE}>
          <circle cx="30" cy="34" r="16" />
          <circle cx="30" cy="34" r="8.5" />
          <circle cx="30" cy="34" r="1.6" fill="#fff" stroke="none" />
          <path d="M31 33l14-14M40 15v5h5" />
        </g>
      ) : app === "esign" ? (
        // A page with a pen signing on its line.
        <g {...LINE}>
          <path d="M18 12h18l9 9v13M18 12a3 3 0 0 0-3 3v32a3 3 0 0 0 3 3h12" />
          <path d="M36 12v9h9M21 27h14M21 33h8" />
          <path d="M33 50c3-6 5-6 6-3s3 3 5-1l7-12" />
          <path d="M47 30l4 4" />
        </g>
      ) : app === "qr" ? (
        // A QR code: three corner eyes and a few dots.
        <g {...LINE}>
          <rect x="13" y="13" width="14" height="14" rx="3" /><rect x="37" y="13" width="14" height="14" rx="3" /><rect x="13" y="37" width="14" height="14" rx="3" />
          <path d="M19 19h2M43 19h2M19 43h2" strokeWidth="4" />
          <path d="M37 37h4M47 37h4M37 43v8M43 45h4v6M51 43v2" />
        </g>
      ) : app === "files" ? (
        // A folder holding papers: the organisation's documents, filed.
        <g {...LINE}>
          <path d="M13 22v-5a3 3 0 0 1 3-3h10l4 4h18a3 3 0 0 1 3 3v3" />
          <path d="M11 25h42l-3 21a3 3 0 0 1-3 2.5H17a3 3 0 0 1-3-2.5z" />
          <path d="M24 34h16M24 40h10" />
        </g>
      ) : (
        // A tender document with a seal: a purchase done by the rules.
        <g {...LINE}>
          <path d="M21 12h15l9 9v8M21 12a3 3 0 0 0-3 3v34a3 3 0 0 0 3 3h11" />
          <path d="M36 12v9h9M24 28h12M24 35h7" />
          <circle cx="43" cy="44" r="7.5" />
          <path d="M39.6 44l2.4 2.4 4.4-4.4" />
        </g>
      )}
    </svg>
  );
}
