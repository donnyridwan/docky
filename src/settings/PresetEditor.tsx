import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { api, errorMessage, isSpacer, newSpacer, renumber, type InstalledApp, type Preset, type PresetApp } from "../api";
import { AddAppPopover } from "../components/AddAppPopover";
import { AppTile } from "../components/AppTile";
import { Icon } from "../components/Icon";
import { Menu } from "../components/Menu";
import { Shelf } from "../components/Shelf";
import type { useInstalledApps } from "../hooks";
import type { MenuEntry } from "../menu";

interface Props {
  preset: Preset;
  installed: ReturnType<typeof useInstalledApps>;
  /** Elemen tempat popover dan menu diletakkan. */
  container: HTMLElement | null;
  onSaved: (list: Preset[]) => void;
  onDeleted: (list: Preset[]) => void;
}

function reorder<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Isi tab preset (Figma S1): nama, pratinjau rak dock, daftar app, Tambah app.
 * Mode dipilih di panel. Setiap perubahan tersimpan otomatis.
 */
export function PresetEditor({ preset, installed, container, onSaved, onDeleted }: Props) {
  const { apps, byId, known } = installed;
  const [draft, setDraft] = useState<Preset>(preset);
  const [adding, setAdding] = useState(false);
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);
  const [itemMenu, setItemMenu] = useState<{ anchor: HTMLElement; entries: MenuEntry[] } | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  /** Ada perubahan yang belum sampai ke presets.json. */
  const pending = useRef(false);

  // Preset yang sama berubah dari luar (misalnya mode diganti di panel):
  // ambil perubahannya kalau tidak ada yang tertunda.
  useEffect(() => {
    if (!pending.current) {
      setDraft((d) => ({ ...preset, name: d.name.trim() === preset.name ? d.name : preset.name }));
    }
  }, [preset]);

  const sorted = useMemo(() => draft.apps.slice().sort((a, b) => a.order - b.order), [draft.apps]);
  const appCount = sorted.filter((a) => !isSpacer(a.bundle_id)).length;
  const changed = JSON.stringify({ ...draft, name: draft.name.trim() }) !== JSON.stringify(preset);

  useEffect(() => {
    if (!changed || !draft.name.trim()) return;
    pending.current = true;
    setSaveState("saving");
    const timer = setTimeout(async () => {
      try {
        const list = await api.savePreset(draft);
        pending.current = false;
        setError(null);
        setSaveState("saved");
        onSaved(list);
      } catch (e) {
        pending.current = false;
        setSaveState("idle");
        setError(errorMessage(e));
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [draft]);

  const setApps = (list: PresetApp[]) => setDraft((d) => ({ ...d, apps: renumber(list) }));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= sorted.length || from === to) return;
    setApps(reorder(sorted, from, to));
  };
  const remove = (a: PresetApp) => setApps(sorted.filter((x) => x.bundle_id !== a.bundle_id));
  const toggleAuto = (a: PresetApp) =>
    setDraft((d) => ({ ...d, apps: d.apps.map((x) => (x.bundle_id === a.bundle_id ? { ...x, auto_open: !x.auto_open } : x)) }));

  const addApp = (app: InstalledApp) =>
    setDraft((d) =>
      d.apps.some((a) => a.bundle_id === app.bundle_id)
        ? d
        : { ...d, apps: [...d.apps, { bundle_id: app.bundle_id, name: app.name, order: d.apps.length + 1, auto_open: true }] },
    );
  const addSpacer = () => setDraft((d) => ({ ...d, apps: [...d.apps, newSpacer(d.apps.length + 1)] }));

  const openAdd = (anchor: HTMLElement) => {
    setAddAnchor(anchor);
    setAdding((open) => !(open && anchor === addAnchor));
  };
  const closeAdd = useCallback(() => setAdding(false), []);
  const closeMenu = useCallback(() => setItemMenu(null), []);

  const openItemMenu = (a: PresetApp, anchor: HTMLElement) =>
    setItemMenu(
      isSpacer(a.bundle_id)
        ? { anchor, entries: [{ text: "Hapus pemisah", icon: "close", action: () => remove(a) }] }
        : {
            anchor,
            entries: [
              { text: "Buka otomatis", checked: a.auto_open, action: () => toggleAuto(a) },
              "separator",
              { text: `Hapus ${a.name}`, icon: "close", action: () => remove(a) },
            ],
          },
    );

  const deletePreset = async () => {
    try {
      onDeleted(await api.deletePreset(draft.id));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="editor">
      <div className="group">
        <label className="row">
          <span className="grow name">Nama</span>
          <input
            className="text-input"
            value={draft.name}
            maxLength={40}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Misalnya Kerja"
          />
        </label>
      </div>

      <Shelf apps={sorted} byId={byId} known={known} onAdd={openAdd} addOpen={adding && addAnchor?.classList.contains("shelf-add")} onItem={openItemMenu} />

      <section className="section">
        <div className="section-head">
          App di dock · {appCount}
          <span className="muted">Seret untuk mengubah urutan</span>
        </div>
        <ul className="group" onDragOver={(e) => e.preventDefault()}>
          {sorted.map((a, i) => {
            const spacer = isSpacer(a.bundle_id);
            const missing = !spacer && known && !byId.has(a.bundle_id);
            return (
              <li
                key={a.bundle_id}
                className={[
                  "row app-row",
                  dragIndex === i ? "dragging" : "",
                  overIndex === i && dragIndex !== null && dragIndex !== i ? (dragIndex < i ? "drop-after" : "drop-before") : "",
                  missing ? "missing" : "",
                ].join(" ")}
                style={{ "--inset": "62px", animationDelay: `${Math.min(i * 15, 120)}ms` } as CSSProperties}
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
                <Icon name="grip" size={14} className="grip" />
                {spacer ? (
                  <span className="divider-tile" style={{ width: 28, height: 28 }} aria-hidden />
                ) : (
                  <AppTile name={a.name} installed={byId.get(a.bundle_id)} known={known} size={28} />
                )}
                <span className="grow app-name">
                  <span className={`name${spacer ? " muted" : ""}`}>{spacer ? "Pemisah" : a.name}</span>
                  {missing && <span className="missing-note">Tidak ditemukan di Mac ini</span>}
                </span>
                <span className="sr-only">
                  <button onClick={() => move(i, i - 1)}>Naikkan {a.name}</button>
                  <button onClick={() => move(i, i + 1)}>Turunkan {a.name}</button>
                </span>
                {!spacer && (
                  <label className="toggle" title="Dibuka saat preset dijalankan (Bersih total dan Bersih brutal)">
                    <span>Buka otomatis</span>
                    <button
                      className="switch"
                      role="switch"
                      aria-checked={a.auto_open}
                      aria-label={`Buka otomatis ${a.name}`}
                      onClick={() => toggleAuto(a)}
                    />
                  </label>
                )}
                <button
                  className="remove"
                  aria-label={spacer ? "Hapus pemisah" : `Hapus ${a.name} dari preset`}
                  title={spacer ? "Hapus pemisah" : "Hapus dari preset"}
                  onClick={() => remove(a)}
                >
                  <Icon name="close" size={14} />
                </button>
              </li>
            );
          })}
          {sorted.length === 0 && <li className="row empty-row muted">Belum ada app. Tambahkan app yang ingin ada di dock.</li>}
        </ul>
      </section>

      <div>
        <button
          className={`capsule${adding && !addAnchor?.classList.contains("shelf-add") ? " active-tint" : ""}`}
          onClick={(e) => openAdd(e.currentTarget)}
        >
          <Icon name="plus" size={13} />
          Tambah app
        </button>
      </div>

      <span className="grow" />

      <div className="editor-foot">
        {error ? (
          <span className="error">{error}</span>
        ) : confirmDelete ? (
          <>
            <Icon name="warning" size={14} className="warn" />
            <span className="confirm-text">Hapus preset {preset.name}?</span>
          </>
        ) : (
          <>
            <Icon
              key={saveState === "saving" ? "saving" : "saved"}
              name={saveState === "saving" ? "refresh" : "success"}
              size={14}
              className={`save-icon${saveState === "saving" ? " spin" : " ok"}`}
            />
            <span aria-live="polite">
              {!draft.name.trim() ? "Isi nama supaya tersimpan" : saveState === "saving" ? "Menyimpan…" : "Tersimpan otomatis"}
            </span>
          </>
        )}
        <span className="grow" />
        {confirmDelete ? (
          <>
            <button className="capsule" onClick={() => setConfirmDelete(false)}>
              Batal
            </button>
            <button className="capsule danger" onClick={deletePreset}>
              <Icon name="trash" size={13} />
              Hapus
            </button>
          </>
        ) : (
          <button className="text-danger press" onClick={() => setConfirmDelete(true)}>
            <Icon name="trash" size={14} />
            Hapus preset
          </button>
        )}
      </div>

      <AddAppPopover
        open={adding}
        anchor={addAnchor}
        container={container}
        title={`Tambah app ke “${draft.name.trim() || "preset"}”`}
        apps={apps}
        exclude={new Set(draft.apps.map((a) => a.bundle_id))}
        onPick={addApp}
        onSpacer={addSpacer}
        onClose={closeAdd}
        onError={setError}
      />
      <Menu open={!!itemMenu} anchor={itemMenu?.anchor ?? null} container={container} entries={itemMenu?.entries ?? []} onClose={closeMenu} />
    </div>
  );
}
