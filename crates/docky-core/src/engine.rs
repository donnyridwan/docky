//! Alur menjalankan preset, Kembalikan, dan Dock asli.
//!
//! Hanya [`AppController`] dan [`DockManager`] yang menyentuh macOS. Keduanya
//! berupa trait, jadi tes memakai versi palsu (lihat [`crate::fakes`]).

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use plist::Value;
use thiserror::Error;

use crate::dock::{self, DockFormatError, TileSpec};
use crate::model::{
    Preset, PresetMode, Progress, RunSummary, RunningApp, Settings, Step, StepStatus, UndoSummary,
    FINDER_BUNDLE_ID,
};
use crate::plan;
use crate::store::{Snapshot, Storage, StoreError};

/// Menutup dan membuka app. Implementasi macOS memakai NSRunningApplication.
pub trait AppController: Send + Sync {
    /// Semua app yang sedang berjalan.
    fn running_apps(&self) -> Vec<RunningApp>;
    /// Minta app menutup diri dengan sopan (seperti ⌘Q). Tidak menunggu,
    /// tidak pernah memaksa tutup.
    fn request_quit(&self, bundle_id: &str);
    fn is_running(&self, bundle_id: &str) -> bool;
    /// Buka app. Mengembalikan pesan galat kalau gagal.
    fn open(&self, bundle_id: &str) -> Result<(), String>;
    /// Lokasi .app untuk bundle ID ini, atau `None` kalau tidak terpasang.
    fn app_path(&self, bundle_id: &str) -> Option<String>;
}

/// Membaca dan menulis domain `com.apple.dock`, dan me-restart Dock.
pub trait DockManager: Send + Sync {
    /// Isi domain dock sebagai byte plist.
    fn read(&self) -> Result<Vec<u8>, String>;
    /// Ganti isi domain dock dengan plist ini.
    fn write(&self, plist: &[u8]) -> Result<(), String>;
    /// Restart Dock dan tunggu sampai berjalan lagi.
    fn restart(&self) -> Result<(), String>;
}

impl<T: AppController + ?Sized> AppController for std::sync::Arc<T> {
    fn running_apps(&self) -> Vec<RunningApp> {
        (**self).running_apps()
    }
    fn request_quit(&self, bundle_id: &str) {
        (**self).request_quit(bundle_id)
    }
    fn is_running(&self, bundle_id: &str) -> bool {
        (**self).is_running(bundle_id)
    }
    fn open(&self, bundle_id: &str) -> Result<(), String> {
        (**self).open(bundle_id)
    }
    fn app_path(&self, bundle_id: &str) -> Option<String> {
        (**self).app_path(bundle_id)
    }
}

impl<T: DockManager + ?Sized> DockManager for std::sync::Arc<T> {
    fn read(&self) -> Result<Vec<u8>, String> {
        (**self).read()
    }
    fn write(&self, plist: &[u8]) -> Result<(), String> {
        (**self).write(plist)
    }
    fn restart(&self) -> Result<(), String> {
        (**self).restart()
    }
}

#[derive(Debug, Error)]
pub enum EngineError {
    #[error("Preset lain sedang berjalan.")]
    Busy,
    #[error("Belum ada langkah yang bisa dikembalikan.")]
    NoSnapshot,
    #[error("Cadangan dock asli belum ada.")]
    NoBackup,
    #[error("Dock tidak bisa dibaca: {0}")]
    DockRead(String),
    #[error("{0}")]
    DockFormat(#[from] DockFormatError),
    #[error("Dock gagal diubah: {0}")]
    DockWrite(String),
    #[error("Dock tidak sesuai setelah restart, isi sebelumnya sudah dipulihkan.")]
    DockMismatch,
    #[error("{0}")]
    Store(#[from] StoreError),
}

/// Melepas kunci "sedang berjalan" saat keluar dari scope, termasuk saat panik.
struct BusyGuard<'a>(&'a AtomicBool);

impl Drop for BusyGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

pub struct Engine<A: AppController, D: DockManager> {
    pub apps: A,
    pub dock: D,
    pub storage: Storage,
    /// Bundle ID Docky sendiri, tidak pernah ditutup.
    pub self_bundle_id: String,
    /// Jeda antar pengecekan saat menunggu app menutup diri.
    pub poll_interval: Duration,
    busy: AtomicBool,
}

impl<A: AppController, D: DockManager> Engine<A, D> {
    pub fn new(apps: A, dock: D, storage: Storage, self_bundle_id: impl Into<String>) -> Self {
        Engine {
            apps,
            dock,
            storage,
            self_bundle_id: self_bundle_id.into(),
            poll_interval: Duration::from_millis(100),
            busy: AtomicBool::new(false),
        }
    }

