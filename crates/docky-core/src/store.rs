//! Penyimpanan di `~/Library/Application Support/Docky/`:
//!
//! | File               | Isi                                             |
//! |--------------------|-------------------------------------------------|
//! | presets.json       | Semua preset, dengan nomor versi format         |
//! | settings.json      | Pengecualian, batas waktu, penanda pengenalan   |
//! | dockbackup.plist   | Cadangan dock asli, ditulis sekali              |
//! | lastsnapshot.json  | Potret kondisi sebelum preset terakhir          |
//!
//! Setiap penulisan memakai file sementara yang lalu menggantikan file lama.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::model::{Preset, PresetApp, PresetMode, RunningApp, Settings};

pub const PRESETS_FILE: &str = "presets.json";
pub const PRESETS_BROKEN_FILE: &str = "presets.broken.json";
pub const SETTINGS_FILE: &str = "settings.json";
pub const DOCK_BACKUP_FILE: &str = "dockbackup.plist";
pub const SNAPSHOT_FILE: &str = "lastsnapshot.json";

/// Versi format presets.json yang ditulis versi ini.
pub const PRESETS_FORMAT_VERSION: u32 = 1;

#[derive(Debug, Error)]
pub enum StoreError {
    #[error("gagal membaca/menulis {path}: {source}")]
    Io {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("isi {0} rusak: {1}")]
    Corrupt(String, String),
}

fn io_err(path: &Path, source: std::io::Error) -> StoreError {
    StoreError::Io { path: path.display().to_string(), source }
}

/// Tulis file secara atomik: tulis ke file sementara, fsync, lalu rename.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), StoreError> {
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(dir).map_err(|e| io_err(dir, e))?;
    let file_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("data");
    let tmp = dir.join(format!(".{file_name}.tmp-{}", std::process::id()));
    let result = (|| {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result.map_err(|e| io_err(path, e))
}

/// Hasil membaca presets.json.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LoadedPresets {
    pub presets: Vec<Preset>,
    /// Diisi kalau file rusak dan sudah disimpan sebagai presets.broken.json.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct PresetsFileV1 {
    version: u32,
    presets: Vec<Preset>,
}

/// Format lama (versi 0, sebelum ada nomor versi): array preset dengan
/// daftar bundle ID; semua app dianggap "buka otomatis".
#[derive(Debug, Deserialize)]
struct LegacyPreset {
    #[serde(default)]
    id: Option<String>,
    name: String,
    apps: Vec<String>,
}

/// Konversi isi presets.json (format apa pun yang dikenal) ke daftar preset terbaru.
pub fn decode_presets(bytes: &[u8]) -> Result<Vec<Preset>, String> {
    let raw: serde_json::Value = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    match &raw {
        serde_json::Value::Array(_) => {
            let legacy: Vec<LegacyPreset> = serde_json::from_value(raw).map_err(|e| e.to_string())?;
            Ok(legacy
                .into_iter()
                .enumerate()
                .map(|(i, p)| {
                    let mut preset = Preset {
                        id: p.id.unwrap_or_else(|| format!("preset-{}", i + 1)),
                        name: p.name,
                        mode: PresetMode::Clean,
                        apps: p
                            .apps
                            .into_iter()
                            .enumerate()
                            .map(|(j, bundle_id)| PresetApp {
                                name: bundle_id.rsplit('.').next().unwrap_or(&bundle_id).to_string(),
                                bundle_id,
                                order: j as u32 + 1,
                                auto_open: true,
                            })
                            .collect(),
                    };
                    preset.normalize();
                    preset
                })
                .collect())
        }
        serde_json::Value::Object(obj) => {
            let version = obj.get("version").and_then(|v| v.as_u64()).unwrap_or(0);
            if version > PRESETS_FORMAT_VERSION as u64 {
                return Err(format!("versi format {version} lebih baru dari yang dikenal"));
            }
            let file: PresetsFileV1 = serde_json::from_value(raw).map_err(|e| e.to_string())?;
            let mut presets = file.presets;
            presets.iter_mut().for_each(Preset::normalize);
            Ok(presets)
        }
        _ => Err("isi file bukan array atau object".into()),
    }
}

pub fn encode_presets(presets: &[Preset]) -> Vec<u8> {
    let file = PresetsFileV1 { version: PRESETS_FORMAT_VERSION, presets: presets.to_vec() };
    let mut bytes = serde_json::to_vec_pretty(&file).expect("serialisasi preset");
    bytes.push(b'\n');
    bytes
}

/// Potret kondisi sebelum preset terakhir dijalankan.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Snapshot {
    pub version: u32,
    /// Detik sejak epoch.
    pub taken_at: u64,
    pub preset_id: String,
    pub preset_name: String,
    pub mode: PresetMode,
    /// App biasa yang sedang terbuka.
    pub running_apps: Vec<RunningApp>,
    /// Deretan app di dock (`persistent-apps`) sebagai plist XML.
    pub dock_apps_plist: String,
    pub show_recents: Option<bool>,
}

