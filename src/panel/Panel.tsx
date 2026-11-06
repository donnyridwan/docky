import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  api,
  errorMessage,
  joinNames,
  MODE_LABEL,
  on,
  summarySentence,
  type Preset,
  type PresetMode,
  type Progress,
  type RunSummary,
  type Status,
  isTauri,
} from "../api";
import { AppTile } from "../components/AppTile";
import { Icon } from "../components/Icon";
import { useDismiss, useInstalledApps, usePresets, useSettings, useUpdateStatus } from "../hooks";
import { popupMenu } from "../menu";
import "./panel.css";

type Tone = "ok" | "warn" | "error";

type View =
  | { kind: "dock" }
  | { kind: "running"; progress: Progress | null }
  | { kind: "message"; tone: Tone; title: string; text: string }
  | { kind: "confirm-original" };

function toneFor(s: RunSummary): Tone {
  if (s.dock_error) return "error";
  if (s.still_running.length || s.missing.length || s.open_failed.length) return "warn";
  return "ok";
}

export function Panel() {
  const { presets, warning, clearWarning, loaded } = usePresets();
  const { settings, save: saveSettings } = useSettings();
  const { byId, known, refresh: rescan } = useInstalledApps();
  const [view, setView] = useState<View>({ kind: "dock" });
  const update = useUpdateStatus();
  const [status, setStatus] = useState<Status | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<HTMLDivElement>(null);

  const refreshStatus = useCallback(() => {
    api.status().then(setStatus).catch(() => {});
  }, []);

  useEffect(() => {
    refreshStatus();
    const offShown = on("panel-shown", () => {
      refreshStatus();
      rescan();
    });
    const offRestore = on("confirm-restore-original", () => {
      setCollapsed(false);
      setView({ kind: "confirm-original" });
    });
    const offProgress = on<Progress>("run-progress", (p) =>
      setView((v) => (v.kind === "running" ? { ...v, progress: p } : v)),
    );
    return () => {
      offShown();
      offRestore();
      offProgress();
    };
  }, [refreshStatus, rescan]);

  // Tinggi jendela mengikuti isi panel, lalu Rust meletakkannya tepat di atas dock.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      api.resizePanel(Math.ceil(el.getBoundingClientRect().height)).catch(() => {});
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useDismiss(menuOpen, () => setMenuOpen(false), menuRef);
  useDismiss(modeOpen, () => setModeOpen(false), modeRef);

  // Pesan file preset rusak ditampilkan sekali.
  useEffect(() => {
    if (warning) {
      setView({ kind: "message", tone: "error", title: "File preset rusak", text: warning });
      clearWarning();
    }
  }, [warning, clearWarning]);

  const selected: Preset | undefined =
    presets.find((p) => p.id === settings?.selected_preset) ?? presets[0];
  const busy = view.kind === "running" || !!status?.busy;
  const showWelcome = settings !== null && !settings.welcome_seen && view.kind === "dock";

  const select = (p: Preset) => {
    if (busy || !settings) return;
    saveSettings({ ...settings, selected_preset: p.id });
    setView({ kind: "dock" });
  };

  const setMode = async (mode: PresetMode) => {
    setModeOpen(false);
    if (!selected || selected.mode === mode) return;
    try {
      await api.savePreset({ ...selected, mode });
    } catch (e) {
      setView({ kind: "message", tone: "error", title: "Mode tidak tersimpan", text: errorMessage(e) });
    }
  };

  const run = async () => {
    if (!selected || busy) return;
    setView({ kind: "running", progress: null });
    try {
      const summary = await api.runPreset(selected.id);
      setView({
        kind: "message",
        tone: toneFor(summary),
        title: `Preset ${summary.preset_name} selesai`,
        text: summarySentence(summary),
      });
    } catch (e) {
      setView({ kind: "message", tone: "error", title: "Preset tidak dijalankan", text: errorMessage(e) });
    } finally {
      refreshStatus();
    }
  };

  const undo = async () => {
    if (busy) return;
    setView({ kind: "running", progress: null });
    try {
      const r = await api.undoLast();
      const parts = [r.dock_restored ? "Dock dikembalikan." : "Dock tidak berubah."];
      if (r.reopened.length) parts.push(`${joinNames(r.reopened)} dibuka lagi.`);
      if (r.open_failed.length) parts.push(`${joinNames(r.open_failed)} gagal dibuka.`);
      parts.push("Dokumen di dalam app belum tentu ikut kembali.");
      setView({ kind: "message", tone: r.open_failed.length ? "warn" : "ok", title: "Dikembalikan", text: parts.join(" ") });
    } catch (e) {
      setView({ kind: "message", tone: "error", title: "Tidak bisa dikembalikan", text: errorMessage(e) });
    } finally {
      refreshStatus();
    }
  };

  const restoreOriginal = async () => {
    setView({ kind: "running", progress: null });
    try {
      await api.restoreOriginalDock();
      setView({ kind: "message", tone: "ok", title: "Dock asli dipulihkan", text: "Isi dock kembali seperti sebelum Docky dipakai." });
    } catch (e) {
      setView({ kind: "message", tone: "error", title: "Dock asli tidak dipulihkan", text: errorMessage(e) });
    } finally {
      refreshStatus();
    }
  };

  const newPreset = async () => {
    if (busy) return;
    const base = "Preset baru";
    let name = base;
    for (let i = 2; presets.some((p) => p.name === name); i++) name = `${base} ${i}`;
    try {
      const draft = await api.presetFromCurrent(name);
      const saved = await api.savePreset(draft);
      const created = saved.find((p) => p.name === name) ?? saved[saved.length - 1];
      if (settings) await saveSettings({ ...settings, selected_preset: created.id, welcome_seen: true });
      setView({
        kind: "message",
        tone: "ok",
        title: `${name} dibuat`,
        text: `${created.apps.length} app dari kondisi sekarang. App yang sedang terbuka ditandai buka otomatis. Ubah nama dan urutannya di Pengaturan.`,
      });
    } catch (e) {
      setView({ kind: "message", tone: "error", title: "Preset tidak dibuat", text: errorMessage(e) });
    }
  };

  const installUpdate = async () => {
    try {
      await api.installUpdate(); // Docky dibuka ulang dengan versi baru.
    } catch (e) {
      setView({ kind: "message", tone: "error", title: "Update belum dipasang", text: errorMessage(e) });
    }
  };

  const openHeaderMenu = (anchor: HTMLElement) => {
    if (!isTauri) return setMenuOpen((o) => !o);
    popupMenu(anchor, [
      { text: "Pengaturan…", action: () => api.openSettings() },
      { text: "Kembalikan panel ke atas dock", action: () => api.resetPanelPosition() },
      {
        text: "Dock asli…",
        enabled: !busy && !!status?.has_backup,
        action: () => (setCollapsed(false), setView({ kind: "confirm-original" })),
      },
      "separator",
      { text: "Keluar Docky", action: () => api.quit() },
    ]);
  };

  const openModeMenu = (anchor: HTMLElement) => {
    if (!selected) return;
    if (!isTauri) return setModeOpen((o) => !o);
    popupMenu(
      anchor,
      (["clean", "dock_only"] as PresetMode[]).map((m) => ({
        text: MODE_LABEL[m],
        checked: selected.mode === m,
        action: () => setMode(m),
      })),
    );
  };

  const finishWelcome = async (createPreset: boolean) => {
    if (!settings) return;
    await saveSettings({ ...settings, welcome_seen: true });
    if (createPreset) await newPreset();
  };

  return (
    <div className="panel" ref={rootRef}>
      <header
        className="panel-header"
        title="Seret untuk memindahkan panel. Klik dua kali untuk kembali ke atas dock."
        onMouseDown={(e) => {
          // Seret dari bagian kosong header; tombol di header tetap bisa diklik.
          if (e.button === 0 && e.detail === 1 && !(e.target as HTMLElement).closest("button")) {
            api.startPanelDrag().catch(() => {});
          }
        }}
        onDoubleClick={(e) => {
          if (!(e.target as HTMLElement).closest("button")) api.resetPanelPosition().catch(() => {});
        }}
      >
        <button className="icon-btn" onClick={() => api.hidePanel()} aria-label="Tutup panel" title="Tutup">
          <Icon name="close" dim />
        </button>
        <span className="panel-title">Docky</span>
        <span className="spacer" />
        {update.state === "ready" && (
          <button
            className="update-pill"
            onClick={installUpdate}
            disabled={busy}
            title={`Pasang Docky ${update.version} lalu buka ulang`}
          >
            Restart untuk update <span aria-hidden>→</span>
          </button>
        )}
        <button
          className="icon-btn"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Bentangkan" : "Ciutkan"}
          aria-expanded={!collapsed}
          title={collapsed ? "Bentangkan" : "Ciutkan"}
        >
          <Icon name="collapse" dim className={collapsed ? "flipped" : undefined} />
        </button>
        <div className="menu-anchor" ref={menuRef}>
          <button className="icon-btn" onClick={(e) => openHeaderMenu(e.currentTarget)} aria-label="Menu" aria-haspopup="menu" aria-expanded={menuOpen}>
            <Icon name="menu" dim />
          </button>
          {menuOpen && (
            <div className="menu header-menu" role="menu">
              <button role="menuitem" onClick={() => (setMenuOpen(false), api.openSettings())}>
                Pengaturan…
              </button>
              <button role="menuitem" onClick={() => (setMenuOpen(false), api.resetPanelPosition())}>
                Kembalikan panel ke atas dock
              </button>
              <button
                role="menuitem"
                disabled={busy || !status?.has_backup}
                onClick={() => (setMenuOpen(false), setCollapsed(false), setView({ kind: "confirm-original" }))}
              >
                Dock asli…
              </button>
              <hr />
              <button role="menuitem" onClick={() => api.quit()}>
                Keluar Docky
              </button>
            </div>
          )}
        </div>
      </header>

      {!collapsed && (
        <div className="panel-body">
          <div className={`field${view.kind === "message" ? ` tone-${view.tone}` : ""}`} aria-live="polite">
            {showWelcome ? (
              <div className="field-text">
                <div className="field-title">Selamat datang di Docky</div>
                <p>
                  Simpan susunan app sebagai preset, lalu rapikan Mac dengan satu klik. Dock aslimu sudah dicadangkan;
                  pilih <b>Dock asli</b> di menu kapan saja untuk kembali.
                </p>
                <div className="field-actions">
                  <button className="pill primary" onClick={() => finishWelcome(true)}>
                    Buat preset dari kondisi sekarang
                  </button>
                  <button className="pill" onClick={() => finishWelcome(false)}>
                    Nanti saja
                  </button>
                </div>
              </div>
            ) : view.kind === "running" ? (
              <RunProgress progress={view.progress} />
            ) : view.kind === "message" ? (
              <div className="field-text">
                <div className="field-title">{view.title}</div>
                <p>{view.text}</p>
                <button className="icon-btn dismiss" onClick={() => setView({ kind: "dock" })} aria-label="Tutup pesan" title="Tutup">
                  <Icon name="close" dim />
                </button>
              </div>
            ) : view.kind === "confirm-original" ? (
              <div className="field-text">
                <div className="field-title">Pulihkan dock asli?</div>
                <p>Isi dock kembali seperti sebelum Docky pertama dipakai. App yang terbuka tidak ditutup, dan preset tetap tersimpan.</p>
                <div className="field-actions">
                  <button className="pill primary" onClick={restoreOriginal}>
                    Pulihkan
                  </button>
                  <button className="pill" onClick={() => setView({ kind: "dock" })}>
                    Batal
                  </button>
                </div>
              </div>
            ) : !selected ? (
              <div className="field-text">
                <p className="muted">
                  {loaded ? "Belum ada preset. Tekan + untuk membuat preset dari app yang sedang terbuka." : "Memuat…"}
                </p>
              </div>
            ) : (
              <>
                <div className="dock-apps">
                  {selected.apps
                    .slice()
                    .sort((a, b) => a.order - b.order)
                    .map((a) => (
                      <AppTile
                        key={a.bundle_id}
                        name={a.name}
                        installed={byId.get(a.bundle_id)}
                        known={known}
                        title={`${a.name}${a.auto_open ? " · buka otomatis" : ""}${known && !byId.has(a.bundle_id) ? " · tidak ditemukan" : ""}`}
                      />
                    ))}
                  <button className="tile add-tile" onClick={() => api.openSettings()} aria-label="Tambah app" title="Tambah app di Pengaturan">
                    <Icon name="plus" className="add-icon" />
                  </button>
                </div>
                <span className="spacer" />
                <div className="mode" ref={modeRef}>
                  <button className="mode-btn" onClick={(e) => openModeMenu(e.currentTarget)} aria-haspopup="menu" aria-expanded={modeOpen}>
                    <Icon name="sliders" />
                    <span>{MODE_LABEL[selected.mode]}</span>
                    <Icon name="chevron" dim />
                  </button>
                  {modeOpen && (
                    <div className="menu mode-menu" role="menu">
                      {(["clean", "dock_only"] as PresetMode[]).map((m) => (
                        <button key={m} role="menuitemradio" aria-checked={selected.mode === m} onClick={() => setMode(m)}>
                          <span className="check">{selected.mode === m && <Icon name="check" />}</span>
                          <span>
                            {MODE_LABEL[m]}
                            <small>{m === "clean" ? "Tutup, ganti dock, buka app" : "Hanya ganti isi dock"}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <footer className="panel-footer">
        <button className="round" onClick={newPreset} disabled={busy} aria-label="Preset baru dari kondisi sekarang" title="Preset baru dari kondisi sekarang">
          <Icon name="plus" />
        </button>
        <div className="chips" role="radiogroup" aria-label="Preset">
          {presets.map((p) => {
            const active = p.id === selected?.id;
            return (
              <button
                key={p.id}
                className={`pill${active ? " active" : ""}`}
                role="radio"
                aria-checked={active}
                onClick={() => select(p)}
                onDoubleClick={() => api.openSettings()}
                disabled={busy && !active}
                title={`${p.name} · ${MODE_LABEL[p.mode]}`}
              >
                <Icon name={active ? "check" : "layers"} />
                <span>{p.name}</span>
              </button>
            );
          })}
        </div>
        <span className="spacer" />
        <button className="pill" onClick={undo} disabled={busy || !status?.can_undo} title="Batalkan preset terakhir">
          <Icon name="undo" />
          <span>Kembalikan</span>
        </button>
        <button
          className="round blue"
          onClick={run}
          disabled={busy || !selected}
          aria-label={selected ? `Jalankan ${selected.name}` : "Jalankan"}
          title={selected ? `Jalankan ${selected.name}` : "Jalankan"}
        >
          {busy ? <span className="spinner" aria-hidden /> : <Icon name="play" />}
        </button>
      </footer>
    </div>
  );
}

function RunProgress({ progress }: { progress: Progress | null }) {
  const total = progress?.total ?? 5;
  const index = progress?.index ?? 0;
  const done = progress?.status === "done" ? index : index - 1;
  return (
    <div className="field-text run">
      <div className="field-title">
        {progress ? progress.label : "Menyiapkan…"}
        {progress && (
          <span className="muted">
            {" "}
            · Langkah {progress.index} dari {total}
          </span>
        )}
      </div>
      <div className="steps" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.max(done, 0)}>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={i < done ? "done" : i === done ? "current" : ""} />
        ))}
      </div>
      {progress?.detail && <p className="muted">{progress.detail}</p>}
    </div>
  );
}
