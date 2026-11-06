import type { InstalledApp } from "../api";

// Warna cadangan kalau ikon app belum ada, diambil dari tile contoh di Figma.
const TILE_COLORS = ["#c96a4a", "#a259ff", "#7c3a85", "#5d5d5d", "#5e6ad2", "#2f6fed", "#3b8a6e", "#b5832f"];

function colorFor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TILE_COLORS[h % TILE_COLORS.length];
}

interface Props {
  name: string;
  installed?: InstalledApp;
  /** Belum dipindai: jangan tandai sebagai hilang. */
  known: boolean;
  size?: number;
  title?: string;
}

export function AppTile({ name, installed, known, size = 40, title }: Props) {
  const missing = known && !installed;
  const style = { width: size, height: size, fontSize: size * 0.4375 };
  return (
    <div
      className={`tile${missing ? " missing" : ""}`}
      style={installed?.icon ? style : { ...style, background: colorFor(name) }}
      title={title ?? (missing ? `${name} (tidak ditemukan)` : name)}
      aria-label={name}
    >
      {installed?.icon ? (
        <img src={installed.icon} alt="" width={size} height={size} style={{ width: size, height: size }} draggable={false} />
      ) : (
        <span aria-hidden>{name.trim().charAt(0).toUpperCase() || "?"}</span>
      )}
    </div>
  );
}
