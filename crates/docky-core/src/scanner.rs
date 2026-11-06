//! AppScanner: cari app yang terpasang dengan membaca Info.plist di folder app standar.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::model::InstalledApp;

/// Folder yang dipindai, beserta kedalaman maksimum (1 = langsung di folder itu).
fn roots() -> Vec<(PathBuf, usize)> {
    let mut roots = vec![
        (PathBuf::from("/Applications"), 2),
        (PathBuf::from("/System/Applications"), 2),
        (PathBuf::from("/System/Library/CoreServices/Finder.app"), 0),
    ];
    if let Some(home) = std::env::var_os("HOME") {
        roots.push((Path::new(&home).join("Applications"), 2));
    }
    roots
}

/// Baca bundle ID dan nama dari `<app>/Contents/Info.plist`.
pub fn read_bundle(app: &Path) -> Option<InstalledApp> {
    let info = plist::Value::from_file(app.join("Contents/Info.plist")).ok()?;
    let dict = info.as_dictionary()?;
    let bundle_id = dict.get("CFBundleIdentifier")?.as_string()?.to_string();
    let fallback = app.file_stem()?.to_string_lossy().to_string();
    // Dock dan Finder menampilkan nama file .app; CFBundleName kadang disingkat
    // (misalnya "Code" untuk Visual Studio Code), jadi hanya CFBundleDisplayName yang dipakai.
    let name = dict
        .get("CFBundleDisplayName")
        .and_then(|v| v.as_string())
        .filter(|s| !s.trim().is_empty())
        .map(str::to_string)
        .unwrap_or(fallback);
    Some(InstalledApp { bundle_id, name, path: app.to_string_lossy().to_string(), icon: None })
}

fn walk(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if dir.extension().is_some_and(|e| e == "app") {
        out.push(dir.to_path_buf());
        return;
    }
    if depth == 0 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            walk(&path, depth - 1, out);
        }
    }
}

/// Semua app terpasang, unik per bundle ID, urut berdasarkan nama.
pub fn scan_installed() -> Vec<InstalledApp> {
    let mut paths = Vec::new();
    for (root, depth) in roots() {
        walk(&root, depth, &mut paths);
    }
    let mut by_id: HashMap<String, InstalledApp> = HashMap::new();
    for path in paths {
        if let Some(app) = read_bundle(&path) {
            by_id.entry(app.bundle_id.clone()).or_insert(app);
        }
    }
    let mut apps: Vec<InstalledApp> = by_id.into_values().collect();
    apps.sort_by_key(|a| a.name.to_lowercase());
    apps
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_bundle_from_info_plist() {
        let dir = tempfile::tempdir().unwrap();
        let app = dir.path().join("Utilities/Visual Studio Code.app");
        std::fs::create_dir_all(app.join("Contents")).unwrap();
        let mut d = plist::Dictionary::new();
        d.insert("CFBundleIdentifier".into(), "com.microsoft.VSCode".into());
        d.insert("CFBundleName".into(), "Code".into());
        plist::Value::Dictionary(d).to_file_xml(app.join("Contents/Info.plist")).unwrap();
        // Folder .app tanpa Info.plist dilewati.
        std::fs::create_dir_all(dir.path().join("Rusak.app")).unwrap();

        let mut found = Vec::new();
        walk(dir.path(), 2, &mut found);
        found.sort();
        assert_eq!(found.len(), 2);
        let apps: Vec<_> = found.iter().filter_map(|p| read_bundle(p)).collect();
        assert_eq!(apps.len(), 1);
        assert_eq!(apps[0].bundle_id, "com.microsoft.VSCode");
        assert_eq!(apps[0].name, "Visual Studio Code");
    }

    #[test]
    fn display_name_wins_over_file_name() {
        let dir = tempfile::tempdir().unwrap();
        let app = dir.path().join("zoom.us.app");
        std::fs::create_dir_all(app.join("Contents")).unwrap();
        let mut d = plist::Dictionary::new();
        d.insert("CFBundleIdentifier".into(), "us.zoom.xos".into());
        d.insert("CFBundleDisplayName".into(), "Zoom".into());
        plist::Value::Dictionary(d).to_file_xml(app.join("Contents/Info.plist")).unwrap();
        assert_eq!(read_bundle(&app).unwrap().name, "Zoom");
    }
}
