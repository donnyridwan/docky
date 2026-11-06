import { useEffect, useState } from "react";
import { api, errorMessage, MODE_LABEL, type Preset, type Status, type UpdateStatus } from "../api";
import { AppTile } from "../components/AppTile";
import { useInstalledApps, usePresets, useSettings, useUpdateStatus } from "../hooks";
import appIcon from "../assets/app-icon.png";
import { AppPicker } from "./AppPicker";
import { PresetEditor } from "./PresetEditor";
import "./settings.css";

type Tab = "presets" | "exclusions" | "general";

const TABS: [Tab, string][] = [
  ["presets", "Preset"],
  ["exclusions", "Pengecualian"],
  ["general", "Umum"],
];

export function SettingsWindow() {
  const [tab, setTab] = useState<Tab>("presets");
  const installed = useInstalledApps();

  return (
    <div className="settings">
      <nav className="sidebar" aria-label="Bagian pengaturan">
        <div className="brand">
          <img src={appIcon} width={20} height={20} alt="" />
          <span>Docky</span>
        </div>
        {TABS.map(([id, label]) => (
          <button key={id} className={tab === id ? "active" : ""} aria-current={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>
      <main className="content">
        {tab === "presets" && <PresetsTab {...installed} />}
        {tab === "exclusions" && <ExclusionsTab {...installed} />}
        {tab === "general" && <GeneralTab />}
      </main>
    </div>
  );
}

type Installed = ReturnType<typeof useInstalledApps>;

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
      setDraftNew({ ...(await api.presetFromCurrent("Preset baru")), id: "" });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="presets-tab">
      <aside className="preset-list">
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
                <span className="grow">{p.name}</span>
                <span className="small muted">{p.apps.length} app</span>
              </button>
            </li>
          ))}
          {draftNew && (
            <li>
              <button className="active">
                <span className="grow">{draftNew.name || "Preset baru"}</span>
              </button>
            </li>
          )}
        </ul>
        <div className="list-actions">
          <button className="pill" onClick={startEmpty}>
            + Preset kosong
          </button>
          <button className="pill" onClick={startFromCurrent} title="App yang terbuka ditandai buka otomatis, app yang hanya ada di dock ditandai tidak">
            + Dari kondisi sekarang
          </button>
          {error && <span className="error small">{error}</span>}
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
            <p>Belum ada preset.</p>
            <p className="muted small">Buat preset kosong, atau ambil dari app yang sedang terbuka dan isi dock sekarang.</p>
          </div>
        )}
      </section>
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
      <p className="muted">
        App di daftar ini tidak pernah ditutup saat preset dijalankan, walaupun tidak ada di preset. Finder, Docky, dan app
        menu bar selalu dibiarkan.
      </p>
      <ul className="app-list">
        {settings.exclusions.map((id) => {
          const app = byId.get(id);
          return (
            <li key={id} className="app-row">
              <AppTile name={app?.name ?? id} installed={app} known={known} size={28} />
              <span className="grow name">
                {app?.name ?? id}
                <span className="small muted"> {id}</span>
              </span>
              <button
                className="remove"
                aria-label={`Hapus ${app?.name ?? id} dari pengecualian`}
                onClick={() => set(settings.exclusions.filter((x) => x !== id))}
              >
                ×
              </button>
            </li>
          );
        })}
        {settings.exclusions.length === 0 && <li className="muted empty">Belum ada pengecualian.</li>}
      </ul>
      <button className="pill add-app" onClick={() => setPicking(true)}>
        + Tambah app
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

function GeneralTab() {
  const { settings, save } = useSettings();
  const { presets } = usePresets();
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    api.status().then(setStatus);
  }, []);

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

      <UpdateSetting version={status?.version} />

      <div className="setting">
        <div>
          <div>Batas waktu tunggu</div>
          <p className="muted small">
            Lama Docky menunggu app menutup diri. App dengan pekerjaan belum disimpan tidak pernah dipaksa tutup; setelah
            batas ini Docky lanjut tanpa app itu.
          </p>
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

      <div className="setting">
        <div>
          <div>Dock asli</div>
          <p className="muted small">
            Memulihkan isi dock seperti sebelum Docky pertama dipakai. Berbeda dengan Kembalikan, yang hanya membatalkan
            preset terakhir.
          </p>
        </div>
        {confirm ? (
          <div className="inline-actions">
            <button className="pill primary" onClick={restore}>
              Pulihkan
            </button>
            <button className="pill" onClick={() => setConfirm(false)}>
              Batal
            </button>
          </div>
        ) : (
          <button className="pill" disabled={!status?.has_backup} onClick={() => setConfirm(true)}>
            Pulihkan dock asli…
          </button>
        )}
      </div>
      {message && <p className="notice">{message}</p>}

      <div className="setting">
        <div>
          <div>Layar pengenalan</div>
          <p className="muted small">Tampilkan lagi penjelasan singkat di panel.</p>
        </div>
        <button className="pill" disabled={!settings.welcome_seen} onClick={() => save({ ...settings, welcome_seen: false })}>
          Tampilkan lagi
        </button>
      </div>

      <div className="about muted small">
        <p>
          {presets.length} preset · {presets.filter((p) => p.mode === "clean").length} {MODE_LABEL.clean.toLowerCase()},{" "}
          {presets.filter((p) => p.mode === "dock_only").length} {MODE_LABEL.dock_only.toLowerCase()}
        </p>
        <p>
          Data tersimpan di {status?.data_dir ?? "~/Library/Application Support/Docky"}. Docky hanya terhubung ke internet untuk
          mengecek update.
        </p>
        <p>Docky {status?.version ?? ""} · Open source, lisensi MIT.</p>
      </div>
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
      <div>
        <div>Update{version ? ` · versi ${version}` : ""}</div>
        <p className="muted small">{error ?? updateText(update)}</p>
      </div>
      {update.state === "ready" ? (
        <button className="pill primary" onClick={install}>
          Restart untuk update →
        </button>
      ) : (
        <button className="pill" disabled={working} onClick={() => api.checkUpdate()}>
          Periksa update
        </button>
      )}
    </div>
  );
}
