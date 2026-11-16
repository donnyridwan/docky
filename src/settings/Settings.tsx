import { useCallback, useEffect, useState } from "react";
import { api, errorMessage, type InstalledApp, type Preset, type Settings, type Status, type UpdateStatus } from "../api";
import { AddAppPopover } from "../components/AddAppPopover";
import { AppTile } from "../components/AppTile";
import { Icon, type IconName } from "../components/Icon";
import { Menu } from "../components/Menu";
import { PresetTabs } from "../components/PresetTabs";
import { useInstalledApps, usePresets, useSettings, useUpdateStatus } from "../hooks";
import appIcon from "../assets/app-icon.png";
import { PresetEditor } from "./PresetEditor";
import "./settings.css";

type Tab = "presets" | "exclusions" | "general";

type Installed = ReturnType<typeof useInstalledApps>;

/** Jendela Pengaturan (Figma "Redesign Pengaturan · macOS 26", S1–S5). */
export function SettingsWindow() {
  const [tab, setTab] = useState<Tab>("presets");
  const [status, setStatus] = useState<Status | null>(null);
  const installed = useInstalledApps();
  const presets = usePresets();
  const settings = useSettings();
  const update = useUpdateStatus();
  const [content, setContent] = useState<HTMLElement | null>(null);

  useEffect(() => {
    api.status().then(setStatus).catch(() => {});
  }, []);

  const nav: [Tab, string, IconName, number | null][] = [
    ["presets", "Preset", "layers", presets.presets.length],
    ["exclusions", "Pengecualian", "error", settings.settings?.exclusions.length ?? null],
    ["general", "Umum", "gear", null],
  ];

  return (
    <div className="settings">
      <nav className="sidebar" aria-label="Bagian pengaturan">
        <div className="sidebar-top" data-tauri-drag-region />
        <div className="brand" data-tauri-drag-region>
          <img src={appIcon} width={26} height={26} alt="" />
          <span>Docky</span>
        </div>
        {nav.map(([id, label, icon, count]) => (
          <button key={id} className={`nav-item${tab === id ? " active" : ""}`} aria-current={tab === id} onClick={() => setTab(id)}>
            <Icon name={icon} />
            <span>{label}</span>
            {count !== null && <span className="nav-count">{count}</span>}
          </button>
        ))}
        <span className="grow" data-tauri-drag-region />
        <div className="sidebar-foot">
          <span>Docky {status?.version ?? ""}</span>
          <span className="subtle">{shortUpdate(update)}</span>
        </div>
      </nav>
      <main className="content" ref={setContent}>
        {tab === "presets" && <PresetsPane installed={installed} {...presets} settingsHook={settings} container={content} />}
        {tab === "exclusions" && <ExclusionsPane installed={installed} settingsHook={settings} container={content} />}
        {tab === "general" && <GeneralPane status={status} presetCount={presets.presets.length} settingsHook={settings} />}
      </main>
    </div>
  );
}

function shortUpdate(u: UpdateStatus): string {
  if (u.state === "ready") return `Update ${u.version} siap`;
  if (u.state === "downloading") return "Mengunduh update…";
  if (u.state === "up_to_date") return "Versi terbaru";
  return "";
}

// ---- Preset ------------------------------------------------------------

