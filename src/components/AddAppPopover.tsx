import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { api, errorMessage, type InstalledApp } from "../api";
import { usePresence } from "../hooks";
import { AppTile } from "./AppTile";
import { Icon } from "./Icon";

const WIDTH = 360;
const GAP = 10;

interface Props {
  open: boolean;
  /** Tombol yang membuka popover; panah menunjuk ke sini. */
  anchor: HTMLElement | null;
  /** Elemen `position: relative` tempat popover diletakkan. */
  container: HTMLElement | null;
  /** "up": selalu di atas tombol (panel di atas dock). "auto": di atas kalau muat. */
  placement?: "up" | "auto";
  /** Ubah nilai ini setelah tata letak berubah supaya posisi dihitung ulang. */
  layoutKey?: unknown;
  title: string;
  apps: InstalledApp[];
  exclude: Set<string>;
  onPick: (app: InstalledApp) => void;
  /** Tampilkan opsi "Tambah pemisah". */
  onSpacer?: () => void;
  onClose: () => void;
  onError?: (message: string) => void;
  /** Tinggi popover, untuk memberi ruang di atas panel. */
  onHeight?: (h: number) => void;
  /** Tahan tetap tersembunyi (misalnya selama jendela panel diperbesar). */
  hold?: boolean;
}

/**
 * Popover Tambah app (Figma S5/S6): judul, daftar app, opsi pemisah, lalu kolom
 * cari dan Telusuri… paling bawah, dekat tombol yang membukanya.
 */
export function AddAppPopover(props: Props) {
  const { open, anchor, container, placement = "auto", layoutKey, title, apps, exclude, onPick, onSpacer, onClose } = props;
  const { mounted, state } = usePresence(open, 150);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  /** Baris yang disorot; -1 = belum ada (sorotan muncul saat mengetik, panah, atau kursor). */
  const [hi, setHi] = useState(-1);
  const [pos, setPos] = useState<{ left: number; top: number; arrow: number; up: boolean } | null>(null);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return apps.filter(
      (a) => !exclude.has(a.bundle_id) && (!q || a.name.toLowerCase().includes(q) || a.bundle_id.toLowerCase().includes(q)),
    );
  }, [apps, exclude, query]);

  useEffect(() => setHi(query.trim() ? 0 : -1), [query]);
  useEffect(() => {
    if (open) {
      setQuery("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Posisi: tengah popover di tengah tombol, panah selalu tepat ke tombol.
  useLayoutEffect(() => {
    if (!mounted || !anchor || !container || !ref.current) return;
    const measure = () => {
      if (!ref.current) return;
      const c = container.getBoundingClientRect();
      const a = anchor.getBoundingClientRect();
      const h = ref.current.offsetHeight;
      props.onHeight?.(h);
      const cx = a.left - c.left + a.width / 2;
      const left = Math.round(Math.max(8, Math.min(c.width - WIDTH - 8, cx - WIDTH / 2)));
      const aboveTop = a.top - c.top - h - GAP;
      const up = placement === "up" || aboveTop >= 8;
      const top = Math.round(up ? aboveTop : a.bottom - c.top + GAP);
      setPos({ left, top, arrow: Math.round(cx - left), up });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [mounted, anchor, container, placement, layoutKey]);

  // Tutup saat klik di luar (kecuali tombol pembukanya, yang menutup sendiri).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor?.contains(t)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, anchor, onClose]);

  useEffect(() => {
    listRef.current?.querySelector(".hl")?.scrollIntoView({ block: "nearest" });
  }, [hi]);

  if (!mounted) return null;

  const pick = (app: InstalledApp) => {
    onPick(app);
    setQuery("");
    inputRef.current?.focus();
  };

  const browse = async () => {
    try {
      const app = await api.pickApp();
      if (app) pick(app);
    } catch (e) {
      props.onError?.(errorMessage(e));
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((i) => Math.min(list.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && list[hi]) {
      e.preventDefault();
      pick(list[hi]);
    }
  };

  const style = {
    width: WIDTH,
    left: pos?.left ?? 0,
    top: pos?.top ?? 0,
    visibility: pos ? "visible" : "hidden",
    "--arrow-x": `${pos?.arrow ?? WIDTH / 2}px`,
    "--origin-x": `${pos?.arrow ?? WIDTH / 2}px`,
    "--origin-y": pos?.up === false ? "0%" : "100%",
  } as CSSProperties;

  const node = (
    <div className="popover add-pop" ref={ref} data-state={props.hold ? "closed" : state} style={style} role="dialog" aria-label={title} onKeyDown={onKeyDown}>
      <div className="add-head">
        <span>{title}</span>
        <span className="subtle">Esc untuk tutup</span>
      </div>
      <ul className="add-list" ref={listRef}>
        {list.map((a, i) => (
          <li key={a.bundle_id}>
            <button className={i === hi ? "hl" : ""} onMouseEnter={() => setHi(i)} onClick={() => pick(a)}>
              <AppTile name={a.name} installed={a} known size={22} />
              <span className="add-name">{a.name}</span>
            </button>
          </li>
        ))}
        {list.length === 0 && <li className="add-empty">Tidak ada app yang cocok. Coba Telusuri…</li>}
      </ul>
      {onSpacer && (
        <button
          className="add-spacer"
          onClick={() => {
            onSpacer();
            inputRef.current?.focus();
          }}
        >
          <span className="divider-tile" style={{ width: 22, height: 22 }} aria-hidden />
          <span>Tambah pemisah</span>
          <span className="spacer" />
          <span className="subtle small">Garis antar app di dock</span>
        </button>
      )}
      <div className="add-search">
        <label className="search-field">
          <Icon name="search" size={13} />
          <input
            ref={inputRef}
            placeholder="Cari app"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Cari app"
          />
        </label>
        <button className="capsule small" onClick={browse} title="Pilih app lewat Finder">
          Telusuri…
        </button>
      </div>
      <svg className={`popover-arrow ${pos?.up === false ? "up" : "down"}`} viewBox="0 0 20 10" aria-hidden>
        <path d="M0 0 L20 0 L11.4 8.4 Q10 9.6 8.6 8.4 Z" fill="rgb(247 247 248 / 0.96)" />
      </svg>
    </div>
  );
  // Dipasang langsung di container supaya posisinya tidak bergeser oleh induk lain.
  return container ? createPortal(node, container) : node;
}
