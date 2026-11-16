import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  api,
  errorMessage,
  isSpacer,
  isTauri,
  joinNames,
  newSpacer,
  on,
  renumber,
  sortedApps,
  summarySentence,
  type InstalledApp,
  type Preset,
  type PresetApp,
  type PresetMode,
  type Progress,
  type Status,
} from "../api";
import { AddAppPopover } from "../components/AddAppPopover";
import { Icon, type IconName } from "../components/Icon";
import { Menu } from "../components/Menu";
import { ModeSeg } from "../components/ModeSeg";
import { PresetTabs } from "../components/PresetTabs";
import { Shelf } from "../components/Shelf";
import { useInstalledApps, usePresets, useSettings, useUpdateStatus } from "../hooks";
import { popupMenu, type MenuEntry } from "../menu";
import "./panel.css";

/** Nama langkah di bawah bar progres. */
const STEP_NAMES: Record<PresetMode, string[]> = {
  clean: ["Potret", "Tutup app", "Tunggu", "Ganti dock", "Buka app"],
  brutal: ["Potret", "Tutup semua", "Tunggu", "Ganti dock", "Buka ulang"],
  dock_only: ["Potret", "Ganti dock"],
};

type View =
  | { kind: "dock" }
  | { kind: "running"; mode: PresetMode; progress: Progress | null }
  | { kind: "confirm-original" };

type HtmlMenu = { anchor: HTMLElement; entries: MenuEntry[] } | null;

