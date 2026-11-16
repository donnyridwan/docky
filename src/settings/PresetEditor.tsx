import { useEffect, useMemo, useRef, useState } from "react";
import { api, errorMessage, MODE_LABEL, MODES, type InstalledApp, type Preset, type PresetMode } from "../api";
import { AppTile } from "../components/AppTile";
import { Icon, type IconName } from "../components/Icon";
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

const MODE_ICON: Record<PresetMode, IconName> = { clean: "sliders", brutal: "bolt", dock_only: "dock" };

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
      <label className="field-block">
        <span className="field-label">Nama</span>
        <input
          className={`text-input${isNew ? " focus" : ""}`}
          value={draft.name}
          maxLength={40}
          autoFocus={isNew}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="Misalnya Kerja"
        />
      </label>

      <div className="field-block" role="radiogroup" aria-label="Mode">
        <span className="field-label">Mode</span>
        {MODES.map(({ mode: m, hint }) => (
          <button
            key={m}
            role="radio"
            aria-checked={draft.mode === m}
            className={`mode-option${draft.mode === m ? " selected" : ""}${m === "brutal" ? " brutal" : ""}`}
            onClick={() => setDraft({ ...draft, mode: m })}
          >
            <span className="radio" aria-hidden />
            <span className="mode-option-text">
              <span className="mode-option-title">
                <Icon name={MODE_ICON[m]} />
                {MODE_LABEL[m]}
              </span>
              <span className="mode-option-hint">{hint}</span>
            </span>
          </button>
        ))}
      </div>

      <div className="field-block">
        <div className="section-head">
          <span className="field-label">App di dock</span>
          <span className="subtle small">{sorted.length}</span>
          <span className="grow" />
          <span className="subtle small">Seret untuk mengubah urutan</span>
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
                <Icon name="grip" className="grip" />
                <span className="order">{i + 1}</span>
                <AppTile name={a.name} installed={byId.get(a.bundle_id)} known={known} size={28} />
                <span className="grow app-name">
                  <span className="name">{a.name}</span>
                  {missing && <span className="missing-note">Tidak ditemukan di Mac ini</span>}
                </span>
                <span className="sr-only">
                  <button onClick={() => move(i, i - 1)}>Naikkan {a.name}</button>
                  <button onClick={() => move(i, i + 1)}>Turunkan {a.name}</button>
                </span>
                <label className="toggle" title="Dibuka saat preset dijalankan (Bersih total dan Bersih brutal)">
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
                  <Icon name="close" />
                </button>
              </li>
            );
          })}
          {sorted.length === 0 && <li className="muted empty">Belum ada app. Tambahkan app yang ingin ada di dock.</li>}
        </ul>
        <button className="pill add-app" onClick={() => setPicking(true)}>
          <Icon name="plus" />
          Tambah app
        </button>
      </div>

      <div className="editor-foot">
        {error ? (
          <span className="error">{error}</span>
        ) : isNew ? (
          <>
            <Icon name="info" dim />
            <span className="small muted">Belum tersimpan</span>
          </>
        ) : confirmDelete ? (
          <>
            <Icon name="warning" className="warn" />
            <span className="confirm-text">Hapus preset {preset.name}?</span>
          </>
        ) : (
          <>
            <Icon name={saveState === "saving" ? "refresh" : "success"} className={saveState === "saving" ? "" : "ok"} />
            <span className="small muted" aria-live="polite">
              {!draft.name.trim() ? "Isi nama supaya tersimpan" : saveState === "saving" ? "Menyimpan…" : "Tersimpan otomatis"}
            </span>
          </>
        )}
        <span className="grow" />
        {isNew ? (
          <>
            <button className="pill no-icon" onClick={onCancelNew}>
              Batal
            </button>
            <button className="pill primary" onClick={create} disabled={!draft.name.trim()}>
              <Icon name="plus" />
              Buat preset
            </button>
          </>
        ) : confirmDelete ? (
          <>
            <button className="pill no-icon" onClick={() => setConfirmDelete(false)}>
              Batal
            </button>
            <button className="pill danger" onClick={remove}>
              <Icon name="trash" />
              Hapus
            </button>
          </>
        ) : (
          <button className="text-danger" onClick={() => setConfirmDelete(true)}>
            <Icon name="trash" />
            Hapus preset
          </button>
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
