import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { api, errorMessage, newSpacer, on, sortedApps, type InstalledApp, type Preset } from "../api";
import { AddAppBody, POPOVER_WIDTH, PopoverArrow } from "../components/AddAppPopover";
import { useInstalledApps, usePresets } from "../hooks";
import "./picker.css";

/** Ruang di kiri jendela sebelum kotak popover (untuk bayangan). */
const MARGIN = 20;

/**
 * Popover Tambah app sebagai jendela kecil sendiri di atas tombol + panel
 * (Figma S6). Jendela panel tidak perlu diperbesar, jadi tidak ada kedip.
 */
export function PickerWindow() {
  const { presets, setPresets } = usePresets();
  const { apps, refresh } = useInstalledApps();
  const [presetId, setPresetId] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState(0);
  const [state, setState] = useState<"open" | "closed">("closed");
  const [arrow, setArrow] = useState(POPOVER_WIDTH / 2);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const offOpen = on<string>("picker-open", (id) => {
      setState("closed");
      setPresetId(id);
      setOpenKey((k) => k + 1);
      refresh();
    });
    const offHidden = on("picker-hidden", () => setState("closed"));
    return () => {
      offOpen();
      offHidden();
    };
  }, [refresh]);

  // Ukur, minta Rust meletakkan dan menampilkan jendela, lalu animasi masuk.
  useLayoutEffect(() => {
    if (!openKey || !wrapRef.current) return;
    const r = wrapRef.current.getBoundingClientRect();
    let cancelled = false;
    api
      .showPicker(Math.ceil(r.width), Math.ceil(r.height))
      .then((center) => {
        if (cancelled) return;
        setArrow(Math.round(center - MARGIN));
        requestAnimationFrame(() => requestAnimationFrame(() => !cancelled && setState("open")));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [openKey]);

  const preset = presets.find((p) => p.id === presetId);

  const save = async (next: Preset) => {
    setPresets((list) => list.map((p) => (p.id === next.id ? next : p)));
    try {
      setPresets(await api.savePreset(next));
    } catch (e) {
      api.notify("App tidak bisa ditambahkan", errorMessage(e)).catch(() => {});
    }
  };

  const addApp = (app: InstalledApp) => {
    if (!preset || preset.apps.some((a) => a.bundle_id === app.bundle_id)) return;
    const list = sortedApps(preset);
    save({ ...preset, apps: [...list, { bundle_id: app.bundle_id, name: app.name, order: list.length + 1, auto_open: true }] });
  };

  const addSpacer = () => {
    if (!preset) return;
    const list = sortedApps(preset);
    save({ ...preset, apps: [...list, newSpacer(list.length + 1)] });
  };

  const close = () => {
    setState("closed");
    setTimeout(() => api.hidePicker().catch(() => {}), 120);
  };

  const style = {
    width: POPOVER_WIDTH,
    "--arrow-x": `${arrow}px`,
    "--origin-x": `${arrow}px`,
    "--origin-y": "100%",
  } as CSSProperties;

  return (
    <div className="picker-wrap" ref={wrapRef}>
      <div className="popover picker-pop" data-state={state} style={style} role="dialog" aria-label="Tambah app">
        <AddAppBody
          title={preset ? `Tambah app ke “${preset.name}”` : "Tambah app"}
          apps={apps}
          exclude={new Set(preset?.apps.map((a) => a.bundle_id) ?? [])}
          onPick={addApp}
          onSpacer={addSpacer}
          onClose={close}
          openKey={openKey}
          onBrowse={(active) => api.setPickerBrowsing(active).catch(() => {})}
          onError={(m) => api.notify("App tidak bisa ditambahkan", m).catch(() => {})}
        />
        <PopoverArrow />
      </div>
    </div>
  );
}
