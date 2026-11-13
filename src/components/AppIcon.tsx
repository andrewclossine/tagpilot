export type AppKey = "accounting" | "projects" | "procurement";

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
