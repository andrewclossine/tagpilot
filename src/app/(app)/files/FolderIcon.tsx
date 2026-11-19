/** A folder, drawn: the tab, the body and a soft fold line. */
export function FolderIcon({ size = 52, open = false }: { size?: number; open?: boolean }) {
  return (
    <svg className="mf-icon" width={size} height={size} viewBox="0 0 64 52" aria-hidden="true">
      <path d="M4 8a4 4 0 0 1 4-4h14l6 6h28a4 4 0 0 1 4 4v4H4z" className="mf-tab" />
      <path d={open ? "M2 20h60l-6 26a4 4 0 0 1-4 3H8a4 4 0 0 1-4-3z" : "M4 16h56v30a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"} className="mf-body" />
    </svg>
  );
}
