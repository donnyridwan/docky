//! Docky: panel mengambang di atas dock, ikon menu bar, dan jendela Pengaturan.

mod platform;
mod updater;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use docky_core::{
    Engine, EngineError, InstalledApp, LoadedPresets, Preset, Progress, RunSummary, Settings, Storage,
    UndoSummary,
};
use serde::Serialize;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use platform::{SystemApps, SystemDock};
use updater::{UpdateState, UpdateStatus};

const PANEL: &str = "panel";
const SETTINGS: &str = "settings";
const PANEL_WIDTH: f64 = 720.0;
/// Jarak panel dari tepi atas dock, dalam poin.
const PANEL_GAP: f64 = 10.0;

type SysEngine = Engine<SystemApps, SystemDock>;

struct AppState {
    engine: Arc<SysEngine>,
    icons: Mutex<HashMap<String, Option<String>>>,
    /// Panel sudah diseret pengguna: jangan pindahkan lagi ke atas dock
    /// sampai pengguna memilih "Kembalikan ke atas dock".
    panel_moved: AtomicBool,
}

/// Galat yang dikirim ke tampilan sebagai teks.
#[derive(Debug, Serialize)]
struct CmdError(String);

impl From<EngineError> for CmdError {
    fn from(e: EngineError) -> Self {
        CmdError(e.to_string())
    }
}
impl From<docky_core::store::StoreError> for CmdError {
    fn from(e: docky_core::store::StoreError) -> Self {
        CmdError(e.to_string())
    }
}
impl From<tauri::Error> for CmdError {
    fn from(e: tauri::Error) -> Self {
        CmdError(e.to_string())
    }
}

type CmdResult<T> = Result<T, CmdError>;

fn new_id() -> String {
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("p{nanos:x}")
}

fn icon_data_url(path: &str) -> Option<String> {
    // 128 px supaya tetap tajam di layar Retina saat tampil 52-60 pt.
    let png = platform::icon_png(path, 128)?;
    Some(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png)))
}

// ---- Perintah Tauri ----------------------------------------------------

/// Daftar app terpasang beserta ikonnya.
#[tauri::command]
async fn scan_apps(state: tauri::State<'_, AppState>) -> CmdResult<Vec<InstalledApp>> {
    let mut apps = tauri::async_runtime::spawn_blocking(docky_core::scanner::scan_installed)
        .await
        .map_err(|e| CmdError(e.to_string()))?;
    let mut cache = state.icons.lock().unwrap();
    for app in &mut apps {
        app.icon = cache.entry(app.path.clone()).or_insert_with(|| icon_data_url(&app.path)).clone();
    }
    Ok(apps)
}

#[tauri::command]
fn list_presets(state: tauri::State<'_, AppState>) -> CmdResult<LoadedPresets> {
    Ok(state.engine.storage.load_presets()?)
}

/// Simpan preset baru atau yang diedit. Mengembalikan daftar preset terbaru.
#[tauri::command]
fn save_preset(app: AppHandle, state: tauri::State<'_, AppState>, mut preset: Preset) -> CmdResult<Vec<Preset>> {
    let storage = &state.engine.storage;
    let mut presets = storage.load_presets()?.presets;
    if preset.id.is_empty() {
        preset.id = new_id();
    }
    preset.name = preset.name.trim().to_string();
    if preset.name.is_empty() {
        return Err(CmdError("Nama preset tidak boleh kosong.".into()));
    }
    preset.normalize();
    match presets.iter_mut().find(|p| p.id == preset.id) {
        Some(existing) => *existing = preset,
        None => presets.push(preset),
    }
    storage.save_presets(&presets)?;
    let _ = app.emit("presets-changed", &presets);
    Ok(presets)
}

#[tauri::command]
fn delete_preset(app: AppHandle, state: tauri::State<'_, AppState>, id: String) -> CmdResult<Vec<Preset>> {
    let storage = &state.engine.storage;
    let mut presets = storage.load_presets()?.presets;
    presets.retain(|p| p.id != id);
    storage.save_presets(&presets)?;
    let _ = app.emit("presets-changed", &presets);
    Ok(presets)
}

