import { useEffect, useMemo, useRef, useState } from "react";
import { api, errorMessage, MODE_LABEL, MODES, type InstalledApp, type Preset } from "../api";
import { AppTile } from "../components/AppTile";
import { AppPicker } from "./AppPicker";

interface Props {
  preset: Preset;
  isNew: boolean;
  byId: Map<string, InstalledApp>;
  apps: InstalledApp[];
  known: boolean;
  onSaved: (p: Preset[], id: string) => void;
  onDeleted: (p: Preset[]) => void;
  onCancelNew: () => void;
}

function reorder<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function PresetEditor({ preset, isNew, byId, apps, known, onSaved, onDeleted, onCancelNew }: Props) {
  const [draft, setDraft] = useState<Preset>(preset);
  const [picking, setPicking] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  /** Ada perubahan yang belum sampai ke presets.json. */
  const pending = useRef(false);

  // Ganti preset yang diedit: mulai dari isinya. Preset yang sama berubah dari luar
  // (misalnya mode diganti di panel): ambil perubahannya kalau tidak ada yang tertunda.
  const lastId = useRef(preset.id);
  useEffect(() => {
    if (preset.id !== lastId.current) {
      lastId.current = preset.id;
      pending.current = false;
      setDraft(preset);
      setConfirmDelete(false);
      setError(null);
      setSaveState("idle");
    } else if (!pending.current) {
      // Pertahankan spasi di akhir nama yang sedang diketik.
      setDraft((d) => ({ ...preset, name: d.name.trim() === preset.name ? d.name : preset.name }));
    }
  }, [preset]);

  const sorted = useMemo(() => draft.apps.slice().sort((a, b) => a.order - b.order), [draft.apps]);
  const changed = JSON.stringify({ ...draft, name: draft.name.trim() }) !== JSON.stringify(preset);

  // Simpan otomatis setiap perubahan pada preset yang sudah ada, supaya saklar
  // "Buka otomatis" dan urutan app langsung berlaku tanpa tombol Simpan.
  useEffect(() => {
    if (isNew || !changed || !draft.name.trim()) return;
    pending.current = true;
    setSaveState("saving");
    const timer = setTimeout(async () => {
      try {
        const list = await api.savePreset(draft);
        pending.current = false;
        setError(null);
        setSaveState("saved");
        onSaved(list, draft.id);
      } catch (e) {
        pending.current = false;
        setSaveState("idle");
        setError(errorMessage(e));
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [draft]);

  const setApps = (list: typeof sorted) =>
    setDraft((d) => ({ ...d, apps: list.map((a, i) => ({ ...a, order: i + 1 })) }));

  const move = (from: number, to: number) => {
    if (to < 0 || to >= sorted.length || from === to) return;
    setApps(reorder(sorted, from, to));
  };

  /** Hanya untuk preset baru; preset yang sudah ada tersimpan otomatis. */
  const create = async () => {
    setError(null);
    try {
      const list = await api.savePreset(draft);
      const saved = list.find((p) => p.id === draft.id) ?? list.find((p) => p.name === draft.name.trim());
      onSaved(list, saved?.id ?? draft.id);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const remove = async () => {
    try {
      onDeleted(await api.deletePreset(draft.id));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="editor">
      <label className="row">
        <span className="label">Nama</span>
        <input
          className="text-input grow"
          value={draft.name}
          maxLength={40}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="Misalnya Kerja"
        />
      </label>

      <div className="row">
        <span className="label">Mode</span>
        <div className="segmented" role="radiogroup" aria-label="Mode">
          {MODES.map(({ mode: m }) => (
            <button key={m} role="radio" aria-checked={draft.mode === m} onClick={() => setDraft({ ...draft, mode: m })}>
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      </div>
      <p className="hint">
        {draft.mode === "clean"
          ? "Menutup app di luar preset, mengganti isi dock, lalu membuka app yang ditandai buka otomatis."
          : draft.mode === "brutal"
            ? "Menutup semua app, termasuk browser dan app di preset, lalu membuka ulang dari awal (tanpa jendela dan tab lama) hanya app yang buka otomatis-nya menyala. Docky, Finder, app menu bar, dan Pengecualian dibiarkan. App dengan pekerjaan belum disimpan tidak dipaksa tutup."
            : "Hanya mengganti isi dock. Tidak ada app yang ditutup atau dibuka."}
      </p>

      <div className="section-head">
        <span>App di dock</span>
        <span className="muted small">Seret untuk mengubah urutan</span>
      </div>
      <ul className="app-list" onDragOver={(e) => e.preventDefault()}>
        {sorted.map((a, i) => {
          const missing = known && !byId.has(a.bundle_id);
          return (
            <li
              key={a.bundle_id}
              className={[
                "app-row",
                dragIndex === i ? "dragging" : "",
                overIndex === i && dragIndex !== null && dragIndex !== i ? (dragIndex < i ? "drop-after" : "drop-before") : "",
                missing ? "missing" : "",
              ].join(" ")}
              draggable
              onDragStart={(e) => {
                setDragIndex(i);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(i));
              }}
              onDragEnter={() => setOverIndex(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIndex !== null) move(dragIndex, i);
                setDragIndex(null);
                setOverIndex(null);
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setOverIndex(null);
              }}
            >
              <span className="grip" aria-hidden>
                ⋮⋮
              </span>
              <span className="order">{i + 1}</span>
              <AppTile name={a.name} installed={byId.get(a.bundle_id)} known={known} size={28} />
              <span className="grow name">
                {a.name}
                {missing && <span className="tag">tidak ditemukan</span>}
              </span>
              <span className="sr-only">
                <button onClick={() => move(i, i - 1)}>Naikkan {a.name}</button>
                <button onClick={() => move(i, i + 1)}>Turunkan {a.name}</button>
              </span>
              <label className="toggle" title="Dibuka saat preset dijalankan (mode Bersih total)">
                <span className="small muted">Buka otomatis</span>
                <button
                  className="switch"
                  role="switch"
                  aria-checked={a.auto_open}
                  aria-label={`Buka otomatis ${a.name}`}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      apps: draft.apps.map((x) => (x.bundle_id === a.bundle_id ? { ...x, auto_open: !x.auto_open } : x)),
                    })
                  }
                />
              </label>
              <button
                className="remove"
                aria-label={`Hapus ${a.name} dari preset`}
                title="Hapus dari preset"
                onClick={() => setApps(sorted.filter((x) => x.bundle_id !== a.bundle_id))}
              >
                ×
              </button>
            </li>
          );
        })}
        {sorted.length === 0 && <li className="muted empty">Belum ada app. Tambahkan app yang ingin ada di dock.</li>}
      </ul>
      <button className="pill add-app" onClick={() => setPicking(true)}>
        + Tambah app
      </button>

      <div className="editor-foot">
        {error && <span className="error">{error}</span>}
        <span className="grow" />
        {isNew ? (
          <button className="pill" onClick={onCancelNew}>
            Batal
          </button>
        ) : confirmDelete ? (
          <>
            <span className="small muted">Hapus preset {preset.name}?</span>
            <button className="pill danger" onClick={remove}>
              Hapus
            </button>
            <button className="pill" onClick={() => setConfirmDelete(false)}>
              Batal
            </button>
          </>
        ) : (
          <button className="pill" onClick={() => setConfirmDelete(true)}>
            Hapus preset
          </button>
        )}
        {isNew ? (
          <button className="pill primary" onClick={create} disabled={!draft.name.trim()}>
            Buat preset
          </button>
        ) : (
          <span className="small muted save-state" aria-live="polite">
            {!draft.name.trim() ? "Isi nama supaya tersimpan" : saveState === "saving" ? "Menyimpan…" : "Tersimpan otomatis"}
          </span>
        )}
      </div>

      {picking && (
        <AppPicker
          title="Tambah app ke preset"
          apps={apps}
          exclude={new Set(draft.apps.map((a) => a.bundle_id))}
          onClose={() => setPicking(false)}
          onPick={(app) =>
            setDraft((d) => ({
              ...d,
              apps: [...d.apps, { bundle_id: app.bundle_id, name: app.name, order: d.apps.length + 1, auto_open: true }],
            }))
          }
        />
      )}
    </div>
  );
}