/// Akses ke semua file data Docky di satu folder.
#[derive(Debug, Clone)]
pub struct Storage {
    dir: PathBuf,
}

impl Storage {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Storage { dir: dir.into() }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn path(&self, name: &str) -> PathBuf {
        self.dir.join(name)
    }

    fn read_optional(&self, name: &str) -> Result<Option<Vec<u8>>, StoreError> {
        let path = self.path(name);
        match fs::read(&path) {
            Ok(b) => Ok(Some(b)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(io_err(&path, e)),
        }
    }

    // ---- presets.json --------------------------------------------------

    /// Baca preset. Kalau file rusak: simpan sebagai presets.broken.json,
    /// mulai dengan daftar kosong, dan isi `warning` untuk memberi tahu pengguna.
    pub fn load_presets(&self) -> Result<LoadedPresets, StoreError> {
        let Some(bytes) = self.read_optional(PRESETS_FILE)? else {
            return Ok(LoadedPresets { presets: Vec::new(), warning: None });
        };
        match decode_presets(&bytes) {
            Ok(presets) => Ok(LoadedPresets { presets, warning: None }),
            Err(reason) => {
                let from = self.path(PRESETS_FILE);
                let to = self.path(PRESETS_BROKEN_FILE);
                fs::rename(&from, &to).map_err(|e| io_err(&from, e))?;
                Ok(LoadedPresets {
                    presets: Vec::new(),
                    warning: Some(format!(
                        "File preset rusak ({reason}). Disimpan sebagai {PRESETS_BROKEN_FILE}, Docky mulai dengan daftar kosong."
                    )),
                })
            }
        }
    }

    pub fn save_presets(&self, presets: &[Preset]) -> Result<(), StoreError> {
        write_atomic(&self.path(PRESETS_FILE), &encode_presets(presets))
    }

    // ---- settings.json -------------------------------------------------

    /// Baca pengaturan. File rusak atau tidak ada → pengaturan bawaan.
    pub fn load_settings(&self) -> Result<Settings, StoreError> {
        Ok(self
            .read_optional(SETTINGS_FILE)?
            .and_then(|b| serde_json::from_slice(&b).ok())
            .unwrap_or_default())
    }

    pub fn save_settings(&self, settings: &Settings) -> Result<(), StoreError> {
        let mut bytes = serde_json::to_vec_pretty(settings).expect("serialisasi pengaturan");
        bytes.push(b'\n');
        write_atomic(&self.path(SETTINGS_FILE), &bytes)
    }

    // ---- dockbackup.plist ----------------------------------------------

    pub fn has_dock_backup(&self) -> bool {
        self.path(DOCK_BACKUP_FILE).exists()
    }

    /// Simpan cadangan dock asli. Tidak pernah menimpa cadangan yang sudah ada.
    /// Mengembalikan `true` kalau cadangan baru ditulis.
    pub fn save_dock_backup_once(&self, plist_bytes: &[u8]) -> Result<bool, StoreError> {
        if self.has_dock_backup() {
            return Ok(false);
        }
        write_atomic(&self.path(DOCK_BACKUP_FILE), plist_bytes)?;
        Ok(true)
    }

    pub fn load_dock_backup(&self) -> Result<Option<Vec<u8>>, StoreError> {
        self.read_optional(DOCK_BACKUP_FILE)
    }

    // ---- lastsnapshot.json ---------------------------------------------

    pub fn save_snapshot(&self, snapshot: &Snapshot) -> Result<(), StoreError> {
        let bytes = serde_json::to_vec_pretty(snapshot).expect("serialisasi potret");
        write_atomic(&self.path(SNAPSHOT_FILE), &bytes)
    }

    pub fn load_snapshot(&self) -> Result<Option<Snapshot>, StoreError> {
        match self.read_optional(SNAPSHOT_FILE)? {
            None => Ok(None),
            Some(b) => serde_json::from_slice(&b)
                .map(Some)
                .map_err(|e| StoreError::Corrupt(SNAPSHOT_FILE.into(), e.to_string())),
        }
    }

    pub fn clear_snapshot(&self) -> Result<(), StoreError> {
        let path = self.path(SNAPSHOT_FILE);
        match fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(io_err(&path, e)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn storage() -> (tempfile::TempDir, Storage) {
        let dir = tempfile::tempdir().unwrap();
        let s = Storage::new(dir.path().join("Docky"));
        (dir, s)
    }

    fn sample() -> Preset {
        Preset {
            id: "kerja".into(),
            name: "Kerja".into(),
            mode: PresetMode::DockOnly,
            apps: vec![PresetApp { bundle_id: "com.figma.Desktop".into(), name: "Figma".into(), order: 1, auto_open: true }],
        }
    }

    #[test]
    fn presets_round_trip_with_version() {
        let (_d, s) = storage();
        assert!(s.load_presets().unwrap().presets.is_empty());
        s.save_presets(&[sample()]).unwrap();
        let raw: serde_json::Value = serde_json::from_slice(&fs::read(s.path(PRESETS_FILE)).unwrap()).unwrap();
        assert_eq!(raw["version"], 1);
        assert_eq!(s.load_presets().unwrap().presets, vec![sample()]);
    }

    #[test]
    fn legacy_format_is_converted() {
        let legacy = br#"[{"name":"Kerja","apps":["com.figma.Desktop","com.tinyspeck.slackmacgap"]}]"#;
        let presets = decode_presets(legacy).unwrap();
        assert_eq!(presets.len(), 1);
        let p = &presets[0];
        assert_eq!(p.name, "Kerja");
        assert_eq!(p.mode, PresetMode::Clean);
        assert_eq!(p.apps.len(), 2);
        assert_eq!(p.apps[1].bundle_id, "com.tinyspeck.slackmacgap");
        assert_eq!(p.apps[1].order, 2);
        assert!(p.apps.iter().all(|a| a.auto_open));
    }

    #[test]
    fn legacy_file_is_upgraded_on_next_save() {
        let (_d, s) = storage();
        fs::create_dir_all(s.dir()).unwrap();
        fs::write(s.path(PRESETS_FILE), br#"[{"name":"Lama","apps":["a.b"]}]"#).unwrap();
        let loaded = s.load_presets().unwrap();
        s.save_presets(&loaded.presets).unwrap();
        let raw: serde_json::Value = serde_json::from_slice(&fs::read(s.path(PRESETS_FILE)).unwrap()).unwrap();
        assert_eq!(raw["version"], PRESETS_FORMAT_VERSION);
        assert_eq!(raw["presets"][0]["name"], "Lama");
    }

    #[test]
    fn missing_mode_defaults_to_clean() {
        let p = decode_presets(br#"{"version":1,"presets":[{"id":"x","name":"X","apps":[]}]}"#).unwrap();
        assert_eq!(p[0].mode, PresetMode::Clean);
    }

    #[test]
    fn corrupt_presets_are_moved_aside() {
        let (_d, s) = storage();
        fs::create_dir_all(s.dir()).unwrap();
        fs::write(s.path(PRESETS_FILE), b"{ ini bukan json").unwrap();
        let loaded = s.load_presets().unwrap();
        assert!(loaded.presets.is_empty());
        assert!(loaded.warning.unwrap().contains(PRESETS_BROKEN_FILE));
        assert!(!s.path(PRESETS_FILE).exists());
        assert_eq!(fs::read(s.path(PRESETS_BROKEN_FILE)).unwrap(), b"{ ini bukan json");
    }

    #[test]
    fn newer_format_version_is_treated_as_broken_not_overwritten() {
        let (_d, s) = storage();
        fs::create_dir_all(s.dir()).unwrap();
        fs::write(s.path(PRESETS_FILE), br#"{"version":99,"presets":[]}"#).unwrap();
        let loaded = s.load_presets().unwrap();
        assert!(loaded.warning.is_some());
        assert!(s.path(PRESETS_BROKEN_FILE).exists());
    }

    #[test]
    fn dock_backup_is_never_overwritten() {
        let (_d, s) = storage();
        assert!(s.save_dock_backup_once(b"asli").unwrap());
        assert!(!s.save_dock_backup_once(b"baru").unwrap());
        assert_eq!(s.load_dock_backup().unwrap().unwrap(), b"asli");
    }

    #[test]
    fn settings_default_when_missing_or_broken() {
        let (_d, s) = storage();
        assert_eq!(s.load_settings().unwrap(), Settings::default());
        fs::create_dir_all(s.dir()).unwrap();
        fs::write(s.path(SETTINGS_FILE), b"rusak").unwrap();
        assert_eq!(s.load_settings().unwrap(), Settings::default());
        let custom = Settings { exclusions: vec!["x".into()], quit_timeout_ms: 3000, ..Default::default() };
        s.save_settings(&custom).unwrap();
        assert_eq!(s.load_settings().unwrap(), custom);
    }

    #[test]
    fn atomic_write_leaves_no_temp_files() {
        let (_d, s) = storage();
        s.save_presets(&[sample()]).unwrap();
        s.save_presets(&[]).unwrap();
        let names: Vec<_> = fs::read_dir(s.dir()).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names, vec![std::ffi::OsString::from(PRESETS_FILE)]);
    }
}
