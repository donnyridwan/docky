import { useEffect, useState } from "react";
import { api, errorMessage, type Preset, type PresetMode, type Status, type UpdateStatus } from "../api";
import { AppTile } from "../components/AppTile";
import { Icon, type IconName } from "../components/Icon";
import { useInstalledApps, usePresets, useSettings, useUpdateStatus } from "../hooks";
import appIcon from "../assets/app-icon.png";
import { AppPicker } from "./AppPicker";
import { PresetEditor } from "./PresetEditor";
import "./settings.css";

type Tab = "presets" | "exclusions" | "general";

const TABS: [Tab, string, IconName][] = [
  ["presets", "Preset", "layers"],
  ["exclusions", "Pengecualian", "error"],
  ["general", "Umum", "gear"],
];

export function SettingsWindow() {
  const [tab, setTab] = useState<Tab>("presets");
  const [status, setStatus] = useState<Status | null>(null);
  const installed = useInstalledApps();

  useEffect(() => {
    api.status().then(setStatus).catch(() => {});
  }, []);

  return (
    <div className="settings">
      <nav className="sidebar" aria-label="Bagian pengaturan">
        <div className="brand">
          <img src={appIcon} width={22} height={22} alt="" />
          <span>Docky</span>
        </div>
        {TABS.map(([id, label, icon]) => (
          <button key={id} className={`nav-item${tab === id ? " active" : ""}`} aria-current={tab === id} onClick={() => setTab(id)}>
            <Icon name={icon} />
            {label}
          </button>
        ))}
        <span className="grow" />
        <span className="version">Docky {status?.version ?? ""}</span>
      </nav>
      <main className="content">
        {tab === "presets" && <PresetsTab {...installed} />}
        {tab === "exclusions" && <ExclusionsTab {...installed} />}
        {tab === "general" && <GeneralTab status={status} />}
      </main>
    </div>
  );
}

type Installed = ReturnType<typeof useInstalledApps>;

const MODE_DOT: Record<PresetMode, string> = { clean: "var(--blue)", brutal: "var(--brutal)", dock_only: "var(--text-muted)" };

