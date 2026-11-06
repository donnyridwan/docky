//! Bagian yang menyentuh macOS: AppController (NSRunningApplication),
//! DockManager (domain com.apple.dock + restart Dock), dan ikon app (NSWorkspace).
#![allow(unused_unsafe)]

use std::path::PathBuf;
use std::process::Command;
use std::time::{Duration, Instant};

use docky_core::{AppController, DockManager, RunningApp};
use objc2::rc::autoreleasepool;
use objc2::AllocAnyThread;
use objc2_app_kit::{
    NSApplicationActivationPolicy, NSBitmapImageFileType, NSBitmapImageRep, NSCompositingOperation,
    NSDeviceRGBColorSpace, NSGraphicsContext, NSRunningApplication, NSWorkspace,
};
use objc2_foundation::{NSDictionary, NSPoint, NSRect, NSSize, NSString};

const DOCK_BUNDLE_ID: &str = "com.apple.dock";

fn apps_with_id(bundle_id: &str) -> Vec<objc2::rc::Retained<NSRunningApplication>> {
    unsafe {
        NSRunningApplication::runningApplicationsWithBundleIdentifier(&NSString::from_str(bundle_id))
            .iter()
            .filter(|a| !a.isTerminated())
            .collect()
    }
}

pub struct MacApps;

impl AppController for MacApps {
    fn running_apps(&self) -> Vec<RunningApp> {
        autoreleasepool(|_| unsafe {
            NSWorkspace::sharedWorkspace()
                .runningApplications()
                .iter()
                .filter(|a| !a.isTerminated())
                .filter_map(|a| {
                    let bundle_id = a.bundleIdentifier()?.to_string();
                    let name = a.localizedName().map(|n| n.to_string()).unwrap_or_else(|| bundle_id.clone());
                    let regular = a.activationPolicy() == NSApplicationActivationPolicy::Regular;
                    Some(RunningApp { bundle_id, name, regular })
                })
                .collect()
        })
    }

    fn request_quit(&self, bundle_id: &str) {
        // terminate() sama dengan ⌘Q: app boleh menunda atau menolak (dialog "Save?").
        // Docky tidak pernah memanggil forceTerminate().
        autoreleasepool(|_| {
            for app in apps_with_id(bundle_id) {
                unsafe {
                    app.terminate();
                }
            }
        })
    }

    fn is_running(&self, bundle_id: &str) -> bool {
        autoreleasepool(|_| !apps_with_id(bundle_id).is_empty())
    }

    fn open(&self, bundle_id: &str) -> Result<(), String> {
        let out = Command::new("/usr/bin/open")
            .args(["-b", bundle_id])
            .output()
            .map_err(|e| e.to_string())?;
        if out.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
        }
    }

    fn app_path(&self, bundle_id: &str) -> Option<String> {
        autoreleasepool(|_| unsafe {
            let url = NSWorkspace::sharedWorkspace()
                .URLForApplicationWithBundleIdentifier(&NSString::from_str(bundle_id))?;
            url.path().map(|p| p.to_string())
        })
    }
}

/// Membaca dan menulis domain com.apple.dock lewat `defaults`, supaya perubahan
/// melewati cfprefsd dan tidak ditimpa cache preferensi. Isinya sama dengan
/// ~/Library/Preferences/com.apple.dock.plist.
pub struct MacDock {
    /// Folder untuk file sementara saat impor.
    pub work_dir: PathBuf,
}

impl MacDock {
    fn dock_pids() -> Vec<i32> {
        autoreleasepool(|_| {
            apps_with_id(DOCK_BUNDLE_ID)
                .iter()
                .map(|a| unsafe { a.processIdentifier() })
                .collect()
        })
    }
}

impl DockManager for MacDock {
    fn read(&self) -> Result<Vec<u8>, String> {
        let out = Command::new("/usr/bin/defaults")
            .args(["export", DOCK_BUNDLE_ID, "-"])
            .output()
            .map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        Ok(out.stdout)
    }

    fn write(&self, plist: &[u8]) -> Result<(), String> {
        std::fs::create_dir_all(&self.work_dir).map_err(|e| e.to_string())?;
        let tmp = self.work_dir.join(format!(".dock-import-{}.plist", std::process::id()));
        std::fs::write(&tmp, plist).map_err(|e| e.to_string())?;
        let out = Command::new("/usr/bin/defaults")
            .arg("import")
            .arg(DOCK_BUNDLE_ID)
            .arg(&tmp)
            .output();
        let _ = std::fs::remove_file(&tmp);
        let out = out.map_err(|e| e.to_string())?;
        if out.status.success() {
            Ok(())
        } else {
            Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
        }
    }

    fn restart(&self) -> Result<(), String> {
        let before = Self::dock_pids();
        let status = Command::new("/usr/bin/killall")
            .arg("Dock")
            .status()
            .map_err(|e| e.to_string())?;
        if !status.success() {
            return Err("Dock tidak bisa di-restart".into());
        }
        // launchd menyalakan Dock lagi; tunggu sampai proses baru muncul.
        let deadline = Instant::now() + Duration::from_secs(5);
        while Instant::now() < deadline {
            let now = Self::dock_pids();
            if !now.is_empty() && now.iter().all(|p| !before.contains(p)) {
                // Beri Dock waktu sebentar untuk memuat isinya.
                std::thread::sleep(Duration::from_millis(400));
                return Ok(());
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        Err("Dock belum kembali setelah 5 detik".into())
    }
}

/// Ikon app sebagai PNG berukuran `px` × `px`.
pub fn icon_png(path: &str, px: isize) -> Option<Vec<u8>> {
    autoreleasepool(|_| unsafe {
        let image = NSWorkspace::sharedWorkspace().iconForFile(&NSString::from_str(path));
        let rep = NSBitmapImageRep::initWithBitmapDataPlanes_pixelsWide_pixelsHigh_bitsPerSample_samplesPerPixel_hasAlpha_isPlanar_colorSpaceName_bytesPerRow_bitsPerPixel(
            NSBitmapImageRep::alloc(),
            std::ptr::null_mut(),
            px,
            px,
            8,
            4,
            true,
            false,
            NSDeviceRGBColorSpace,
            0,
            0,
        )?;
        let ctx = NSGraphicsContext::graphicsContextWithBitmapImageRep(&rep)?;
        NSGraphicsContext::saveGraphicsState_class();
        NSGraphicsContext::setCurrentContext(Some(&ctx));
        let size = NSSize::new(px as f64, px as f64);
        image.drawInRect_fromRect_operation_fraction(
            NSRect::new(NSPoint::new(0.0, 0.0), size),
            NSRect::ZERO,
            NSCompositingOperation::Copy,
            1.0,
        );
        ctx.flushGraphics();
        NSGraphicsContext::restoreGraphicsState_class();
        let data = rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())?;
        Some(data.to_vec())
    })
}