/// Preset baru dari kondisi sekarang (belum disimpan).
#[tauri::command]
async fn preset_from_current(state: tauri::State<'_, AppState>, name: String) -> CmdResult<Preset> {
    let engine = state.engine.clone();
    tauri::async_runtime::spawn_blocking(move || engine.preset_from_current(new_id(), name))
        .await
        .map_err(|e| CmdError(e.to_string()))
}

#[tauri::command]
fn get_settings(state: tauri::State<'_, AppState>) -> CmdResult<Settings> {
    Ok(state.engine.storage.load_settings()?)
}

#[tauri::command]
fn save_settings(app: AppHandle, state: tauri::State<'_, AppState>, settings: Settings) -> CmdResult<Settings> {
    let mut settings = settings;
    settings.quit_timeout_ms = settings.quit_timeout_ms.clamp(1_000, 30_000);
    settings.exclusions.sort();
    settings.exclusions.dedup();
    state.engine.storage.save_settings(&settings)?;
    let _ = app.emit("settings-changed", &settings);
    Ok(settings)
}

/// Jalankan preset. Progres dikirim lewat event `run-progress`, satu per langkah.
#[tauri::command]
async fn run_preset(app: AppHandle, state: tauri::State<'_, AppState>, id: String) -> CmdResult<RunSummary> {
    let engine = state.engine.clone();
    if engine.is_busy() {
        return Err(EngineError::Busy.into());
    }
    let preset = engine
        .storage
        .load_presets()?
        .presets
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| CmdError("Preset tidak ditemukan.".into()))?;
    let settings = engine.storage.load_settings()?;
    let emitter = app.clone();
    let summary = tauri::async_runtime::spawn_blocking(move || {
        engine.run_preset(&preset, &settings, &mut |p: Progress| {
            let _ = emitter.emit("run-progress", &p);
        })
    })
    .await
    .map_err(|e| CmdError(e.to_string()))??;
    Ok(summary)
}

#[tauri::command]
async fn undo_last(state: tauri::State<'_, AppState>) -> CmdResult<UndoSummary> {
    let engine = state.engine.clone();
    Ok(tauri::async_runtime::spawn_blocking(move || engine.undo_last())
        .await
        .map_err(|e| CmdError(e.to_string()))??)
}

#[tauri::command]
async fn restore_original_dock(state: tauri::State<'_, AppState>) -> CmdResult<()> {
    let engine = state.engine.clone();
    Ok(tauri::async_runtime::spawn_blocking(move || engine.restore_original_dock())
        .await
        .map_err(|e| CmdError(e.to_string()))??)
}

#[derive(Serialize)]
struct Status {
    busy: bool,
    can_undo: bool,
    version: String,
    has_backup: bool,
    data_dir: String,
}

#[tauri::command]
fn app_status(app: AppHandle, state: tauri::State<'_, AppState>) -> Status {
    let storage = &state.engine.storage;
    Status {
        busy: state.engine.is_busy(),
        can_undo: storage.load_snapshot().ok().flatten().is_some(),
        version: app.package_info().version.to_string(),
        has_backup: storage.has_dock_backup(),
        data_dir: storage.dir().display().to_string(),
    }
}

/// Atur tinggi panel sesuai isinya. Panel yang belum diseret diletakkan tepat
/// di atas dock; panel yang sudah diseret tetap di tempatnya dengan tepi bawah
/// yang sama, jadi tumbuh ke atas seperti panel di atas dock.
#[tauri::command]
fn resize_panel(app: AppHandle, state: tauri::State<'_, AppState>, height: f64) -> CmdResult<()> {
    let Some(win) = app.get_webview_window(PANEL) else { return Ok(()) };
    let height = height.clamp(60.0, 600.0);
    if state.panel_moved.load(Ordering::SeqCst) {
        let pos = win.outer_position()?;
        let old_h = win.outer_size()?.height as i32;
        let new_h = (height * win.scale_factor()?).round() as i32;
        win.set_size(LogicalSize::new(PANEL_WIDTH, height))?;
        win.set_position(PhysicalPosition::new(pos.x, pos.y + old_h - new_h))?;
    } else {
        win.set_size(LogicalSize::new(PANEL_WIDTH, height))?;
        position_panel(&win)?;
    }
    Ok(())
}