function PresetsPane({
  installed,
  presets,
  setPresets,
  loaded,
  settingsHook,
  container,
}: {
  installed: Installed;
  settingsHook: ReturnType<typeof useSettings>;
  container: HTMLElement | null;
} & ReturnType<typeof usePresets>) {
  const { settings, save } = settingsHook;
  const [selectedId, setSelectedId] = useState<string | null>(settings?.selected_preset ?? null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loaded && !presets.some((p) => p.id === selectedId)) setSelectedId(settings?.selected_preset ?? presets[0]?.id ?? null);
  }, [presets, selectedId, loaded, settings?.selected_preset]);

  const current = presets.find((p) => p.id === selectedId) ?? null;

  const create = async (fromCurrent: boolean) => {
    setError(null);
    const base = "Preset baru";
    let name = base;
    for (let i = 2; presets.some((p) => p.name === name); i++) name = `${base} ${i}`;
    try {
      const draft: Preset = fromCurrent ? await api.presetFromCurrent(name) : { id: "", name, mode: "clean", apps: [] };
      const list = await api.savePreset(draft);
      setPresets(list);
      const created = list.find((p) => p.name === name) ?? list[list.length - 1];
      setSelectedId(created.id);
      if (settings) save({ ...settings, selected_preset: created.id });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const closeMenu = useCallback(() => setMenuAnchor(null), []);

  return (
    <>
      <div className="content-bar" data-tauri-drag-region>
        <PresetTabs
          presets={presets}
          activeId={current?.id}
          onSelect={(p) => setSelectedId(p.id)}
          onNew={(a) => setMenuAnchor((m) => (m ? null : a))}
          newOpen={!!menuAnchor}
        />
      </div>
      <div className="content-body" key="presets">
        {current ? (
          <PresetEditor
            key={current.id}
            preset={current}
            installed={installed}
            container={container}
            onSaved={setPresets}
            onDeleted={(list) => {
              setPresets(list);
              setSelectedId(list[0]?.id ?? null);
            }}
          />
        ) : loaded ? (
          <div className="empty-state">
            <Icon name="layers" size={28} className="subtle" />
            <div className="empty-title">Belum ada preset</div>
            <p className="muted">Ambil app yang sedang terbuka dan isi dock sekarang, atau mulai dari preset kosong.</p>
            {error && <p className="error">{error}</p>}
            <div className="empty-actions">
              <button className="capsule primary" onClick={() => create(true)}>
                <Icon name="layers" size={13} />
                Dari kondisi sekarang
              </button>
              <button className="capsule" onClick={() => create(false)}>
                <Icon name="plus" size={13} />
                Preset kosong
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <Menu
        open={!!menuAnchor}
        anchor={menuAnchor}
        container={container}
        onClose={closeMenu}
        entries={[
          { text: "Preset kosong", icon: "plus", hint: "Mulai dari dock kosong.", action: () => create(false) },
          { text: "Dari kondisi sekarang", icon: "layers", hint: "App yang terbuka ditandai buka otomatis.", action: () => create(true) },
        ]}
      />
    </>
  );
}

// ---- Pengecualian ------------------------------------------------------

function ExclusionsPane({
  installed: { apps, byId, known },
  settingsHook: { settings, save },
  container,
}: {
  installed: Installed;
  settingsHook: ReturnType<typeof useSettings>;
  container: HTMLElement | null;
}) {
  const [adding, setAdding] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = useCallback(() => setAdding(false), []);
  if (!settings) return null;

  const set = (exclusions: string[]) => save({ ...settings, exclusions });

  return (
    <>
      <div className="content-bar" data-tauri-drag-region>
        <h1 className="bar-title">Pengecualian</h1>
      </div>
      <div className="content-body" key="exclusions">
        <p className="lead">App di daftar ini tidak pernah ditutup saat preset dijalankan, walaupun tidak ada di preset.</p>

        <section className="section">
          <div className="section-head">Selalu dibiarkan</div>
          <ul className="group">
            <li className="row" style={{ "--inset": "52px" } as React.CSSProperties}>
              <AppTile name="Finder" installed={byId.get("com.apple.finder")} known={false} size={28} />
              <span className="grow name">Finder</span>
              <span className="muted small-text">Bawaan macOS</span>
            </li>
            <li className="row" style={{ "--inset": "52px" } as React.CSSProperties}>
              <img src={appIcon} width={28} height={28} alt="" />
              <span className="grow name">Docky</span>
              <span className="muted small-text">Docky sendiri, juga app di menu bar</span>
            </li>
          </ul>
        </section>

        <section className="section">
          <div className="section-head">
            Pengecualian kamu · {settings.exclusions.length}
            <span className="muted">Berlaku di semua preset</span>
          </div>
          <ul className="group">
            {settings.exclusions.map((id) => {
              const app = byId.get(id);
              return (
                <li key={id} className="row app-row" style={{ "--inset": "52px" } as React.CSSProperties}>
                  <AppTile name={app?.name ?? id} installed={app} known={known} size={28} />
                  <span className="grow app-name">
                    <span className="name">{app?.name ?? id}</span>
                    <span className="bundle">{id}</span>
                  </span>
                  <button
                    className="remove"
                    aria-label={`Hapus ${app?.name ?? id} dari pengecualian`}
                    title="Hapus dari pengecualian"
                    onClick={() => set(settings.exclusions.filter((x) => x !== id))}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </li>
              );
            })}
            {settings.exclusions.length === 0 && (
              <li className="row empty-row muted">Belum ada. Tambahkan app yang harus tetap terbuka, misalnya pengelola kata sandi atau musik.</li>
            )}
          </ul>
        </section>

        <div>
          <button
            className={`capsule${adding ? " active-tint" : ""}`}
            onClick={(e) => {
              setAnchor(e.currentTarget);
              setAdding((a) => !a);
            }}
          >
            <Icon name="plus" size={13} />
            Tambah app
          </button>
        </div>
      </div>
      <AddAppPopover
        open={adding}
        anchor={anchor}
        container={container}
        title="Jangan pernah tutup"
        apps={apps}
        exclude={new Set(settings.exclusions)}
        onPick={(app: InstalledApp) => set([...settings.exclusions, app.bundle_id])}
        onClose={close}
      />
    </>
  );
}

// ---- Umum --------------------------------------------------------------

function GeneralPane({
  status,
  presetCount,
  settingsHook: { settings, save },
}: {
  status: Status | null;
  presetCount: number;
  settingsHook: ReturnType<typeof useSettings>;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  if (!settings) return null;
  const seconds = Math.round(settings.quit_timeout_ms / 1000);

  const restore = async () => {
    setConfirm(false);
    setMessage(null);
    try {
      await api.restoreOriginalDock();
      setMessage("Dock asli sudah dipulihkan.");
    } catch (e) {
      setMessage(errorMessage(e));
    }
  };

  return (
    <>
      <div className="content-bar" data-tauri-drag-region>
        <h1 className="bar-title">Umum</h1>
      </div>
      <div className="content-body" key="general">
        <p className="lead">Update, batas waktu tunggu, dan pemulihan dock.</p>

        <section className="section">
          <div className="section-head">Update</div>
          <div className="group">
            <UpdateRow version={status?.version} />
          </div>
        </section>

        <section className="section">
          <div className="section-head">Saat menjalankan preset</div>
          <div className="group">
            <div className="row tall">
              <div className="row-text">
                <span className="row-title">Batas waktu tunggu</span>
                <span className="row-desc">
                  Lama Docky menunggu app menutup diri. App dengan pekerjaan belum disimpan tidak pernah dipaksa tutup.
                </span>
              </div>
              <label className="range">
                <input
                  type="range"
                  min={2}
                  max={15}
                  value={seconds}
                  aria-label="Batas waktu tunggu dalam detik"
                  style={{ "--p": `${((seconds - 2) / 13) * 100}%` } as React.CSSProperties}
                  onChange={(e) => save({ ...settings, quit_timeout_ms: Number(e.target.value) * 1000 })}
                />
                <span className="range-value">{seconds} detik</span>
              </label>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="section-head">Dock</div>
          <div className="group">
            <div className={`row tall${confirm ? " confirm" : ""}`}>
              <div className="row-text">
                <span className="row-title">{confirm ? "Pulihkan dock asli?" : "Dock asli"}</span>
                <span className="row-desc">
                  {confirm
                    ? "Isi dock kembali seperti sebelum Docky pertama dipakai. App yang terbuka tidak ditutup."
                    : "Memulihkan isi dock seperti sebelum Docky pertama dipakai. Berbeda dengan Kembalikan, yang hanya membatalkan preset terakhir."}
                </span>
                {message && <span className="row-desc good">{message}</span>}
              </div>
              {confirm ? (
                <div className="inline-actions">
                  <button className="capsule" onClick={() => setConfirm(false)}>
                    Batal
                  </button>
                  <button className="capsule primary" onClick={restore}>
                    <Icon name="undo" size={13} />
                    Pulihkan
                  </button>
                </div>
              ) : (
                <button className="capsule" disabled={!status?.has_backup} onClick={() => setConfirm(true)}>
                  <Icon name="undo" size={13} />
                  Pulihkan dock asli…
                </button>
              )}
            </div>
          </div>
        </section>

        <section className="section">
          <div className="section-head">Panel</div>
          <div className="group">
            <div className="row tall">
              <div className="row-text">
                <span className="row-title">Layar pengenalan</span>
                <span className="row-desc">Tampilkan lagi penjelasan singkat di panel.</span>
              </div>
              <button className="capsule" disabled={!settings.welcome_seen} onClick={() => save({ ...settings, welcome_seen: false } as Settings)}>
                Tampilkan lagi
              </button>
            </div>
          </div>
        </section>

        <span className="grow" />
        <p className="about">
          {presetCount} preset · Data tersimpan di {status?.data_dir ?? "~/Library/Application Support/Docky"}. Docky hanya
          terhubung ke internet untuk mengecek update. Open source, lisensi MIT.
        </p>
      </div>
    </>
  );
}

function updateText(u: UpdateStatus): string {
  switch (u.state) {
    case "checking":
      return "Mengecek update…";
    case "up_to_date":
      return "Docky sudah versi terbaru. Dicek otomatis saat dibuka dan setiap 6 jam.";
    case "downloading":
      return `Mengunduh Docky ${u.version}${u.percent != null ? ` · ${u.percent}%` : "…"}`;
    case "ready":
      return `Docky ${u.version} sudah diunduh dan siap dipasang.`;
    case "error":
      return `Update belum bisa dicek: ${u.message}`;
    default:
      return "Docky mengecek update otomatis saat dibuka dan setiap 6 jam.";
  }
}

function UpdateRow({ version }: { version?: string }) {
  const update = useUpdateStatus();
  const [error, setError] = useState<string | null>(null);
  const working = update.state === "checking" || update.state === "downloading";
  const tone = error || update.state === "error" ? "bad" : update.state === "up_to_date" ? "good" : "";

  const install = async () => {
    setError(null);
    try {
      await api.installUpdate();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="row tall">
      <div className="row-text">
        <span className="row-title">Docky {version ?? ""}</span>
        <span className={`row-desc ${tone}`}>{error ?? updateText(update)}</span>
        {update.state === "downloading" && (
          <span className="download-bar">
            <i style={{ transform: `scaleX(${(update.percent ?? 10) / 100})` }} />
          </span>
        )}
      </div>
      {update.state === "ready" ? (
        <button className="capsule primary" onClick={install}>
          <Icon name="arrow" size={13} />
          Restart untuk update
        </button>
      ) : (
        <button className="capsule" disabled={working} onClick={() => api.checkUpdate()}>
          <Icon name="refresh" size={13} className={working ? "spin" : undefined} />
          {update.state === "error" ? "Coba lagi" : "Periksa update"}
        </button>
      )}
    </div>
  );
}