function PresetsTab({ apps, byId, known }: Installed) {
  const { presets, setPresets, loaded } = usePresets();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftNew, setDraftNew] = useState<Preset | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!draftNew && loaded && !presets.some((p) => p.id === selectedId)) setSelectedId(presets[0]?.id ?? null);
  }, [presets, selectedId, draftNew, loaded]);

  const current = draftNew ?? presets.find((p) => p.id === selectedId) ?? null;

  const startEmpty = () => setDraftNew({ id: "", name: "", mode: "clean", apps: [] });
  const startFromCurrent = async () => {
    setError(null);
    try {
      setDraftNew({ ...(await api.presetFromCurrent("")), id: "" });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="presets-tab">
      <aside className="preset-list">
        <div className="list-head">Preset</div>
        <ul>
          {presets.map((p) => (
            <li key={p.id}>
              <button
                className={!draftNew && p.id === selectedId ? "active" : ""}
                onClick={() => {
                  setDraftNew(null);
                  setSelectedId(p.id);
                }}
              >
                <span className="mode-dot" style={{ background: MODE_DOT[p.mode] }} />
                <span className="grow name">{p.name}</span>
                <span className="small muted">{p.apps.length} app</span>
              </button>
            </li>
          ))}
          {draftNew && (
            <li>
              <button className="active">
                <span className="mode-dot" style={{ background: MODE_DOT[draftNew.mode] }} />
                <span className="grow name">{draftNew.name || "Preset baru"}</span>
                <span className="small muted">{draftNew.apps.length} app</span>
              </button>
            </li>
          )}
        </ul>
        <div className="list-actions">
          {error && <span className="error small">{error}</span>}
          <button className="pill full" onClick={startEmpty}>
            <Icon name="plus" />
            Preset kosong
          </button>
          <button className="pill full" onClick={startFromCurrent} title="App yang terbuka ditandai buka otomatis, app yang hanya ada di dock ditandai tidak">
            <Icon name="layers" />
            Dari kondisi sekarang
          </button>
        </div>
      </aside>
      <section className="preset-detail">
        {current ? (
          <PresetEditor
            key={draftNew ? "new" : current.id}
            preset={current}
            isNew={!!draftNew}
            byId={byId}
            apps={apps}
            known={known}
            onSaved={(list, id) => {
              setPresets(list);
              setDraftNew(null);
              setSelectedId(id);
            }}
            onDeleted={(list) => {
              setPresets(list);
              setSelectedId(list[0]?.id ?? null);
            }}
            onCancelNew={() => setDraftNew(null)}
          />
        ) : (
          <div className="empty-state">
            <Icon name="layers" size={28} dim />
            <div className="empty-title">Belum ada preset</div>
            <p className="muted">Buat preset kosong, atau ambil app yang sedang terbuka dan isi dock sekarang.</p>
            <div className="empty-actions">
              <button className="pill primary" onClick={startFromCurrent}>
                <Icon name="layers" />
                Dari kondisi sekarang
              </button>
              <button className="pill" onClick={startEmpty}>
                <Icon name="plus" />
                Preset kosong
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function AlwaysKept() {
  return (
    <div className="note">
      <Icon name="info" />
      <span>Docky, Finder, dan app di menu bar selalu dibiarkan, juga di mode Bersih brutal.</span>
    </div>
  );
}

function ExclusionsTab({ apps, byId, known }: Installed) {
  const { settings, save } = useSettings();
  const [picking, setPicking] = useState(false);
  if (!settings) return null;

  const set = (exclusions: string[]) => save({ ...settings, exclusions });

  return (
    <div className="pane">
      <h1>Pengecualian</h1>
      <p className="lead">App di daftar ini tidak pernah ditutup saat preset dijalankan, walaupun tidak ada di preset.</p>
      <AlwaysKept />
      {settings.exclusions.length === 0 ? (
        <div className="empty-box">
          <Icon name="error" size={24} dim />
          <div className="empty-title small-title">Belum ada pengecualian</div>
          <p className="muted">Tambahkan app yang harus tetap terbuka, misalnya pengelola kata sandi atau musik.</p>
        </div>
      ) : (
        <ul className="app-list">
          {settings.exclusions.map((id) => {
            const app = byId.get(id);
            return (
              <li key={id} className="app-row">
                <AppTile name={app?.name ?? id} installed={app} known={known} size={28} />
                <span className="grow app-name">
                  <span className="name">{app?.name ?? id}</span>
                  <span className="bundle">{id}</span>
                </span>
                <button
                  className="remove"
                  aria-label={`Hapus ${app?.name ?? id} dari pengecualian`}
                  onClick={() => set(settings.exclusions.filter((x) => x !== id))}
                >
                  <Icon name="close" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button className="pill add-app" onClick={() => setPicking(true)}>
        <Icon name="plus" />
        Tambah app
      </button>
      {picking && (
        <AppPicker
          title="Jangan pernah tutup"
          apps={apps}
          exclude={new Set(settings.exclusions)}
          onClose={() => setPicking(false)}
          onPick={(app) => set([...settings.exclusions, app.bundle_id])}
        />
      )}
    </div>
  );
}

function GeneralTab({ status }: { status: Status | null }) {
  const { settings, save } = useSettings();
  const { presets } = usePresets();
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
    <div className="pane">
      <h1>Umum</h1>
      <p className="lead">Update, batas waktu tunggu, dan pemulihan dock.</p>

      <UpdateSetting version={status?.version} />

      <div className="setting">
        <div className="setting-text">
          <div className="setting-title">Batas waktu tunggu</div>
          <p>Lama Docky menunggu app menutup diri. App dengan pekerjaan belum disimpan tidak pernah dipaksa tutup.</p>
        </div>
        <div className="range">
          <input
            type="range"
            min={2}
            max={15}
            value={seconds}
            aria-label="Batas waktu tunggu dalam detik"
            onChange={(e) => save({ ...settings, quit_timeout_ms: Number(e.target.value) * 1000 })}
          />
          <span>{seconds} detik</span>
        </div>
      </div>

      {confirm ? (
        <div className="setting confirm">
          <div className="setting-text">
            <div className="setting-title">Pulihkan dock asli?</div>
            <p>Isi dock kembali seperti sebelum Docky pertama dipakai. App yang terbuka tidak ditutup.</p>
          </div>
          <div className="inline-actions">
            <button className="pill no-icon" onClick={() => setConfirm(false)}>
              Batal
            </button>
            <button className="pill primary" onClick={restore}>
              <Icon name="undo" />
              Pulihkan
            </button>
          </div>
        </div>
      ) : (
        <div className="setting">
          <div className="setting-text">
            <div className="setting-title">Dock asli</div>
            <p>Memulihkan isi dock seperti sebelum Docky pertama dipakai. Berbeda dengan Kembalikan, yang hanya membatalkan preset terakhir.</p>
          </div>
          <button className="pill" disabled={!status?.has_backup} onClick={() => setConfirm(true)}>
            <Icon name="undo" />
            Pulihkan dock asli…
          </button>
        </div>
      )}
      {message && <p className="notice">{message}</p>}

      <div className="setting">
        <div className="setting-text">
          <div className="setting-title">Layar pengenalan</div>
          <p>Tampilkan lagi penjelasan singkat di panel.</p>
        </div>
        <button className="pill no-icon" disabled={!settings.welcome_seen} onClick={() => save({ ...settings, welcome_seen: false })}>
          Tampilkan lagi
        </button>
      </div>

      <p className="about">
        {presets.length} preset · Data tersimpan di {status?.data_dir ?? "~/Library/Application Support/Docky"}. Docky hanya
        terhubung ke internet untuk mengecek update. Open source, lisensi MIT.
      </p>
    </div>
  );
}

function updateText(u: UpdateStatus): string {
  switch (u.state) {
    case "checking":
      return "Mengecek update…";
    case "up_to_date":
      return "Docky sudah versi terbaru.";
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

function UpdateSetting({ version }: { version?: string }) {
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
    <div className="setting">
      <div className="setting-text">
        <div className="setting-title">Update{version ? ` · versi ${version}` : ""}</div>
        <p className={tone}>{error ?? updateText(update)}</p>
        {update.state === "downloading" && (
          <div className="download-bar">
            <span style={{ width: `${update.percent ?? 10}%` }} />
          </div>
        )}
      </div>
      {update.state === "ready" ? (
        <button className="pill primary" onClick={install}>
          <Icon name="arrow" />
          Restart untuk update
        </button>
      ) : (
        <button className="pill" disabled={working} onClick={() => api.checkUpdate()}>
          <Icon name="refresh" />
          {update.state === "error" ? "Coba lagi" : "Periksa update"}
        </button>
      )}
    </div>
  );
}
