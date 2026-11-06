//! Implementasi sistem. Docky hanya berjalan di macOS; di OS lain disediakan
//! versi kosong supaya kode tetap bisa dikompilasi untuk pengembangan tampilan.

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::{icon_png, MacApps as SystemApps, MacDock as SystemDock};

#[cfg(not(target_os = "macos"))]
mod unsupported {
    use docky_core::{AppController, DockManager, RunningApp};

    const MSG: &str = "Docky hanya berjalan di macOS.";

    pub struct SystemApps;
    impl AppController for SystemApps {
        fn running_apps(&self) -> Vec<RunningApp> {
            Vec::new()
        }
        fn request_quit(&self, _: &str) {}
        fn is_running(&self, _: &str) -> bool {
            false
        }
        fn open(&self, _: &str) -> Result<(), String> {
            Err(MSG.into())
        }
        fn app_path(&self, _: &str) -> Option<String> {
            None
        }
    }

    pub struct SystemDock {
        pub work_dir: std::path::PathBuf,
    }
    impl DockManager for SystemDock {
        fn read(&self) -> Result<Vec<u8>, String> {
            Err(MSG.into())
        }
        fn write(&self, _: &[u8]) -> Result<(), String> {
            Err(MSG.into())
        }
        fn restart(&self) -> Result<(), String> {
            Err(MSG.into())
        }
    }

    pub fn icon_png(_: &str, _: isize) -> Option<Vec<u8>> {
        None
    }
}
#[cfg(not(target_os = "macos"))]
pub use unsupported::*;
