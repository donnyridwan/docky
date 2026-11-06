//! Tipe data yang dipakai bersama oleh logika, penyimpanan, dan tampilan.

use serde::{Deserialize, Serialize};

/// Bundle ID Finder. Finder tidak pernah ditutup oleh Docky.
pub const FINDER_BUNDLE_ID: &str = "com.apple.finder";

/// Mode menjalankan preset.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum PresetMode {
    /// "Bersih total": tutup app di luar preset, ganti dock, buka app "buka otomatis".
    #[default]
    Clean,
    /// "Ganti dock saja": hanya mengganti isi dock.
    DockOnly,
}

/// Satu app di dalam preset. App dicatat dengan bundle ID, bukan lokasi file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PresetApp {
    pub bundle_id: String,
    pub name: String,
    /// Urutan di dock, mulai dari 1.
    pub order: u32,
    /// Dibuka saat preset dijalankan (mode Bersih total).
    pub auto_open: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Preset {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub mode: PresetMode,
    #[serde(default)]
    pub apps: Vec<PresetApp>,
}

impl Preset {
    /// App diurutkan sesuai urutan di dock.
    pub fn sorted_apps(&self) -> Vec<&PresetApp> {
        let mut apps: Vec<&PresetApp> = self.apps.iter().collect();
        apps.sort_by_key(|a| a.order);
        apps
    }

    pub fn contains(&self, bundle_id: &str) -> bool {
        self.apps.iter().any(|a| a.bundle_id == bundle_id)
    }

    /// Rapikan nomor urut menjadi 1..n tanpa celah, dan buang bundle ID ganda.
    pub fn normalize(&mut self) {
        self.apps.sort_by_key(|a| a.order);
        let mut seen = std::collections::HashSet::new();
        self.apps.retain(|a| seen.insert(a.bundle_id.clone()));
        for (i, app) in self.apps.iter_mut().enumerate() {
            app.order = i as u32 + 1;
        }
    }
}

/// App yang sedang berjalan, seperti dilaporkan sistem.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RunningApp {
    pub bundle_id: String,
    pub name: String,
    /// `true` untuk app biasa (punya ikon di dock). App latar belakang dan
    /// app menu bar bernilai `false` dan tidak pernah ditutup.
    pub regular: bool,
}

/// App terpasang, hasil AppScanner.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InstalledApp {
    pub bundle_id: String,
    pub name: String,
    pub path: String,
    /// Ikon PNG dalam bentuk data URL, kalau tersedia.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

/// Pengaturan di settings.json.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    /// Bundle ID yang tidak pernah ditutup oleh Docky.
    pub exclusions: Vec<String>,
    /// Batas waktu tunggu app menutup diri, dalam milidetik.
    pub quit_timeout_ms: u64,
    /// Layar pengenalan sudah dilihat.
    pub welcome_seen: bool,
    /// Preset yang terakhir dipilih di panel.
    pub selected_preset: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            exclusions: Vec::new(),
            quit_timeout_ms: 5_000,
            welcome_seen: false,
            selected_preset: None,
        }
    }
}

/// Langkah dalam alur menjalankan preset.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Step {
    Snapshot,
    CloseApps,
    WaitForQuit,
    ReplaceDock,
    OpenApps,
}

