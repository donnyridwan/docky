import type { Ref } from "react";
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
}

/** Jeda masuk bertahap, dibatasi supaya rak panjang tidak terasa lambat. */
const delay = (i: number) => ({ animationDelay: `${Math.min(i * 18, 140)}ms` });

/**
 * Pratinjau rak dock (Figma "Panggung pratinjau"): ikon tanpa nama, titik di
 * bawah = dibuka otomatis, garis = pemisah, kotak + = tambah app.
 */
export function Shelf({ apps, byId, known, onAdd, addOpen, addRef, onItem }: Props) {
  return (
    <div className="stage">
      <div className="shelf">
        {apps.map((a, i) => {
          if (isSpacer(a.bundle_id)) {
            return (
              <button
                key={a.bundle_id}
                className="shelf-divider-hit"
                style={delay(i)}
                aria-label="Pemisah"
                title="Pemisah"
                onClick={(e) => onItem?.(a, e.currentTarget)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onItem?.(a, e.currentTarget);
                }}
              >
                <span className="shelf-divider" />
              </button>
            );
          }
          const missing = known && !byId.has(a.bundle_id);
          return (
            <button
              key={a.bundle_id}
              className="shelf-item"
              style={delay(i)}
              onClick={(e) => onItem?.(a, e.currentTarget)}
              onContextMenu={(e) => {
                e.preventDefault();
                onItem?.(a, e.currentTarget);
              }}
              title={`${a.name}${a.auto_open ? " · buka otomatis" : ""}${missing ? " · tidak ditemukan" : ""}`}
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