    pub fn is_busy(&self) -> bool {
        self.busy.load(Ordering::SeqCst)
    }

    fn lock(&self) -> Result<BusyGuard<'_>, EngineError> {
        self.busy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| EngineError::Busy)?;
        Ok(BusyGuard(&self.busy))
    }

    fn read_dock(&self) -> Result<Value, EngineError> {
        let bytes = self.dock.read().map_err(EngineError::DockRead)?;
        Ok(dock::parse(&bytes)?)
    }

    /// Simpan cadangan dock asli kalau belum ada. Dipanggil saat Docky
    /// pertama dibuka dan sebelum setiap perubahan dock.
    pub fn ensure_dock_backup(&self) -> Result<bool, EngineError> {
        if self.storage.has_dock_backup() {
            return Ok(false);
        }
        let bytes = self.dock.read().map_err(EngineError::DockRead)?;
        // Simpan sebagai XML supaya mudah dibaca dan dipulihkan manual.
        let to_save = match dock::parse(&bytes) {
            Ok(v) => dock::to_xml(&v),
            Err(_) => bytes,
        };
        Ok(self.storage.save_dock_backup_once(&to_save)?)
    }

    /// Tulis domain dock, restart Dock, lalu baca ulang dan pastikan deretan
    /// app sesuai. Kalau tidak sesuai, tulis kembali `fallback` dan laporkan.
    fn write_and_verify(&self, new: &Value, expected: &[String], fallback: &Value) -> Result<(), EngineError> {
        self.dock.write(&dock::to_xml(new)).map_err(EngineError::DockWrite)?;
        self.dock.restart().map_err(EngineError::DockWrite)?;

        let ok = match self.read_dock() {
            Ok(after) => dock::app_ids(&after) == expected,
            Err(_) => false,
        };
        if ok {
            return Ok(());
        }
        let _ = self.dock.write(&dock::to_xml(fallback));
        let _ = self.dock.restart();
        Err(EngineError::DockMismatch)
    }

    /// Jalankan preset. `on_progress` dipanggil di awal dan akhir setiap langkah.
    pub fn run_preset(
        &self,
        preset: &Preset,
        settings: &Settings,
        on_progress: &mut dyn FnMut(Progress),
    ) -> Result<RunSummary, EngineError> {
        let _guard = self.lock()?;
        let started = Instant::now();

        let steps: &[Step] = match preset.mode {
            PresetMode::Clean => &[
                Step::Snapshot,
                Step::CloseApps,
                Step::WaitForQuit,
                Step::ReplaceDock,
                Step::OpenApps,
            ],
            PresetMode::DockOnly => &[Step::Snapshot, Step::ReplaceDock],
        };
        let total = steps.len() as u8;
        let index_of = |s: Step| steps.iter().position(|x| *x == s).map(|i| i as u8 + 1).unwrap_or(0);
        let mut emit = |step: Step, status: StepStatus, detail: Option<String>| {
            on_progress(Progress {
                step,
                index: index_of(step),
                total,
                status,
                label: step.label().to_string(),
                detail,
            })
        };

        let mut summary = RunSummary {
            preset_name: preset.name.clone(),
            mode: preset.mode,
            ..Default::default()
        };

        // 1. Potret kondisi sekarang.
        emit(Step::Snapshot, StepStatus::Started, None);
        let running: Vec<RunningApp> = self.apps.running_apps().into_iter().filter(|a| a.regular).collect();
        let dock_before = match self.read_dock() {
            Ok(v) => match dock::validate(&v) {
                Ok(()) => Ok(v),
                Err(e) => Err(EngineError::from(e)),
            },
            Err(e) => Err(e),
        };
        if dock_before.is_ok() {
            self.ensure_dock_backup()?;
        }
        let snapshot = Snapshot {
            version: 1,
            taken_at: SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0),
            preset_id: preset.id.clone(),
            preset_name: preset.name.clone(),
            mode: preset.mode,
            running_apps: running.clone(),
            dock_apps_plist: match &dock_before {
                Ok(v) => String::from_utf8(dock::to_xml(&dock::apps_value(v))).unwrap_or_default(),
                Err(_) => String::new(),
            },
            show_recents: dock_before.as_ref().ok().and_then(dock::show_recents),
        };
        self.storage.save_snapshot(&snapshot)?;
        emit(Step::Snapshot, StepStatus::Done, None);

        if preset.mode == PresetMode::Clean {
            // 2. Tutup app di luar preset, semua bersamaan.
            let targets: Vec<RunningApp> =
                plan::apps_to_close(&running, preset, &settings.exclusions, &self.self_bundle_id)
                    .into_iter()
                    .cloned()
                    .collect();
            emit(Step::CloseApps, StepStatus::Started, Some(format!("{} app", targets.len())));
            for app in &targets {
                self.apps.request_quit(&app.bundle_id);
            }
            emit(Step::CloseApps, StepStatus::Done, None);

            // 3. Tunggu maksimal sekitar 5 detik. Tidak menjawab dialog, tidak memaksa tutup.
            emit(Step::WaitForQuit, StepStatus::Started, None);
            let deadline = Instant::now() + Duration::from_millis(settings.quit_timeout_ms);
            let mut pending: Vec<&RunningApp> = targets.iter().collect();
            loop {
                pending.retain(|a| self.apps.is_running(&a.bundle_id));
                if pending.is_empty() || Instant::now() >= deadline {
                    break;
                }
                std::thread::sleep(self.poll_interval);
            }
            summary.still_running = pending.iter().map(|a| a.name.clone()).collect();
            summary.closed = targets
                .iter()
                .filter(|a| !pending.iter().any(|p| p.bundle_id == a.bundle_id))
                .map(|a| a.name.clone())
                .collect();
            emit(Step::WaitForQuit, StepStatus::Done, None);
        }

        // 4. Ganti isi dock.
        emit(Step::ReplaceDock, StepStatus::Started, None);
        let mut tiles = Vec::new();
        for app in preset.sorted_apps() {
            match self.apps.app_path(&app.bundle_id) {
                Some(path) => tiles.push(TileSpec { bundle_id: app.bundle_id.clone(), name: app.name.clone(), path }),
                None => summary.missing.push(app.name.clone()),
            }
        }
        let dock_result = dock_before.and_then(|before| {
            let new = dock::apply_preset(&before, &tiles)?;
            if new == before {
                return Ok(());
            }
            let expected: Vec<String> = tiles.iter().map(|t| t.bundle_id.clone()).collect();
            self.write_and_verify(&new, &expected, &before)
        });
        match dock_result {
            Ok(()) => {
                summary.dock_changed = true;
                emit(Step::ReplaceDock, StepStatus::Done, None);
            }
            Err(e) => {
                summary.dock_error = Some(e.to_string());
                emit(Step::ReplaceDock, StepStatus::Failed, Some(e.to_string()));
            }
        }

        if preset.mode == PresetMode::Clean {
            // 5. Buka app "buka otomatis", sesudah restart Dock supaya tidak terganggu.
            emit(Step::OpenApps, StepStatus::Started, None);
            let running_now = self.apps.running_apps();
            for app in plan::apps_to_open(preset, &running_now) {
                if summary.missing.contains(&app.name) {
                    continue;
                }
                match self.apps.open(&app.bundle_id) {
                    Ok(()) => summary.opened.push(app.name.clone()),
                    Err(_) => summary.open_failed.push(app.name.clone()),
                }
            }
            emit(Step::OpenApps, StepStatus::Done, None);
        }

        summary.duration_ms = started.elapsed().as_millis() as u64;
        Ok(summary)
    }

    /// Kembalikan: pulihkan dock dari potret terakhir dan buka lagi app yang tadi ditutup.
    pub fn undo_last(&self) -> Result<UndoSummary, EngineError> {
        let _guard = self.lock()?;
        let snapshot = self.storage.load_snapshot()?.ok_or(EngineError::NoSnapshot)?;
        let mut result = UndoSummary::default();

        if !snapshot.dock_apps_plist.is_empty() {
            let saved = dock::parse(snapshot.dock_apps_plist.as_bytes())?;
            let current = self.read_dock()?;
            let new = dock::restore_apps(&current, &saved, snapshot.show_recents)?;
            if new != current {
                let expected = dock::app_ids(&new);
                self.write_and_verify(&new, &expected, &current)?;
            }
            result.dock_restored = true;
        }

        let running_now = self.apps.running_apps();
        for app in &snapshot.running_apps {
            if !app.regular
                || app.bundle_id == FINDER_BUNDLE_ID
                || app.bundle_id == self.self_bundle_id
                || running_now.iter().any(|r| r.bundle_id == app.bundle_id)
            {
                continue;
            }
            match self.apps.open(&app.bundle_id) {
                Ok(()) => result.reopened.push(app.name.clone()),
                Err(_) => result.open_failed.push(app.name.clone()),
            }
        }

        self.storage.clear_snapshot()?;
        Ok(result)
    }

    /// Dock asli: pulihkan deretan app dari cadangan sebelum Docky pertama dipakai.
    pub fn restore_original_dock(&self) -> Result<(), EngineError> {
        let _guard = self.lock()?;
        let backup = self.storage.load_dock_backup()?.ok_or(EngineError::NoBackup)?;
        let backup = dock::parse(&backup)?;
        dock::validate(&backup)?;
        let current = self.read_dock()?;
        let new = dock::restore_apps(&current, &dock::apps_value(&backup), dock::show_recents(&backup))?;
        if new != current {
            let expected = dock::app_ids(&new);
            self.write_and_verify(&new, &expected, &current)?;
        }
        Ok(())
    }

    /// Buat preset dari kondisi sekarang (belum disimpan).
    pub fn preset_from_current(&self, id: String, name: String) -> Preset {
        let dock_apps = self.read_dock().map(|d| dock::dock_apps(&d)).unwrap_or_default();
        plan::preset_from_current(id, name, &dock_apps, &self.apps.running_apps(), &self.self_bundle_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fakes::{EventLog, FakeAppController, FakeDockManager};
    use crate::model::PresetApp;
    use std::sync::Arc;

    const SELF_ID: &str = "id.gandariastudio.docky";

    fn fixture(name: &str) -> Vec<u8> {
        std::fs::read(format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"))).unwrap()
    }

    fn app(id: &str, name: &str, order: u32, auto_open: bool) -> PresetApp {
        PresetApp { bundle_id: id.into(), name: name.into(), order, auto_open }
    }

    fn kerja() -> Preset {
        Preset {
            id: "kerja".into(),
            name: "Kerja".into(),
            mode: PresetMode::Clean,
            apps: vec![
                app("com.anthropic.claudefordesktop", "Claude", 1, true),
                app("com.figma.Desktop", "Figma", 2, true),
                app("com.tinyspeck.slackmacgap", "Slack", 3, true),
                app("notion.id", "Notion", 4, false),
            ],
        }
    }

    struct Setup {
        _dir: tempfile::TempDir,
        engine: Engine<Arc<FakeAppController>, Arc<FakeDockManager>>,
        apps: Arc<FakeAppController>,
        dock: Arc<FakeDockManager>,
        log: EventLog,
    }

    fn setup(dock_fixture: &str) -> Setup {
        let dir = tempfile::tempdir().unwrap();
        let log = EventLog::default();
        let apps = Arc::new(FakeAppController::with_log(log.clone()));
        for (id, name) in [
            ("com.anthropic.claudefordesktop", "Claude"),
            ("com.figma.Desktop", "Figma"),
            ("com.tinyspeck.slackmacgap", "Slack"),
            ("notion.id", "Notion"),
            ("com.apple.Safari", "Safari"),
            ("com.apple.Music", "Music"),
            ("com.apple.TextEdit", "TextEdit"),
        ] {
            apps.install(id, name);
        }
        apps.launch("com.apple.finder", "Finder", true);
        apps.launch(SELF_ID, "Docky", false);
        apps.launch("com.example.menubar", "Menubar", false);
        apps.launch("com.figma.Desktop", "Figma", true);
        apps.launch("com.apple.Safari", "Safari", true);
        apps.launch("com.apple.Music", "Music", true);
        let dock = Arc::new(FakeDockManager::with_log(fixture(dock_fixture), log.clone()));
        let mut engine = Engine::new(apps.clone(), dock.clone(), Storage::new(dir.path()), SELF_ID);
        engine.poll_interval = Duration::from_millis(5);
        Setup { _dir: dir, engine, apps, dock, log }
    }

    fn fast() -> Settings {
        Settings { quit_timeout_ms: 200, ..Default::default() }
    }

    #[test]
    fn clean_run_follows_five_steps() {
        let s = setup("dock-macos14.plist");
        let mut events = Vec::new();
        let summary = s.engine.run_preset(&kerja(), &fast(), &mut |p| events.push(p)).unwrap();

        assert_eq!(summary.closed, vec!["Safari", "Music"]);
        assert_eq!(summary.opened, vec!["Claude", "Slack"]); // Figma sudah terbuka
        assert!(summary.still_running.is_empty());
        assert!(summary.dock_changed);
        assert!(s.apps.is_running("com.apple.finder"));
        assert!(s.apps.is_running("com.example.menubar"));
        assert!(!s.apps.is_running("notion.id"));
        assert_eq!(s.apps.open_calls(), vec!["com.anthropic.claudefordesktop", "com.tinyspeck.slackmacgap"]);

        let d = dock::parse(&s.dock.current()).unwrap();
        assert_eq!(
            dock::app_ids(&d),
            vec!["com.anthropic.claudefordesktop", "com.figma.Desktop", "com.tinyspeck.slackmacgap", "notion.id"]
        );
        assert_eq!(dock::show_recents(&d), Some(false));
        assert_eq!(s.dock.restarts(), 1);

        let steps: Vec<_> = events.iter().filter(|e| e.status == StepStatus::Done).map(|e| e.step.number()).collect();
        assert_eq!(steps, vec![1, 2, 3, 4, 5]);
        assert!(events.iter().all(|e| e.total == 5));
        assert_eq!(
            summary.sentence(),
            "2 app ditutup, 2 dibuka."
        );
    }

    #[test]
    fn dock_is_restarted_before_apps_are_opened() {
        let s = setup("dock-macos14.plist");
        s.engine.run_preset(&kerja(), &fast(), &mut |_| {}).unwrap();
        let log = s.log.lock().unwrap().clone();
        let restart = log.iter().position(|e| e == "restart").unwrap();
        let first_open = log.iter().position(|e| e.starts_with("open")).unwrap();
        assert!(restart < first_open, "{log:?}");
    }

    #[test]
    fn dock_only_runs_steps_1_and_4() {
        let s = setup("dock-macos13.plist");
        let mut preset = kerja();
        preset.mode = PresetMode::DockOnly;
        let mut events = Vec::new();
        let summary = s.engine.run_preset(&preset, &fast(), &mut |p| events.push(p)).unwrap();
        assert!(summary.closed.is_empty() && summary.opened.is_empty());
        assert!(s.apps.is_running("com.apple.Music"));
        assert!(s.apps.open_calls().is_empty());
        let done: Vec<_> = events.iter().filter(|e| e.status == StepStatus::Done).map(|e| (e.step.number(), e.index, e.total)).collect();
        assert_eq!(done, vec![(1, 1, 2), (4, 2, 2)]);
        assert!(summary.dock_changed);
    }

    #[test]
    fn app_with_unsaved_work_is_waited_for_then_skipped() {
        let s = setup("dock-macos14.plist");
        s.apps.launch("com.apple.TextEdit", "TextEdit", true);
        s.apps.make_stubborn("com.apple.TextEdit");
        let summary = s.engine.run_preset(&kerja(), &fast(), &mut |_| {}).unwrap();
        assert_eq!(summary.still_running, vec!["TextEdit"]);
        assert!(s.apps.is_running("com.apple.TextEdit"), "tidak boleh dipaksa tutup");
        assert!(summary.dock_changed, "preset tetap selesai");
        assert!(summary.sentence().contains("TextEdit masih terbuka"));
    }

    #[test]
    fn missing_app_is_skipped_and_reported() {
        let s = setup("dock-macos14.plist");
        s.apps.uninstall("com.tinyspeck.slackmacgap");
        let summary = s.engine.run_preset(&kerja(), &fast(), &mut |_| {}).unwrap();
        assert_eq!(summary.missing, vec!["Slack"]);
        assert_eq!(summary.opened, vec!["Claude"]);
        let d = dock::parse(&s.dock.current()).unwrap();
        assert!(!dock::app_ids(&d).contains(&"com.tinyspeck.slackmacgap".to_string()));
    }

    #[test]
    fn failed_open_is_reported_but_preset_finishes() {
        let s = setup("dock-macos14.plist");
        s.apps.make_open_fail("com.anthropic.claudefordesktop");
        let summary = s.engine.run_preset(&kerja(), &fast(), &mut |_| {}).unwrap();
        assert_eq!(summary.open_failed, vec!["Claude"]);
        assert_eq!(summary.opened, vec!["Slack"]);
    }

    #[test]
    fn unknown_dock_format_changes_nothing_in_dock() {
        let s = setup("dock-unknown.plist");
        let before = s.dock.current();
        let summary = s.engine.run_preset(&kerja(), &fast(), &mut |_| {}).unwrap();
        assert!(!summary.dock_changed);
        assert!(summary.dock_error.unwrap().contains("tidak dikenali"));
        assert_eq!(s.dock.current(), before);
        assert_eq!(s.dock.writes(), 0);
        assert_eq!(s.dock.restarts(), 0);
    }

    #[test]
    fn mismatch_after_restart_restores_previous_dock() {
        let s = setup("dock-macos15.plist");
        let before = s.dock.current();
        s.dock.ignore_writes();
        let summary = s.engine.run_preset(&kerja(), &fast(), &mut |_| {}).unwrap();
        assert!(!summary.dock_changed);
        assert!(summary.dock_error.is_some());
        assert_eq!(dock::parse(&s.dock.current()).unwrap(), dock::parse(&before).unwrap());
    }

    #[test]
    fn backup_is_written_once_before_first_change() {
        let s = setup("dock-macos14.plist");
        let original = dock::parse(&s.dock.current()).unwrap();
        s.engine.run_preset(&kerja(), &fast(), &mut |_| {}).unwrap();
        let mut other = kerja();
        other.apps.truncate(1);
        s.engine.run_preset(&other, &fast(), &mut |_| {}).unwrap();
        let backup = dock::parse(&s.engine.storage.load_dock_backup().unwrap().unwrap()).unwrap();
        assert_eq!(backup, original);
    }

    #[test]
    fn undo_restores_dock_and_reopens_closed_apps() {
        let s = setup("dock-macos14.plist");
        let before = dock::parse(&s.dock.current()).unwrap();
        s.engine.run_preset(&kerja(), &fast(), &mut |_| {}).unwrap();
        let undo = s.engine.undo_last().unwrap();
        assert!(undo.dock_restored);
        assert_eq!(undo.reopened, vec!["Safari", "Music"]);
        assert_eq!(dock::parse(&s.dock.current()).unwrap(), before);
        assert!(matches!(s.engine.undo_last(), Err(EngineError::NoSnapshot)));
    }

    #[test]
    fn restore_original_dock_uses_first_backup() {
        let s = setup("dock-macos13.plist");
        let original = dock::parse(&s.dock.current()).unwrap();
        s.engine.run_preset(&kerja(), &fast(), &mut |_| {}).unwrap();
        let mut second = kerja();
        second.apps.reverse();
        for (i, a) in second.apps.iter_mut().enumerate() {
            a.order = i as u32 + 1;
        }
        s.engine.run_preset(&second, &fast(), &mut |_| {}).unwrap();
        s.engine.restore_original_dock().unwrap();
        let now = dock::parse(&s.dock.current()).unwrap();
        assert_eq!(dock::app_ids(&now), dock::app_ids(&original));
        assert_eq!(dock::show_recents(&now), dock::show_recents(&original));
    }

    #[test]
    fn restore_original_without_backup_fails_safely() {
        let s = setup("dock-macos13.plist");
        assert!(matches!(s.engine.restore_original_dock(), Err(EngineError::NoBackup)));
        assert_eq!(s.dock.writes(), 0);
    }

    #[test]
    fn two_presets_cannot_run_at_once() {
        let s = setup("dock-macos14.plist");
        let mut nested = None;
        s.engine
            .run_preset(&kerja(), &fast(), &mut |p| {
                if p.step == Step::Snapshot && p.status == StepStatus::Started {
                    nested = Some(s.engine.run_preset(&kerja(), &fast(), &mut |_| {}).is_err());
                }
            })
            .unwrap();
        assert_eq!(nested, Some(true));
        assert!(!s.engine.is_busy());
    }

    #[test]
    fn preset_from_current_state() {
        let s = setup("dock-macos14.plist");
        let p = s.engine.preset_from_current("baru".into(), "Baru".into());
        let safari = p.apps.iter().find(|a| a.bundle_id == "com.apple.Safari").unwrap();
        let mail = p.apps.iter().find(|a| a.bundle_id == "com.apple.mail").unwrap();
        assert!(safari.auto_open);
        assert!(!mail.auto_open);
        assert!(p.apps.iter().all(|a| a.bundle_id != "com.apple.finder"));
    }
}