/// Mulai menyeret panel. Dipanggil saat tombol mouse ditekan di header.
#[tauri::command]
fn start_panel_drag(window: WebviewWindow, state: tauri::State<'_, AppState>) -> CmdResult<()> {
    state.panel_moved.store(true, Ordering::SeqCst);
    window.start_dragging()?;
    Ok(())
}

/// Kembalikan panel ke tempat asalnya, tepat di atas dock.
#[tauri::command]
fn reset_panel_position(app: AppHandle, state: tauri::State<'_, AppState>) -> CmdResult<()> {
    state.panel_moved.store(false, Ordering::SeqCst);
    if let Some(win) = app.get_webview_window(PANEL) {
        position_panel(&win)?;
    }
    Ok(())
}

#[tauri::command]
fn hide_panel(app: AppHandle) -> CmdResult<()> {
    if let Some(win) = app.get_webview_window(PANEL) {
        win.hide()?;
    }
    Ok(())
}

#[tauri::command]
fn open_settings(app: AppHandle) -> CmdResult<()> {
    show_settings(&app)?;
    Ok(())
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn update_status(state: tauri::State<'_, UpdateState>) -> UpdateStatus {
    state.status()
}

/// Cek update sekarang (dari tombol "Periksa update").
#[tauri::command]
async fn check_update(app: AppHandle) -> UpdateStatus {
    updater::check_and_download(&app, false).await
}

/// Pasang update yang sudah diunduh lalu buka ulang Docky.
#[tauri::command]
fn install_update(app: AppHandle, state: tauri::State<'_, AppState>) -> CmdResult<()> {
    if state.engine.is_busy() {
        return Err(CmdError("Tunggu sampai preset selesai berjalan.".into()));
    }
    updater::install_and_restart(&app).map_err(CmdError)
}

// ---- Jendela ----------------------------------------------------------

/// Letakkan panel di tengah bawah layar, tepat di atas dock. Area kerja
/// (`work_area`) sudah tidak termasuk dock dan menu bar.
fn position_panel(win: &WebviewWindow) -> tauri::Result<()> {
    let monitor = match win.current_monitor()? {
        Some(m) => m,
        None => match win.primary_monitor()? {
            Some(m) => m,
            None => return Ok(()),
        },
    };
    let area = monitor.work_area();
    let size = win.outer_size()?;
    let gap = (PANEL_GAP * monitor.scale_factor()).round() as i32;
    let x = area.position.x + (area.size.width as i32 - size.width as i32) / 2;
    let y = area.position.y + area.size.height as i32 - size.height as i32 - gap;
    win.set_position(PhysicalPosition::new(x, y))
}

fn show_panel(app: &AppHandle) {
    let Some(win) = app.get_webview_window(PANEL) else { return };
    let state = app.state::<AppState>();
    // Posisi hasil seretan dipertahankan, kecuali layarnya sudah tidak ada
    // (misalnya monitor kedua dicabut).
    if state.panel_moved.load(Ordering::SeqCst) && win.current_monitor().ok().flatten().is_none() {
        state.panel_moved.store(false, Ordering::SeqCst);
    }
    if !state.panel_moved.load(Ordering::SeqCst) {
        let _ = position_panel(&win);
    }
    let _ = win.show();
    let _ = win.set_focus();
    let _ = app.emit_to(PANEL, "panel-shown", ());
}

fn toggle_panel(app: &AppHandle) {
    let Some(win) = app.get_webview_window(PANEL) else { return };
    if win.is_visible().unwrap_or(false) {
        let _ = win.hide();
    } else {
        show_panel(app);
    }
}

fn show_settings(app: &AppHandle) -> tauri::Result<()> {
    if let Some(win) = app.get_webview_window(SETTINGS) {
        win.show()?;
        win.set_focus()?;
        return Ok(());
    }
    let win = WebviewWindowBuilder::new(app, SETTINGS, WebviewUrl::App("settings.html".into()))
        .title("Pengaturan Docky")
        .inner_size(760.0, 560.0)
        .min_inner_size(640.0, 460.0)
        .theme(Some(tauri::Theme::Dark))
        .center()
        .build()?;
    win.set_focus()?;
    Ok(())
}

fn data_dir(app: &AppHandle) -> PathBuf {
    // ~/Library/Application Support/Docky/
    app.path()
        .data_dir()
        .map(|d| d.join("Docky"))
        .unwrap_or_else(|_| std::env::temp_dir().join("Docky"))
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let settings = MenuItem::with_id(app, "settings", "Pengaturan…", true, None::<&str>)?;
    let original = MenuItem::with_id(app, "original", "Dock asli", true, None::<&str>)?;
    let update = MenuItem::with_id(app, "update", "Periksa update", true, None::<&str>)?;
    app.state::<UpdateState>().set_tray_item(update.clone());
    let quit = MenuItem::with_id(app, "quit", "Keluar Docky", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&settings, &original, &sep, &update, &sep2, &quit])?;

    TrayIconBuilder::with_id("docky")
        .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?)
        .icon_as_template(true)
        .tooltip("Docky")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "settings" => {
                let _ = show_settings(app);
            }
            "original" => {
                // Minta konfirmasi di panel sebelum memulihkan.
                let _ = app.emit_to(PANEL, "confirm-restore-original", ());
                show_panel(app);
            }
            "update" => {
                let busy = app.state::<AppState>().engine.is_busy();
                if app.state::<UpdateState>().is_ready() && !busy {
                    if let Err(e) = updater::install_and_restart(app) {
                        eprintln!("Docky: {e}");
                    }
                } else {
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        updater::check_and_download(&app, true).await;
                    });
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                toggle_panel(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .manage(UpdateState::default())
        .setup(|app| {
            // Tanpa ikon di dock: Docky hanya muncul di menu bar.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let handle = app.handle().clone();
            let dir = data_dir(&handle);
            let self_id = app.config().identifier.clone();
            let engine = Engine::new(SystemApps, SystemDock { work_dir: dir.clone() }, Storage::new(dir), self_id);
            // Cadangan dock asli disimpan sekali, saat Docky pertama dipakai.
            if let Err(e) = engine.ensure_dock_backup() {
                eprintln!("Docky: cadangan dock belum bisa dibuat: {e}");
            }
            app.manage(AppState {
                engine: Arc::new(engine),
                icons: Mutex::new(HashMap::new()),
                panel_moved: AtomicBool::new(false),
            });

            build_tray(&handle)?;
            // Docky hanya terhubung ke internet untuk mengecek update.
            updater::spawn_background_checks(handle.clone());

            // Tampilkan panel saat pertama kali dibuka, supaya pengguna tahu Docky ada di mana.
            if let Some(win) = app.get_webview_window(PANEL) {
                position_panel(&win)?;
                win.show()?;
                win.set_focus()?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan_apps,
            list_presets,
            save_preset,
            delete_preset,
            preset_from_current,
            get_settings,
            save_settings,
            run_preset,
            undo_last,
            restore_original_dock,
            app_status,
            resize_panel,
            start_panel_drag,
            reset_panel_position,
            hide_panel,
            open_settings,
            quit_app,
            update_status,
            check_update,
            install_update,
        ])
        .build(tauri::generate_context!())
        .expect("Docky gagal dijalankan")
        .run(|_app, _event| {
            // Docky dibuka lagi (dari Applications, Spotlight, atau Launchpad) saat
            // masih berjalan di menu bar: tampilkan panelnya, jangan diam saja.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                show_panel(_app);
            }
        });
}