impl Step {
    pub fn number(self) -> u8 {
        match self {
            Step::Snapshot => 1,
            Step::CloseApps => 2,
            Step::WaitForQuit => 3,
            Step::ReplaceDock => 4,
            Step::OpenApps => 5,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Step::Snapshot => "Memotret kondisi sekarang",
            Step::CloseApps => "Menutup app di luar preset",
            Step::WaitForQuit => "Menunggu app menutup diri",
            Step::ReplaceDock => "Mengganti isi dock",
            Step::OpenApps => "Membuka app",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StepStatus {
    Started,
    Done,
    Failed,
}

/// Event progres, dikirim ke tampilan satu per langkah.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Progress {
    pub step: Step,
    /// Posisi langkah ini di antara langkah yang dijalankan (1-based).
    pub index: u8,
    /// Jumlah langkah yang dijalankan untuk mode ini.
    pub total: u8,
    pub status: StepStatus,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// Ringkasan setelah preset selesai.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RunSummary {
    pub preset_name: String,
    pub mode: PresetMode,
    /// Nama app yang berhasil ditutup.
    pub closed: Vec<String>,
    /// Nama app yang dibuka.
    pub opened: Vec<String>,
    /// App yang diminta tutup tapi masih terbuka (pekerjaan belum disimpan atau macet).
    pub still_running: Vec<String>,
    /// App yang gagal dibuka.
    pub open_failed: Vec<String>,
    /// App di preset yang sudah tidak terpasang.
    pub missing: Vec<String>,
    pub dock_changed: bool,
    /// Alasan dock tidak diganti, kalau ada.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dock_error: Option<String>,
    pub duration_ms: u64,
}

impl RunSummary {
    /// Kalimat ringkas untuk ditampilkan, misalnya
    /// "4 app ditutup, 2 dibuka. Figma masih terbuka karena ada pekerjaan belum disimpan."
    pub fn sentence(&self) -> String {
        let mut parts = Vec::new();
        if self.mode == PresetMode::Clean {
            parts.push(format!(
                "{} app ditutup, {} dibuka.",
                self.closed.len(),
                self.opened.len()
            ));
        } else if self.dock_changed {
            parts.push("Dock sudah diganti.".to_string());
        }
        if !self.still_running.is_empty() {
            parts.push(format!(
                "{} masih terbuka karena ada pekerjaan belum disimpan.",
                join_names(&self.still_running)
            ));
        }
        if !self.missing.is_empty() {
            parts.push(format!(
                "{} tidak ditemukan dan dilewati.",
                join_names(&self.missing)
            ));
        }
        if !self.open_failed.is_empty() {
            parts.push(format!("{} gagal dibuka.", join_names(&self.open_failed)));
        }
        if let Some(err) = &self.dock_error {
            parts.push(format!("Dock tidak diubah: {err}"));
        }
        parts.join(" ")
    }
}

/// Gabungkan nama: "A", "A dan B", "A, B, dan C".
pub fn join_names(names: &[String]) -> String {
    match names.len() {
        0 => String::new(),
        1 => names[0].clone(),
        2 => format!("{} dan {}", names[0], names[1]),
        n => format!("{}, dan {}", names[..n - 1].join(", "), names[n - 1]),
    }
}

/// Hasil "Kembalikan".
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct UndoSummary {
    pub dock_restored: bool,
    pub reopened: Vec<String>,
    pub open_failed: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sentence_matches_spec_example() {
        let s = RunSummary {
            mode: PresetMode::Clean,
            closed: vec!["A".into(), "B".into(), "C".into(), "D".into()],
            opened: vec!["Claude".into(), "Slack".into()],
            still_running: vec!["Figma".into()],
            ..Default::default()
        };
        assert_eq!(
            s.sentence(),
            "4 app ditutup, 2 dibuka. Figma masih terbuka karena ada pekerjaan belum disimpan."
        );
    }

    #[test]
    fn join_names_indonesian() {
        let n = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(join_names(&n(&["A"])), "A");
        assert_eq!(join_names(&n(&["A", "B"])), "A dan B");
        assert_eq!(join_names(&n(&["A", "B", "C"])), "A, B, dan C");
    }

    #[test]
    fn normalize_reorders_and_dedups() {
        let mut p = Preset {
            id: "x".into(),
            name: "x".into(),
            mode: PresetMode::Clean,
            apps: vec![
                PresetApp { bundle_id: "b".into(), name: "B".into(), order: 7, auto_open: true },
                PresetApp { bundle_id: "a".into(), name: "A".into(), order: 2, auto_open: false },
                PresetApp { bundle_id: "b".into(), name: "B".into(), order: 9, auto_open: false },
            ],
        };
        p.normalize();
        let ids: Vec<_> = p.apps.iter().map(|a| (a.bundle_id.as_str(), a.order)).collect();
        assert_eq!(ids, vec![("a", 1), ("b", 2)]);
    }
}