/** Panel di tengah layar (Figma "Panel Docky · K1"). */
export function Panel() {
  const { presets, setPresets, warning, clearWarning, loaded } = usePresets();
  const { settings, save: saveSettings } = useSettings();
  const { apps: installed, byId, known, refresh: rescan } = useInstalledApps();
  const [view, setView] = useState<View>({ kind: "dock" });
  const update = useUpdateStatus();
  const [status, setStatus] = useState<Status | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [htmlMenu, setHtmlMenu] = useState<HtmlMenu>(null);
  const [adding, setAdding] = useState(false);
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);
  const [popHeight, setPopHeight] = useState(0);
  const [space, setSpace] = useState(0);
  /** Saat popover ditutup karena klik di luar, termasuk klik pada tombol + itu sendiri. */
  const pickerClosedAt = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);

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

  // Tinggi jendela mengikuti isi, lalu Rust meletakkannya di tengah layar.
  // Isi menempel ke bawah jendela, jadi saat popover menambah tinggi, panel tidak bergeser.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      api.resizePanel(Math.ceil(el.getBoundingClientRect().height)).catch(() => {});
    });
    // border-box: ruang popover dibuat dengan padding-top, yang tidak terhitung di content-box.
    ro.observe(el, { box: "border-box" });
    return () => ro.disconnect();
  }, []);

  // Di app, popover Tambah app adalah jendela sendiri (src/picker); panel hanya
  // mengikuti apakah popover terbuka, supaya tombol + tampak aktif.
  useEffect(() => {
    if (!isTauri) return;
    const offOpened = on("picker-opened", () => setAdding(true));
    const offClosed = on("picker-closed", () => {
      setAdding(false);
      pickerClosedAt.current = performance.now();
    });
    return () => {
      offOpened();
      offClosed();
    };
  }, []);

  // Pratinjau browser: popover di dalam halaman, dengan ruang di atas panel.
  useLayoutEffect(() => {
    if (isTauri) return;
    if (!adding) {
      const t = setTimeout(() => setSpace(0), 160);
      return () => clearTimeout(t);
    }
    if (!addAnchor || !panelRef.current || popHeight === 0) return;
    const tileTop = addAnchor.getBoundingClientRect().top - panelRef.current.getBoundingClientRect().top;
    setSpace(Math.max(0, Math.ceil(popHeight + 14 - tileTop)));
  }, [adding, addAnchor, popHeight]);

  useEffect(() => {
    if (warning) {
      report("File preset rusak", warning);
      clearWarning();
    }
  }, [warning, clearWarning, report]);

  const selected: Preset | undefined = presets.find((p) => p.id === settings?.selected_preset) ?? presets[0];
  const busy = view.kind === "running" || !!status?.busy;
  const showWelcome = settings !== null && !settings.welcome_seen && view.kind === "dock";
  const ordered = useMemo(() => (selected ? sortedApps(selected) : []), [selected]);

  const closeAdd = useCallback(() => {
    setAdding(false);
    if (isTauri) api.hidePicker().catch(() => {});
  }, []);

  const select = (p: Preset) => {
    if (busy || !settings) return;
    closeAdd();
    saveSettings({ ...settings, selected_preset: p.id });
    setView({ kind: "dock" });
  };

  /** Simpan perubahan preset; tampilan langsung berubah, lalu diganti hasil dari Rust. */
  const savePreset = async (next: Preset) => {
    setPresets((list) => list.map((p) => (p.id === next.id ? next : p)));
    try {
      setPresets(await api.savePreset(next));
    } catch (e) {
      report("Preset tidak tersimpan", errorMessage(e));
    }
  };

  const setMode = (mode: PresetMode) => {
    if (selected && selected.mode !== mode) savePreset({ ...selected, mode });
  };

  const addApp = (app: InstalledApp) => {
    if (!selected || selected.apps.some((a) => a.bundle_id === app.bundle_id)) return;
    savePreset({
      ...selected,
      apps: [...ordered, { bundle_id: app.bundle_id, name: app.name, order: ordered.length + 1, auto_open: true }],
    });
  };

  const addSpacer = () => {
    if (selected) savePreset({ ...selected, apps: [...ordered, newSpacer(ordered.length + 1)] });
  };

  const removeApp = (app: PresetApp) => {
    if (selected) savePreset({ ...selected, apps: renumber(ordered.filter((a) => a.bundle_id !== app.bundle_id)) });
  };

  const toggleAuto = (app: PresetApp) => {
    if (!selected) return;
    savePreset({
      ...selected,
      apps: selected.apps.map((a) => (a.bundle_id === app.bundle_id ? { ...a, auto_open: !a.auto_open } : a)),
    });
  };

  const run = async () => {
    if (!selected || busy) return;
    closeAdd();
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

  const uniqueName = (base: string) => {
    let name = base;
    for (let i = 2; presets.some((p) => p.name === name); i++) name = `${base} ${i}`;
    return name;
  };

  const createPreset = async (fromCurrent: boolean) => {
    if (busy) return;
    const name = uniqueName("Preset baru");
    try {
      const draft: Preset = fromCurrent
        ? await api.presetFromCurrent(name)
        : { id: "", name, mode: "clean", apps: [] };
      const saved = await api.savePreset(draft);
      setPresets(saved);
      const created = saved.find((p) => p.name === name) ?? saved[saved.length - 1];
      if (settings) await saveSettings({ ...settings, selected_preset: created.id, welcome_seen: true });
      setView({ kind: "dock" });
      setCollapsed(false);
      if (fromCurrent) {
        report(`${name} dibuat`, `${created.apps.length} app dari kondisi sekarang. Ganti namanya di Pengaturan.`);
      } else {
        // Preset kosong: langsung buka Tambah app.
        setTimeout(() => {
          if (addBtnRef.current) openAdd(addBtnRef.current, created.id);
        }, 60);
      }
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
    setAdding(false);
    setView({ kind: "confirm-original" });
  };

  /** Menu native di app; menu HTML saat dibuka di browser (pratinjau). */
  const showMenu = (anchor: HTMLElement, entries: MenuEntry[]) => {
    if (isTauri) popupMenu(anchor, entries);
    else setHtmlMenu((m) => (m?.anchor === anchor ? null : { anchor, entries }));
  };

  const openMoreMenu = (anchor: HTMLElement) =>
    showMenu(anchor, [
      { text: "Pengaturan…", action: () => api.openSettings() },
      { text: "Kembalikan preset terakhir", enabled: !busy && !!status?.can_undo, action: undo },
      { text: "Dock asli…", enabled: !busy && !!status?.has_backup, action: confirmOriginal },
      "separator",
      { text: collapsed ? "Bentangkan panel" : "Ciutkan panel", action: () => setCollapsed((c) => !c) },
      { text: "Kembalikan panel ke tengah", action: () => api.resetPanelPosition() },
      "separator",
      update.state === "ready"
        ? { text: `Restart untuk update ke ${update.version}`, enabled: !busy, action: installUpdate }
        : { text: "Periksa update", action: checkUpdate },
      "separator",
      { text: "Keluar Docky", action: () => api.quit() },
    ]);

  const openNewMenu = (anchor: HTMLElement) =>
    showMenu(anchor, [
      { text: "Preset kosong", icon: "plus", hint: "Mulai dari dock kosong.", action: () => createPreset(false) },
      {
        text: "Dari kondisi sekarang",
        icon: "layers",
        hint: "App yang terbuka ditandai buka otomatis.",
        action: () => createPreset(true),
      },
    ]);

  const openItemMenu = (app: PresetApp, anchor: HTMLElement) => {
    if (busy) return;
    if (isSpacer(app.bundle_id)) return showMenu(anchor, [{ text: "Hapus pemisah", action: () => removeApp(app) }]);
    showMenu(anchor, [
      { text: "Buka otomatis", checked: app.auto_open, action: () => toggleAuto(app) },
      "separator",
      { text: `Hapus ${app.name} dari preset`, action: () => removeApp(app) },
    ]);
  };

  const openAdd = (anchor: HTMLElement, presetId: string) => {
    setAddAnchor(anchor);
    setAdding(true);
    if (isTauri) {
      const r = anchor.getBoundingClientRect();
      api.openPicker(presetId, r.left, r.top, r.width).catch(() => setAdding(false));
    }
  };

  const toggleAdd = (anchor: HTMLElement) => {
    if (busy || !selected) return;
    if (adding) return closeAdd();
    // Klik pada + saat popover terbuka: popover sudah tertutup karena kehilangan fokus.
    if (isTauri && performance.now() - pickerClosedAt.current < 300) return;
    openAdd(anchor, selected.id);
  };
  const closeHtmlMenu = useCallback(() => setHtmlMenu(null), []);

  const finishWelcome = async (createFromCurrent: boolean) => {
    if (!settings) return;
    await saveSettings({ ...settings, welcome_seen: true });
    if (createFromCurrent) await createPreset(true);
  };

  const onStripMouseDown = (e: React.MouseEvent) => {
    // Seret dari bagian kosong strip; tombol tetap bisa diklik.
    if (e.button === 0 && e.detail === 1 && !(e.target as HTMLElement).closest("button")) {
      api.startPanelDrag().catch(() => {});
    }
  };

  return (
    <div
      className="panel-root"
      ref={(el) => {
        rootRef.current = el;
        setRoot(el);
      }}
      style={{ paddingTop: space }}
    >
      <div className={`panel${collapsed ? " collapsed" : ""}`} ref={panelRef}>
        <header
          className="strip"
          title="Seret untuk memindahkan panel. Klik dua kali untuk kembali ke tengah."
          onMouseDown={onStripMouseDown}
          onDoubleClick={(e) => {
            if (!(e.target as HTMLElement).closest("button")) api.resetPanelPosition().catch(() => {});
          }}
        >
          <div className="lights">
            <button className="light red" onClick={() => api.hidePanel()} aria-label="Tutup panel" title="Tutup">
              <Glyph d="M2.5 2.5l5 5M7.5 2.5l-5 5" />
            </button>
            <button
              className="light yellow"
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapsed ? "Bentangkan" : "Ciutkan"}
              aria-expanded={!collapsed}
              title={collapsed ? "Bentangkan" : "Ciutkan"}
            >
              <Glyph d="M2 5h6" />
            </button>
            <button
              className="light green"
              onClick={() => api.resetPanelPosition()}
              aria-label="Kembalikan panel ke tengah"
              title="Kembalikan ke tengah"
            >
              <Glyph d="M5 2v6M2 5h6" />
            </button>
          </div>
          <PresetTabs
            presets={presets}
            activeId={selected?.id}
            onSelect={select}
            onNew={openNewMenu}
            disabled={busy}
            newOpen={!!htmlMenu}
          />
          <span className="spacer" />
          {update.state === "ready" && (
            <button className="capsule primary small update" onClick={installUpdate} disabled={busy} title={`Pasang Docky ${update.version} lalu buka ulang`}>
              Restart untuk update
            </button>
          )}
          <button className="ghost more" onClick={(e) => openMoreMenu(e.currentTarget)} aria-label="Menu" aria-haspopup="menu">
            <Icon name="ellipsis" />
            {update.state === "ready" && <span className="badge-dot" aria-hidden />}
          </button>
        </header>

        {!collapsed && (
          <div className="body">
            <div className="stage-slot" aria-live="polite">
              {showWelcome ? (
                <Message
                  icon="dock"
                  title="Selamat datang di Docky"
                  text="Simpan susunan app sebagai preset, lalu rapikan Mac dengan satu klik. Dock aslimu sudah dicadangkan; pilih Dock asli di menu ⋯ kapan saja untuk kembali."
                >
                  <button className="capsule primary" onClick={() => finishWelcome(true)}>
                    <Icon name="plus" size={13} />
                    Buat preset dari kondisi sekarang
                  </button>
                  <button className="capsule" onClick={() => finishWelcome(false)}>
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
                  <button className="capsule primary" onClick={restoreOriginal}>
                    <Icon name="undo" size={13} />
                    Pulihkan
                  </button>
                  <button className="capsule" onClick={() => setView({ kind: "dock" })}>
                    Batal
                  </button>
                </Message>
              ) : !selected ? (
                loaded ? (
                  <Message
                    icon="layers"
                    tone="muted"
                    title="Belum ada preset"
                    text="Simpan susunan app yang sedang terbuka sebagai preset pertama, atau mulai dari preset kosong."
                  >
                    <button className="capsule primary" onClick={() => createPreset(true)} disabled={busy}>
                      <Icon name="layers" size={13} />
                      Dari kondisi sekarang
                    </button>
                    <button className="capsule" onClick={() => createPreset(false)} disabled={busy}>
                      <Icon name="plus" size={13} />
                      Preset kosong
                    </button>
                  </Message>
                ) : (
                  <div className="stage" />
                )
              ) : (
                <Shelf
                  key={selected.id}
                  apps={ordered}
                  byId={byId}
                  known={known}
                  onAdd={busy ? undefined : toggleAdd}
                  addOpen={adding}
                  addRef={addBtnRef}
                  onItem={openItemMenu}
                />
              )}
            </div>
            <div className="actions">
              <ModeSeg mode={selected?.mode ?? null} onChange={setMode} disabled={busy || !selected} />
              <span className="spacer" />
              <button
                className="capsule primary run-btn"
                onClick={run}
                disabled={busy || !selected}
                title={selected ? `Jalankan ${selected.name}` : "Jalankan"}
              >
                {busy ? <span className="spinner" aria-hidden /> : <Icon name="play" size={13} />}
                {busy ? "Berjalan…" : "Jalankan"}
              </button>
            </div>
          </div>
        )}
      </div>

      <AddAppPopover
        open={!isTauri && adding && !!selected}
        anchor={addAnchor}
        container={root}
        placement="up"
        layoutKey={space}
        title={selected ? `Tambah app ke “${selected.name}”` : "Tambah app"}
        apps={installed}
        exclude={new Set(selected?.apps.map((a) => a.bundle_id) ?? [])}
        onPick={addApp}
        onSpacer={addSpacer}
        onClose={closeAdd}
        onHeight={setPopHeight}
        onError={(m) => report("App tidak bisa ditambahkan", m)}
      />
      <Menu open={!!htmlMenu} anchor={htmlMenu?.anchor ?? null} container={root} entries={htmlMenu?.entries ?? []} onClose={closeHtmlMenu} />
    </div>
  );
}

/** Simbol kecil di lampu jendela, muncul saat kursor di atasnya. */
function Glyph({ d }: { d: string }) {
  return (
    <svg className="glyph" viewBox="0 0 10 10" aria-hidden>
      <path d={d} stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none" />
    </svg>
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
    <div className="stage message">
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
    <div className={`stage run${mode === "brutal" ? " brutal" : ""}`}>
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
          <span key={i} className={i < done ? "done" : i === done ? "current" : ""}>
            <i />
          </span>
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
