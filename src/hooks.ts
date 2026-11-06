import { useCallback, useEffect, useMemo, useState } from "react";
import { api, on, type InstalledApp, type Preset, type Settings } from "./api";

/** App terpasang, dipindai sekali per jendela. `known` false selama pemindaian. */
export function useInstalledApps() {
  const [apps, setApps] = useState<InstalledApp[] | null>(null);
  const refresh = useCallback(() => {
    api.scanApps().then(setApps).catch(() => setApps([]));
  }, []);
  useEffect(refresh, [refresh]);
  const byId = useMemo(() => new Map((apps ?? []).map((a) => [a.bundle_id, a])), [apps]);
  return { apps: apps ?? [], byId, known: apps !== null, refresh };
}

/** Daftar preset, ikut berubah saat jendela lain menyimpan. */
export function usePresets() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(() => {
    api
      .listPresets()
      .then((r) => {
        setPresets(r.presets);
        if (r.warning) setWarning(r.warning);
      })
      .finally(() => setLoaded(true));
  }, []);
  useEffect(() => {
    reload();
    return on<Preset[]>("presets-changed", setPresets);
  }, [reload]);
  return { presets, setPresets, warning, clearWarning: () => setWarning(null), loaded, reload };
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    api.getSettings().then(setSettings);
    return on<Settings>("settings-changed", setSettings);
  }, []);
  const save = useCallback(async (next: Settings) => {
    setSettings(next);
    const saved = await api.saveSettings(next);
    setSettings(saved);
    return saved;
  }, []);
  return { settings, save };
}

/** Tutup menu saat klik di luar elemen atau tekan Escape. */
export function useDismiss(open: boolean, close: () => void, ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close, ref]);
}
