import { useEffect, useMemo, useRef, useState } from "react";
import type { InstalledApp } from "../api";
import { AppTile } from "../components/AppTile";
import { Icon } from "../components/Icon";

interface Props {
  apps: InstalledApp[];
  exclude: Set<string>;
  title: string;
  onPick: (app: InstalledApp) => void;
  onClose: () => void;
}

/** Daftar app terpasang dengan pencarian, untuk menambah app ke preset atau pengecualian. */
export function AppPicker({ apps, exclude, title, onPick, onClose }: Props) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return apps.filter(
      (a) => !exclude.has(a.bundle_id) && (!q || a.name.toLowerCase().includes(q) || a.bundle_id.toLowerCase().includes(q)),
    );
  }, [apps, exclude, query]);

  return (
    <div className="picker-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="picker" role="dialog" aria-label={title} onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <div className="picker-head">
          <span className="picker-title">{title}</span>
          <label className="search">
            <Icon name="search" dim />
            <input
              ref={inputRef}
              placeholder="Cari app"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && list[0]) onPick(list[0]);
              }}
            />
          </label>
        </div>
        <ul className="picker-list">
          {list.map((a) => (
            <li key={a.bundle_id}>
              <button onClick={() => onPick(a)}>
                <AppTile name={a.name} installed={a} known size={24} />
                <span className="grow">{a.name}</span>
                <span className="subtle small bundle">{a.bundle_id}</span>
              </button>
            </li>
          ))}
          {list.length === 0 && <li className="muted empty">Tidak ada app yang cocok.</li>}
        </ul>
        <div className="picker-foot">
          <span className="subtle small">Enter = tambah hasil pertama · Esc = tutup</span>
          <span className="grow" />
          <button className="pill primary no-icon" onClick={onClose}>
            Selesai
          </button>
        </div>
      </div>
    </div>
  );
}
