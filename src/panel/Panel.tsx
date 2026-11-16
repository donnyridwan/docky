import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  api,
  errorMessage,
  isTauri,
  joinNames,
  MODE_LABEL,
  MODES,
  on,
  summarySentence,
  type Preset,
  type PresetMode,
  type Progress,
  type Status,
} from "../api";
import { AppTile } from "../components/AppTile";
import { Icon, type IconName } from "../components/Icon";
import { useDismiss, useInstalledApps, usePresets, useSettings, useUpdateStatus } from "../hooks";
import { popupMenu } from "../menu";
import "./panel.css";

/** Ukuran ikon app di area isi dock, dalam px (Figma: App tile 52 px). */
const TILE_SIZE = 52;

const MODE_ICON: Record<PresetMode, IconName> = { clean: "sliders", brutal: "bolt", dock_only: "dock" };

/** Nama langkah di bawah bar progres (Figma P6/P7). */
const STEP_NAMES: Record<PresetMode, string[]> = {
  clean: ["Potret", "Tutup app", "Tunggu", "Ganti dock", "Buka app"],
  brutal: ["Potret", "Tutup semua", "Tunggu", "Ganti dock", "Buka ulang"],
  dock_only: ["Potret", "Ganti dock"],
};

type View =
  | { kind: "dock" }
  | { kind: "running"; mode: PresetMode; progress: Progress | null }
  | { kind: "confirm-original" };

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

  /** Kabar hasil lewat notifikasi macOS, supaya panel tetap menampilkan isi dock. */
  const report = useCallback((title: string, body: string) => {
    api.notify(title, body).catch(() => {});
    setView({ kind: "dock" });
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
      report("File preset rusak", warning);
      clearWarning();
    }
  }, [warning, clearWarning, report]);

  const selected: Preset | undefined =
    presets.find((p) => p.id === settings?.selected_preset) ?? presets[0];
  const busy = view.kind === "running" || !!status?.busy;
  const showWelcome = settings !== null && !settings.welcome_seen && view.kind === "dock";
  const brutal = selected?.mode === "brutal";

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
      report("Mode tidak tersimpan", errorMessage(e));
    }
  };

  const run = async () => {
    if (!selected || busy) return;
    setView({ kind: "running", mode: selected.mode, progress: null });
    try {
      const summary = await api.runPreset(selected.id);
      report(`Preset ${summary.preset_name} selesai`, summarySentence(summary));
    } catch (e) {
      report("Preset tidak dijalankan", errorMessage(e));
    } finally {
      refreshStatus();
    }
  };

  const undo = async () => {
    if (busy) return;
    setView({ kind: "running", mode: "dock_only", progress: null });
    try {
      const r = await api.undoLast();
      const parts = [r.dock_restored ? "Dock dikembalikan." : "Dock tidak berubah."];
      if (r.reopened.length) parts.push(`${joinNames(r.reopened)} dibuka lagi.`);
      if (r.open_failed.length) parts.push(`${joinNames(r.open_failed)} gagal dibuka.`);
      parts.push("Dokumen di dalam app belum tentu ikut kembali.");
      report("Dikembalikan", parts.join(" "));
    } catch (e) {
      report("Tidak bisa dikembalikan", errorMessage(e));
    } finally {
      refreshStatus();
    }
  };

  const restoreOriginal = async () => {
    setView({ kind: "running", mode: "dock_only", progress: null });
    try {
      await api.restoreOriginalDock();
      report("Dock asli dipulihkan", "Isi dock kembali seperti sebelum Docky dipakai.");
    } catch (e) {
      report("Dock asli tidak dipulihkan", errorMessage(e));
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
      report(`${name} dibuat`, `${created.apps.length} app dari kondisi sekarang. Ubah nama dan urutannya di Pengaturan.`);
    } catch (e) {
      report("Preset tidak dibuat", errorMessage(e));
    }
  };

  const installUpdate = async () => {
    try {
      await api.installUpdate(); // Docky dibuka ulang dengan versi baru.
    } catch (e) {
      report("Update belum dipasang", errorMessage(e));
    }
  };

  const checkUpdate = async () => {
    const s = await api.checkUpdate();
    if (s.state === "up_to_date") report("Docky sudah versi terbaru", `Versi ${status?.version ?? ""} adalah yang terbaru.`);
    else if (s.state === "error") report("Update belum bisa dicek", s.message);
  };

  const confirmOriginal = () => {
    setCollapsed(false);
    setView({ kind: "confirm-original" });
  };

  const openHeaderMenu = (anchor: HTMLElement) => {
    if (!isTauri) return setMenuOpen((o) => !o);
    popupMenu(anchor, [
      { text: "Pengaturan…", action: () => api.openSettings() },
      { text: "Kembalikan panel ke atas dock", action: () => api.resetPanelPosition() },
      { text: "Dock asli…", enabled: !busy && !!status?.has_backup, action: confirmOriginal },
      "separator",
      update.state === "ready"
        ? { text: `Restart untuk update ke ${update.version}`, enabled: !busy, action: installUpdate }
        : { text: "Periksa update", action: checkUpdate },
      "separator",
      { text: "Keluar Docky", action: () => api.quit() },
    ]);
  };

  const openModeMenu = (anchor: HTMLElement) => {
    if (!selected) return;
    if (!isTauri) return setModeOpen((o) => !o);
    popupMenu(
      anchor,
      MODES.map(({ mode: m }) => ({ text: MODE_LABEL[m], checked: selected.mode === m, action: () => setMode(m) })),
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
        <div className="header-lead">
          <button className="icon-btn" onClick={() => api.hidePanel()} aria-label="Tutup panel" title="Tutup">
            <Icon name="close" dim />
          </button>
          <Icon name="dock" className="logo" />
        </div>
        <div className="tabs" role="tablist" aria-label="Preset">
          {presets.map((p) => {
            const active = p.id === selected?.id;
            return (
              <button
                key={p.id}
                className={`tab${active ? " active" : ""}`}
                role="tab"
                aria-selected={active}
                onClick={() => select(p)}
                onDoubleClick={() => api.openSettings()}
                disabled={busy && !active}
                title={`${p.name} · ${MODE_LABEL[p.mode]}`}
              >
                <span className={`tab-dot ${p.mode}`} aria-hidden />
                <span className="tab-name">{p.name}</span>
              </button>
            );
          })}
          <button className="tab-new" onClick={newPreset} disabled={busy} aria-label="Preset baru dari kondisi sekarang" title="Preset baru dari kondisi sekarang">
            <Icon name="plus" />
          </button>
        </div>
        <span className="spacer" />
        <div className="header-trail">
        {update.state === "ready" && (
          <button className="update-pill" onClick={installUpdate} disabled={busy} title={`Pasang Docky ${update.version} lalu buka ulang`}>
            Restart untuk update
            <Icon name="arrow" size={12} />
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
                <span className="check" />
                Pengaturan…
              </button>
              <button role="menuitem" onClick={() => (setMenuOpen(false), api.resetPanelPosition())}>
                <span className="check" />
                Kembalikan panel ke atas dock
              </button>
              <button role="menuitem" disabled={busy || !status?.has_backup} onClick={() => (setMenuOpen(false), confirmOriginal())}>
                <span className="check" />
                Dock asli…
              </button>
              <hr />
              <button role="menuitem" onClick={() => (setMenuOpen(false), checkUpdate())}>
                <span className="check" />
                Periksa update
              </button>
              <hr />
              <button role="menuitem" onClick={() => api.quit()}>
                <span className="check" />
                Keluar Docky
              </button>
            </div>
          )}
        </div>
        </div>
      </header>

      {!collapsed && (
        <div className="panel-body">
          <div className="field" aria-live="polite">
            {showWelcome ? (
              <Message
                icon="dock"
                title="Selamat datang di Docky"
                text="Simpan susunan app sebagai preset, lalu rapikan Mac dengan satu klik. Dock aslimu sudah dicadangkan; pilih Dock asli di menu ☰ kapan saja untuk kembali."
              >
                <button className="pill primary" onClick={() => finishWelcome(true)}>
                  <Icon name="plus" />
                  Buat preset dari kondisi sekarang
                </button>
                <button className="pill no-icon" onClick={() => finishWelcome(false)}>
                  Nanti saja
                </button>
              </Message>
            ) : view.kind === "running" ? (
              <RunProgress progress={view.progress} mode={view.mode} />
            ) : view.kind === "confirm-original" ? (
              <Message
                icon="warning"
                tone="warning"
                title="Pulihkan dock asli?"
                text="Isi dock kembali seperti sebelum Docky pertama dipakai. App yang terbuka tidak ditutup, dan preset tetap tersimpan."
              >
                <button className="pill primary" onClick={restoreOriginal}>
                  <Icon name="undo" />
                  Pulihkan
                </button>
                <button className="pill no-icon" onClick={() => setView({ kind: "dock" })}>
                  Batal
                </button>
              </Message>
            ) : !selected ? (
              loaded ? (
                <Message
                  icon="layers"
                  tone="muted"
                  title="Belum ada preset"
                  text="Simpan susunan app yang sedang terbuka sebagai preset pertama, atau buat dari Pengaturan."
                >
                  <button className="pill primary" onClick={newPreset} disabled={busy}>
                    <Icon name="plus" />
                    Buat dari kondisi sekarang
                  </button>
                  <button className="pill" onClick={() => api.openSettings()}>
                    <Icon name="gear" />
                    Buka Pengaturan
                  </button>
                </Message>
              ) : (
                <p className="muted loading">Memuat…</p>
              )
            ) : (
              <>
                <div className="dock-apps">
                  {selected.apps
                    .slice()
                    .sort((a, b) => a.order - b.order)
                    .map((a) => {
                      const missing = known && !byId.has(a.bundle_id);
                      return (
                        <div className={`dock-app${missing ? " missing" : ""}`} key={a.bundle_id}>
                          <div className="dock-app-icon">
                            <AppTile
                              name={a.name}
                              installed={byId.get(a.bundle_id)}
                              known={known}
                              size={TILE_SIZE}
                              title={`${a.name}${a.auto_open ? " · buka otomatis" : ""}${missing ? " · tidak ditemukan" : ""}`}
                            />
                            {missing && (
                              <span className="badge" title="Tidak ditemukan di Mac ini">
                                <Icon name="warning" size={11} />
                              </span>
                            )}
                          </div>
                          <span className={`auto-dot${a.auto_open ? " on" : ""}`} aria-hidden />
                          <span className="dock-app-name">{a.name}</span>
                        </div>
                      );
                    })}
                  <button className="dock-app add" onClick={() => api.openSettings()} aria-label="Tambah app" title="Tambah app di Pengaturan">
                    <span className="add-box" style={{ width: TILE_SIZE, height: TILE_SIZE }}>
                      <Icon name="plus" />
                    </span>
                    <span className="auto-dot" aria-hidden />
                    <span className="dock-app-name">Tambah</span>
                  </button>
                </div>
                <span className="spacer" />
                <div className="mode" ref={modeRef}>
                  <button
                    className={`mode-pill${brutal ? " brutal" : ""}`}
                    onClick={(e) => openModeMenu(e.currentTarget)}
                    aria-haspopup="menu"
                    aria-expanded={modeOpen}
                  >
                    <Icon name={MODE_ICON[selected.mode]} />
                    <span>{MODE_LABEL[selected.mode]}</span>
                    <Icon name="chevron" dim />
                  </button>
                  <span className="mode-hint">{MODES.find((m) => m.mode === selected.mode)?.short}</span>
                  {modeOpen && (
                    <div className="menu mode-menu" role="menu">
                      {MODES.map(({ mode: m, hint }) => (
                        <button key={m} role="menuitemradio" aria-checked={selected.mode === m} onClick={() => setMode(m)}>
                          <span className="check">{selected.mode === m && <Icon name="check" />}</span>
                          <span>
                            {MODE_LABEL[m]}
                            <small>{hint}</small>
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
        <span className="spacer" />
        <button className="pill" onClick={undo} disabled={busy || !status?.can_undo} title="Batalkan preset terakhir">
          <Icon name="undo" />
          Kembalikan
        </button>
        <button
          className={`pill ${brutal ? "brutal" : "primary"} run-btn`}
          onClick={run}
          disabled={busy || !selected}
          title={selected ? `Jalankan ${selected.name} · ${MODE_LABEL[selected.mode]}` : "Jalankan"}
        >
          {busy ? <span className="spinner" aria-hidden /> : <Icon name={brutal ? "bolt" : "play"} />}
          {busy ? "Berjalan…" : "Jalankan"}
        </button>
      </footer>
    </div>
  );
}

function Message({
  icon,
  tone,
  title,
  text,
  children,
}: {
  icon: IconName;
  tone?: "warning" | "muted";
  title: string;
  text: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="message">
      <Icon name={icon} size={20} className={`message-icon${tone ? ` ${tone}` : ""}`} />
      <div className="message-text">
        <div className="message-title">{title}</div>
        <p>{text}</p>
        {children && <div className="message-actions">{children}</div>}
      </div>
    </div>
  );
}

function RunProgress({ progress, mode }: { progress: Progress | null; mode: PresetMode }) {
  const names = STEP_NAMES[mode];
  const total = progress?.total ?? names.length;
  const index = progress?.index ?? 0;
  const done = progress?.status === "done" ? index : index - 1;
  return (
    <div className={`run${mode === "brutal" ? " brutal" : ""}`}>
      <div className="run-title">
        <span>{progress ? progress.label : "Menyiapkan…"}</span>
        {progress && (
          <span className="muted">
            Langkah {progress.index} dari {total}
          </span>
        )}
      </div>
      <div className="steps" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.max(done, 0)}>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={i < done ? "done" : i === done ? "current" : ""} />
        ))}
      </div>
      {names.length === total && (
        <div className="step-names">
          {names.map((n, i) => (
            <span key={n} className={i + 1 === index ? "now" : i + 1 < index ? "past" : ""}>
              {n}
            </span>
          ))}
        </div>
      )}
      {progress?.detail && <p className="muted run-detail">{progress.detail}</p>}
    </div>
  );
}
