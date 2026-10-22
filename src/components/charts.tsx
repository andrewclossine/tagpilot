"use client";
import { useState } from "react";

const W = 640, H = 240, PAD = { l: 56, r: 12, t: 12, b: 28 };

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v)), n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}
const short = (n: number) => {
  const a = Math.abs(n);
  return a >= 1e9 ? `${+(n / 1e9).toFixed(1)}B` : a >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : a >= 1e3 ? `${+(n / 1e3).toFixed(0)}k` : `${Math.round(n)}`;
};
const full = (n: number) => Math.round(n).toLocaleString("en-US");

type Series = { name: string; color: string; values: number[] };

/** Grouped columns per month (e.g. sales vs expenses), with a hover tooltip per month. */
export function ColumnChart({ labels, series, title }: { labels: string[]; series: Series[]; title: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b, slot = iw / labels.length;
  const bw = Math.max(3, Math.min(18, (slot - 8) / series.length - 2));
  const y = (v: number) => PAD.t + ih - (Math.max(0, v) / max) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  return (
    <div className="chart" onMouseLeave={() => setHover(null)}>
      <div className="legend" style={{ marginBottom: 8 }}>{series.map((s) => <span key={s.name} style={{ "--c": s.color } as React.CSSProperties}>{s.name}</span>)}</div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        {ticks.map((tk) => <g key={tk}><line className="grid" x1={PAD.l} x2={W - PAD.r} y1={y(tk)} y2={y(tk)} /><text className="axis" x={PAD.l - 8} y={y(tk) + 4} textAnchor="end">{short(tk)}</text></g>)}
        {labels.map((lb, i) => {
          const x0 = PAD.l + i * slot + (slot - series.length * (bw + 2)) / 2;
          return (
            <g key={lb}>
              {hover === i ? <rect x={PAD.l + i * slot} y={PAD.t} width={slot} height={ih} fill="var(--surface-2)" /> : null}
              {series.map((s, k) => {
                const v = s.values[i], h = PAD.t + ih - y(v), r = Math.min(4, bw / 2, h);
                return h > 0 ? <path key={s.name} fill={s.color}
                  d={`M${x0 + k * (bw + 2)},${PAD.t + ih} v${-(h - r)} q0,${-r} ${r},${-r} h${bw - 2 * r} q${r},0 ${r},${r} v${h - r} z`} /> : null;
              })}
              <text className="axis" x={PAD.l + i * slot + slot / 2} y={H - 8} textAnchor="middle">{lb}</text>
              <rect x={PAD.l + i * slot} y={PAD.t} width={slot} height={ih + PAD.b} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${lb}: ${series.map((s) => `${s.name} ${full(s.values[i])}`).join(", ")}`} />
            </g>
          );
        })}
      </svg>
      {hover !== null ? (
        <div className="tip" style={{ left: `${Math.min(75, ((PAD.l + hover * slot + slot) / W) * 100)}%`, top: 24 }}>
          <b>{labels[hover]}</b>
          {series.map((s) => <div key={s.name}><span className="k" style={{ background: s.color }} />{s.name}: <b className="num">{full(s.values[hover])}</b></div>)}
        </div>
      ) : null}
    </div>
  );
}

/** One line over time (e.g. cash balance) with a soft area, a marked end point and a crosshair tooltip. */
export function LineChart({ labels, values, name, color }: { labels: string[]; values: number[]; name: string; color: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const lo = Math.min(0, ...values), hi = niceMax(Math.max(1, ...values));
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (labels.length > 1 ? (i / (labels.length - 1)) * iw : iw / 2);
  const y = (v: number) => PAD.t + ih - ((v - lo) / (hi - lo)) * ih;
  const pts = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const last = values.length - 1;
  const ticks = [0, 0.5, 1].map((f) => lo + f * (hi - lo));
  return (
    <div className="chart" onMouseLeave={() => setHover(null)}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const px = ((e.clientX - r.left) / r.width) * W;
        setHover(Math.max(0, Math.min(last, Math.round(((px - PAD.l) / iw) * last))));
      }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={name}>
        {ticks.map((tk) => <g key={tk}><line className="grid" x1={PAD.l} x2={W - PAD.r} y1={y(tk)} y2={y(tk)} /><text className="axis" x={PAD.l - 8} y={y(tk) + 4} textAnchor="end">{short(tk)}</text></g>)}
        <polygon points={`${x(0)},${y(Math.max(lo, 0))} ${pts} ${x(last)},${y(Math.max(lo, 0))}`} fill={color} opacity="0.12" />
        <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
        {labels.map((lb, i) => (i % 2 === last % 2 ? <text key={lb} className="axis" x={x(i)} y={H - 8} textAnchor="middle">{lb}</text> : null))}
        <circle cx={x(last)} cy={y(values[last] ?? 0)} r="4.5" fill={color} stroke="var(--surface)" strokeWidth="2" />
        {hover !== null ? <><line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + ih} stroke="var(--muted)" strokeDasharray="3 3" />
          <circle cx={x(hover)} cy={y(values[hover])} r="4.5" fill={color} stroke="var(--surface)" strokeWidth="2" /></> : null}
      </svg>
      {hover !== null ? (
        <div className="tip" style={{ left: `${Math.min(75, (x(hover) / W) * 100)}%`, top: 8 }}>
          <b>{labels[hover]}</b><div><span className="k" style={{ background: color }} />{name}: <b className="num">{full(values[hover])}</b></div>
        </div>
      ) : null}
    </div>
  );
}
