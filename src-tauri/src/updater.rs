//! Update otomatis lewat plugin updater Tauri.
//!
//! Docky mengecek `latest.json` di GitHub Releases saat dibuka dan setiap 6 jam.
//! Kalau ada versi baru, update diunduh di latar belakang dan tanda tangannya
//! diperiksa. Setelah siap, muncul notifikasi macOS, tombol "Restart untuk update"
//! di panel, dan item di menu ikon menu bar. Update baru dipasang saat pengguna
//! menekan tombol itu, supaya tidak memotong preset yang sedang berjalan.

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::menu::MenuItem;
use tauri::{AppHandle, Emitter, Manager, Wry};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::{Update, UpdaterExt};

const FIRST_CHECK_AFTER: Duration = Duration::from_secs(15);
const CHECK_EVERY: Duration = Duration::from_secs(6 * 60 * 60);

#[derive(Debug, Clone, Default, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum UpdateStatus {
    #[default]
    Idle,
    Checking,
    UpToDate,
    Downloading {
        version: String,
        percent: Option<u8>,
    },
    Ready {
        version: String,
        notes: Option<String>,
    },
    Error {
        message: String,
    },
}

#[derive(Default)]
pub struct UpdateState {
    status: Mutex<UpdateStatus>,
    /// Update yang sudah diunduh dan siap dipasang.
    pending: Mutex<Option<(Update, Vec<u8>)>>,
    /// Item di menu ikon menu bar, diubah teksnya saat update siap.
    tray_item: Mutex<Option<MenuItem<Wry>>>,
}

impl UpdateState {
    pub fn status(&self) -> UpdateStatus {
        self.status.lock().unwrap().clone()
    }

    pub fn set_tray_item(&self, item: MenuItem<Wry>) {
        *self.tray_item.lock().unwrap() = Some(item);
    }

    pub fn is_ready(&self) -> bool {
        self.pending.lock().unwrap().is_some()
    }
}

fn set_status(app: &AppHandle, status: UpdateStatus) {
    let state = app.state::<UpdateState>();
    *state.status.lock().unwrap() = status.clone();
    let _ = app.emit("update-status", &status);
}

/// Cek update, lalu unduh kalau ada. `notify` mengirim notifikasi macOS saat update siap.
pub async fn check_and_download(app: &AppHandle, notify: bool) -> UpdateStatus {
    let state = app.state::<UpdateState>();
    // Jangan cek dua kali bersamaan, dan jangan unduh ulang update yang sudah siap.
    if let s @ (UpdateStatus::Ready { .. } | UpdateStatus::Downloading { .. } | UpdateStatus::Checking) = state.status() {
        return s;
    }
    set_status(app, UpdateStatus::Checking);

    let result = async {
        let update = match app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())? {
            Some(u) => u,
            None => return Ok(UpdateStatus::UpToDate),
        };
        let version = update.version.clone();
        set_status(app, UpdateStatus::Downloading { version: version.clone(), percent: None });

        let mut received: u64 = 0;
        let mut last_percent: Option<u8> = None;
        let bytes = update
            .download(
                |chunk, total| {
                    received += chunk as u64;
                    let percent = total.filter(|t| *t > 0).map(|t| ((received * 100) / t).min(100) as u8);
                    if percent != last_percent {
                        last_percent = percent;
                        let _ = app.emit("update-status", UpdateStatus::Downloading { version: version.clone(), percent });
                    }
                },
                || {},
            )
            .await
            .map_err(|e| e.to_string())?;

        let notes = update.body.clone().filter(|b| !b.trim().is_empty());
        *state.pending.lock().unwrap() = Some((update, bytes));
        Ok::<_, String>(UpdateStatus::Ready { version, notes })
    }
    .await;

    let status = result.unwrap_or_else(|message| UpdateStatus::Error { message });
    set_status(app, status.clone());

    if let UpdateStatus::Ready { version, .. } = &status {
        if let Some(item) = state.tray_item.lock().unwrap().as_ref() {
            let _ = item.set_text(format!("Restart untuk update ke {version}"));
        }
        if notify {
            let _ = app
                .notification()
                .builder()
                .title("Update Docky siap")
                .body(format!(
                    "Docky {version} sudah diunduh. Buka Docky dari menu bar lalu klik Restart untuk update."
                ))
                .show();
        }
    }
    status
}

/// Pasang update yang sudah diunduh, lalu buka ulang Docky.
pub fn install_and_restart(app: &AppHandle) -> Result<(), String> {
    let pending = app.state::<UpdateState>().pending.lock().unwrap().take();
    let Some((update, bytes)) = pending else {
        return Err("Belum ada update yang siap dipasang.".into());
    };
    if let Err(e) = update.install(&bytes) {
        // Simpan lagi supaya bisa dicoba ulang.
        *app.state::<UpdateState>().pending.lock().unwrap() = Some((update, bytes));
        return Err(format!("Update gagal dipasang: {e}"));
    }
    app.restart();
}

/// Cek update di latar belakang: sebentar setelah dibuka, lalu setiap 6 jam.
pub fn spawn_background_checks(app: AppHandle) {
    std::thread::Builder::new()
        .name("docky-updater".into())
        .spawn(move || {
            std::thread::sleep(FIRST_CHECK_AFTER);
            loop {
                let status = tauri::async_runtime::block_on(check_and_download(&app, true));
                if matches!(status, UpdateStatus::Ready { .. }) {
                    // Sudah siap; tidak perlu cek lagi sampai Docky dibuka ulang.
                    break;
                }
                std::thread::sleep(CHECK_EVERY);
            }
        })
        .expect("thread updater");
}
