import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type Ref } from "react";
import { isSpacer, type InstalledApp, type PresetApp } from "../api";
import { AppTile } from "./AppTile";
import { Icon } from "./Icon";

interface Props {
  /** Sudah urut sesuai dock. */
  apps: PresetApp[];
  byId: Map<string, InstalledApp>;
  known: boolean;
  onAdd?: (anchor: HTMLElement) => void;
  addOpen?: boolean;
  addRef?: Ref<HTMLButtonElement>;
  /** Klik ikon: menu kecil (buka otomatis, hapus). */
  onItem?: (app: PresetApp, anchor: HTMLElement) => void;
  /** Seret ikon ke posisi lain. Tanpa ini ikon tidak bisa diseret. */
  onReorder?: (from: number, to: number) => void;
}

/** Jarak gerak sebelum tekan-tahan dianggap menyeret (bukan klik). */
const DRAG_THRESHOLD = 4;

/** Jeda masuk bertahap, dibatasi supaya rak panjang tidak terasa lambat. */
const delay = (i: number) => ({ animationDelay: `${Math.min(i * 18, 140)}ms` });

interface Drag {
  from: number;
  to: number;
  dx: number;
  /** Lebar slot ikon yang diseret (lebar + jarak), untuk menggeser ikon lain. */
  slot: number;
}

/**
 * Pratinjau rak dock (Figma "Panggung pratinjau"): ikon tanpa nama, titik di
 * bawah = dibuka otomatis, garis = pemisah, kotak + = tambah app. Ikon dan
 * pemisah bisa diseret ke kiri-kanan untuk mengubah urutan, seperti di dock.
 */
export function Shelf({ apps, byId, known, onAdd, addOpen, addRef, onItem, onReorder }: Props) {
  const itemsRef = useRef<(HTMLElement | null)[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  /** Satu frame tanpa transisi setelah dilepas, supaya ikon tidak melompat. */
  const [settling, setSettling] = useState(false);
  const press = useRef<{ index: number; x: number; centers: number[]; slot: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>, index: number) => {
    if (!onReorder || e.button !== 0) return;
    const els = itemsRef.current.slice(0, apps.length);
    const centers = els.map((el) => (el ? el.offsetLeft + el.offsetWidth / 2 : 0));
    const me = els[index];
    const next = els[index + 1] ?? els[index - 1];
    const gap = next && me ? Math.abs(next.offsetLeft - me.offsetLeft) - (next.offsetLeft > me.offsetLeft ? me.offsetWidth : next.offsetWidth) : 10;
    press.current = { index, x: e.clientX, centers, slot: (me?.offsetWidth ?? 48) + gap, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const p = press.current;
    if (!p) return;
    const dx = e.clientX - p.x;
    if (!p.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
    p.moved = true;
    // Posisi baru: berapa ikon lain yang tengahnya ada di kiri tengah ikon yang diseret.
    const center = p.centers[p.index] + dx;
    let to = 0;
    p.centers.forEach((c, i) => {
      if (i !== p.index && c < center) to++;
    });
    setDrag({ from: p.index, to, dx, slot: p.slot });
  };

  const onPointerUp = () => {
    const p = press.current;
    press.current = null;
    if (!p?.moved) return;
    suppressClick.current = true;
    setTimeout(() => (suppressClick.current = false), 0);
    const result = drag;
    setDrag(null);
    setSettling(true);
    requestAnimationFrame(() => requestAnimationFrame(() => setSettling(false)));
    if (result && result.from !== result.to) onReorder?.(result.from, result.to);
  };

  /** Geser ikon lain untuk memberi tempat; ikon yang diseret mengikuti kursor. */
  const styleFor = (i: number): CSSProperties => {
    const base = delay(i);
    if (!drag) return settling ? { ...base, transition: "none" } : base;
    if (i === drag.from) return { ...base, transform: `translateX(${drag.dx}px)`, transition: "none", zIndex: 2 };
    let shift = 0;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) shift = -drag.slot;
    if (drag.from > drag.to && i >= drag.to && i < drag.from) shift = drag.slot;
    return shift ? { ...base, transform: `translateX(${shift}px)` } : base;
  };

  const handlers = (a: PresetApp, i: number) => ({
    ref: (el: HTMLElement | null) => {
      itemsRef.current[i] = el;
    },
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => onPointerDown(e, i),
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      if (suppressClick.current) return;
      onItem?.(a, e.currentTarget);
    },
    onContextMenu: (e: React.MouseEvent<HTMLElement>) => {
      e.preventDefault();
      onItem?.(a, e.currentTarget);
    },
  });

  return (
    <div className="stage">
      <div className={`shelf${drag ? " dragging" : ""}${onReorder ? " sortable" : ""}`}>
        {apps.map((a, i) => {
          const lifted = drag?.from === i;
          if (isSpacer(a.bundle_id)) {
            return (
              <button
                key={a.bundle_id}
                className={`shelf-divider-hit${lifted ? " lifted" : ""}`}
                style={styleFor(i)}
                aria-label="Pemisah"
                title="Pemisah"
                {...handlers(a, i)}
              >
                <span className="shelf-divider" />
              </button>
            );
          }
          const missing = known && !byId.has(a.bundle_id);
          return (
            <button
              key={a.bundle_id}
              className={`shelf-item${lifted ? " lifted" : ""}`}
              style={styleFor(i)}
              title={drag ? undefined : `${a.name}${a.auto_open ? " · buka otomatis" : ""}${missing ? " · tidak ditemukan" : ""}`}
              {...handlers(a, i)}
            >
              <AppTile name={a.name} installed={byId.get(a.bundle_id)} known={known} size={48} title="" />
              <span className={`run-dot${a.auto_open ? "" : " off"}`} aria-hidden />
            </button>
          );
        })}
        {onAdd && (
          <div className="shelf-item" style={delay(apps.length)}>
            <button
              ref={addRef}
              className={`shelf-add${addOpen ? " open" : ""}`}
              aria-label="Tambah app"
              aria-haspopup="dialog"
              aria-expanded={addOpen}
              title="Tambah app"
              onClick={(e) => onAdd(e.currentTarget)}
            >
              <Icon name="plus" size={18} />
            </button>
            <span className="run-dot off" aria-hidden />
          </div>
        )}
      </div>
    </div>
  );
}
