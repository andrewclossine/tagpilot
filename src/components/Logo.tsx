/** TAGPILOT mark: a flight path that climbs and turns into a heading arrow, inside a blue tile. */
export function LogoMark({ size = 32, id = "tp" }: { size?: number; id?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label="TAGPILOT" style={{ flex: "none" }}>
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3b82f6" />
          <stop offset="1" stopColor="#1e3a8a" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="40" height="40" rx="10" fill={`url(#${id}-g)`} />
      <path d="M8 29 L16 21.5 L21 25.5 L29.5 15" fill="none" stroke="#ffffff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M24.2 12.6 L32.6 11.4 L31.4 19.8 Z" fill="#ffffff" />
      <circle cx="8" cy="29" r="2.4" fill="#93c5fd" />
    </svg>
  );
}

export function Logo({ size = 30, onDark = false }: { size?: number; onDark?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: Math.round(size / 3.2) }}>
      <LogoMark size={size} />
      <span style={{ font: `700 ${Math.round(size * 0.62)}px var(--f-display)`, letterSpacing: "0.02em", color: onDark ? "#ffffff" : "var(--fg)" }}>
        TAG<span style={{ fontWeight: 500, color: onDark ? "#93c5fd" : "var(--accent)" }}>PILOT</span>
      </span>
    </div>
  );
}
