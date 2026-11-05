export type AppKey = "accounting" | "projects" | "procurement";

const LINE = { fill: "none", stroke: "#fff", strokeWidth: 2.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** The icon of each app, a white mark on a coloured tile. Colours come from the --app-* tokens in globals.css. */
export function AppIcon({ app, size = 64 }: { app: AppKey; size?: number }) {
  return (
    <svg className={`app-icon ${app}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="15" />
      {app === "accounting" ? (
        // A calculator: the display, then the keys.
        <g {...LINE}>
          <rect x="18" y="13" width="28" height="38" rx="4" />
          <path d="M24 21h16" strokeWidth="4" />
          <path d="M25 31h.01M32 31h.01M39 31h.01M25 38h.01M32 38h.01M39 38h.01M25 45h.01M32 45h.01M39 45h.01" strokeWidth="4" />
        </g>
      ) : app === "projects" ? (
        // A results chain: one goal resting on the outputs and activities below it.
        <g {...LINE}>
          <rect x="24" y="12" width="16" height="10" rx="3" />
          <rect x="11" y="42" width="16" height="10" rx="3" />
          <rect x="37" y="42" width="16" height="10" rx="3" />
          <path d="M32 22v10M19 42v-5a5 5 0 0 1 5-5h16a5 5 0 0 1 5 5v5" />
        </g>
      ) : (
        // A tender document with a stamp of approval.
        <g {...LINE}>
          <path d="M20 12h17l9 9v13M20 12a3 3 0 0 0-3 3v34a3 3 0 0 0 3 3h13" />
          <path d="M37 12v9h9M24 29h13M24 37h7" />
          <circle cx="43" cy="45" r="8" />
          <path d="m39.5 45 2.5 2.5 4.5-4.5" />
        </g>
      )}
    </svg>
  );
}
