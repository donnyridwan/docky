//! Versi palsu AppController dan DockManager untuk tes.
//! Tidak menutup app atau mengubah dock sungguhan.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use crate::engine::{AppController, DockManager};
use crate::model::RunningApp;

/// Catatan urutan kejadian, dipakai bersama oleh kedua versi palsu.
pub type EventLog = Arc<Mutex<Vec<String>>>;

#[derive(Default)]
struct AppState {
    installed: HashMap<String, (String, String)>, // id -> (nama, path)
    running: Vec<RunningApp>,
    stubborn: HashSet<String>,
    open_fails: HashSet<String>,
    open_calls: Vec<String>,
    quit_calls: Vec<String>,
}

#[derive(Default)]
pub struct FakeAppController {
    state: Mutex<AppState>,
    log: EventLog,
}

impl FakeAppController {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_log(log: EventLog) -> Self {
        FakeAppController { state: Mutex::default(), log }
    }

    pub fn install(&self, bundle_id: &str, name: &str) {
        let path = format!("/Applications/{name}.app");
        self.state.lock().unwrap().installed.insert(bundle_id.into(), (name.into(), path));
    }

    pub fn uninstall(&self, bundle_id: &str) {
        self.state.lock().unwrap().installed.remove(bundle_id);
    }

    pub fn launch(&self, bundle_id: &str, name: &str, regular: bool) {
        self.state.lock().unwrap().running.push(RunningApp {
            bundle_id: bundle_id.into(),
            name: name.into(),
            regular,
        });
    }

    /// App ini menolak menutup diri (misalnya ada dialog "Save?" atau macet).
    pub fn make_stubborn(&self, bundle_id: &str) {
        self.state.lock().unwrap().stubborn.insert(bundle_id.into());
    }

    pub fn make_open_fail(&self, bundle_id: &str) {
        self.state.lock().unwrap().open_fails.insert(bundle_id.into());
    }

    pub fn open_calls(&self) -> Vec<String> {
        self.state.lock().unwrap().open_calls.clone()
    }

    pub fn quit_calls(&self) -> Vec<String> {
        self.state.lock().unwrap().quit_calls.clone()
    }
}

impl AppController for FakeAppController {
    fn running_apps(&self) -> Vec<RunningApp> {
        self.state.lock().unwrap().running.clone()
    }

    fn request_quit(&self, bundle_id: &str) {
        self.log.lock().unwrap().push(format!("quit {bundle_id}"));
        let mut s = self.state.lock().unwrap();
        s.quit_calls.push(bundle_id.into());
        if !s.stubborn.contains(bundle_id) {
            s.running.retain(|a| a.bundle_id != bundle_id);
        }
    }

    fn is_running(&self, bundle_id: &str) -> bool {
        self.state.lock().unwrap().running.iter().any(|a| a.bundle_id == bundle_id)
    }

    fn open(&self, bundle_id: &str) -> Result<(), String> {
        self.log.lock().unwrap().push(format!("open {bundle_id}"));
        let mut s = self.state.lock().unwrap();
        s.open_calls.push(bundle_id.into());
        if s.open_fails.contains(bundle_id) {
            return Err("gagal dibuka".into());
        }
        let Some((name, _)) = s.installed.get(bundle_id).cloned() else {
            return Err("tidak terpasang".into());
        };
        if !s.running.iter().any(|a| a.bundle_id == bundle_id) {
            s.running.push(RunningApp { bundle_id: bundle_id.into(), name, regular: true });
        }
        Ok(())
    }

    fn app_path(&self, bundle_id: &str) -> Option<String> {
        self.state.lock().unwrap().installed.get(bundle_id).map(|(_, p)| p.clone())
    }
}

#[derive(Default)]
struct DockState {
    current: Vec<u8>,
    writes: usize,
    restarts: usize,
    ignore_writes: bool,
    fail_read: bool,
}

#[derive(Default)]
pub struct FakeDockManager {
    state: Mutex<DockState>,
    log: EventLog,
}

impl FakeDockManager {
    pub fn new(initial: Vec<u8>) -> Self {
        FakeDockManager { state: Mutex::new(DockState { current: initial, ..Default::default() }), log: EventLog::default() }
    }

    pub fn with_log(initial: Vec<u8>, log: EventLog) -> Self {
        FakeDockManager { state: Mutex::new(DockState { current: initial, ..Default::default() }), log }
    }

    pub fn current(&self) -> Vec<u8> {
        self.state.lock().unwrap().current.clone()
    }

    pub fn writes(&self) -> usize {
        self.state.lock().unwrap().writes
    }

    pub fn restarts(&self) -> usize {
        self.state.lock().unwrap().restarts
    }

    /// Penulisan tidak berpengaruh, seperti saat sistem menimpa kembali isi dock.
    pub fn ignore_writes(&self) {
        self.state.lock().unwrap().ignore_writes = true;
    }

    pub fn fail_reads(&self) {
        self.state.lock().unwrap().fail_read = true;
    }
}

impl DockManager for FakeDockManager {
    fn read(&self) -> Result<Vec<u8>, String> {
        let s = self.state.lock().unwrap();
        if s.fail_read {
            return Err("tidak bisa dibaca".into());
        }
        Ok(s.current.clone())
    }

    fn write(&self, plist: &[u8]) -> Result<(), String> {
        self.log.lock().unwrap().push("write".into());
        let mut s = self.state.lock().unwrap();
        s.writes += 1;
        if !s.ignore_writes {
            s.current = plist.to_vec();
        }
        Ok(())
    }

    fn restart(&self) -> Result<(), String> {
        self.log.lock().unwrap().push("restart".into());
        self.state.lock().unwrap().restarts += 1;
        Ok(())
    }
}
