//! Keputusan murni: app mana yang ditutup, mana yang dibuka, dan preset dari kondisi sekarang.
//! Tidak menyentuh sistem sama sekali, jadi mudah dites.

use std::collections::HashSet;

use crate::model::{Preset, PresetApp, PresetMode, RunningApp, FINDER_BUNDLE_ID};

/// App yang perlu diminta tutup.
///
/// Yang dilewati: app di preset, daftar pengecualian, Finder, Docky sendiri,
/// dan app latar belakang / menu bar (`regular == false`).
pub fn apps_to_close<'a>(
    running: &'a [RunningApp],
    preset: &Preset,
    exclusions: &[String],
    self_bundle_id: &str,
) -> Vec<&'a RunningApp> {
    let keep: HashSet<&str> = preset
        .apps
        .iter()
        .map(|a| a.bundle_id.as_str())
        .chain(exclusions.iter().map(String::as_str))
        .chain([FINDER_BUNDLE_ID, self_bundle_id])
        .collect();

    let mut seen = HashSet::new();
    running
        .iter()
        .filter(|app| app.regular)
        .filter(|app| !app.bundle_id.is_empty())
        .filter(|app| !keep.contains(app.bundle_id.as_str()))
        .filter(|app| seen.insert(app.bundle_id.as_str()))
        .collect()
}

/// App "buka otomatis" yang belum berjalan, sesuai urutan dock.
/// App yang sudah terbuka tidak dibuka ulang.
pub fn apps_to_open<'a>(preset: &'a Preset, running: &[RunningApp]) -> Vec<&'a PresetApp> {
    let running: HashSet<&str> = running.iter().map(|a| a.bundle_id.as_str()).collect();
    preset
        .sorted_apps()
        .into_iter()
        .filter(|a| a.auto_open)
        .filter(|a| !running.contains(a.bundle_id.as_str()))
        .collect()
}

/// Satu app di dock saat ini (urut dari kiri).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DockApp {
    pub bundle_id: String,
    pub name: String,
}

/// Membuat preset dari kondisi sekarang: app yang sedang terbuka ditandai
/// "buka otomatis", app yang hanya ada di dock ditandai tidak.
///
/// Urutan: app di dock sesuai urutan dock, lalu app terbuka yang belum ada di dock.
pub fn preset_from_current(
    id: String,
    name: String,
    dock_apps: &[DockApp],
    running: &[RunningApp],
    self_bundle_id: &str,
) -> Preset {
    let running_ids: HashSet<&str> = running
        .iter()
        .filter(|a| a.regular)
        .map(|a| a.bundle_id.as_str())
        .collect();

    let mut apps = Vec::new();
    let mut seen = HashSet::new();
    let skip = |id: &str| id.is_empty() || id == FINDER_BUNDLE_ID || id == self_bundle_id;

    for d in dock_apps {
        if skip(&d.bundle_id) || !seen.insert(d.bundle_id.clone()) {
            continue;
        }
        apps.push(PresetApp {
            bundle_id: d.bundle_id.clone(),
            name: d.name.clone(),
            order: 0,
            auto_open: running_ids.contains(d.bundle_id.as_str()),
        });
    }
    for r in running.iter().filter(|a| a.regular) {
        if skip(&r.bundle_id) || !seen.insert(r.bundle_id.clone()) {
            continue;
        }
        apps.push(PresetApp {
            bundle_id: r.bundle_id.clone(),
            name: r.name.clone(),
            order: 0,
            auto_open: true,
        });
    }

    let mut preset = Preset { id, name, mode: PresetMode::Clean, apps };
    for (i, a) in preset.apps.iter_mut().enumerate() {
        a.order = i as u32 + 1;
    }
    preset
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(id: &str, regular: bool) -> RunningApp {
        RunningApp { bundle_id: id.into(), name: id.into(), regular }
    }

    fn app(id: &str, order: u32, auto_open: bool) -> PresetApp {
        PresetApp { bundle_id: id.into(), name: id.into(), order, auto_open }
    }

    /// Contoh preset Kerja dari spesifikasi.
    fn kerja() -> Preset {
        Preset {
            id: "kerja".into(),
            name: "Kerja".into(),
            mode: PresetMode::Clean,
            apps: vec![
                app("com.anthropic.claudefordesktop", 1, true),
                app("com.figma.Desktop", 2, true),
                app("com.tinyspeck.slackmacgap", 3, true),
                app("notion.id", 4, false),
            ],
        }
    }

    #[test]
    fn closes_only_apps_outside_preset() {
        let running = vec![
            run("com.figma.Desktop", true),
            run("notion.id", true),       // di preset tanpa buka otomatis: dibiarkan
            run("com.spotify.client", true),
            run("com.apple.Safari", true),
        ];
        let ids: Vec<_> = apps_to_close(&running, &kerja(), &[], "id.docky")
            .iter()
            .map(|a| a.bundle_id.as_str())
            .collect();
        assert_eq!(ids, vec!["com.spotify.client", "com.apple.Safari"]);
    }

    #[test]
    fn never_closes_finder_self_background_or_excluded() {
        let running = vec![
            run(FINDER_BUNDLE_ID, true),
            run("id.docky", true),
            run("com.example.menubar", false),
            run("com.1password.1password", true),
            run("com.apple.Music", true),
        ];
        let excl = vec!["com.1password.1password".to_string()];
        let ids: Vec<_> = apps_to_close(&running, &kerja(), &excl, "id.docky")
            .iter()
            .map(|a| a.bundle_id.as_str())
            .collect();
        assert_eq!(ids, vec!["com.apple.Music"]);
    }

    #[test]
    fn duplicate_running_instances_are_listed_once() {
        let running = vec![run("com.apple.Music", true), run("com.apple.Music", true)];
        assert_eq!(apps_to_close(&running, &kerja(), &[], "x").len(), 1);
    }

    #[test]
    fn opens_auto_open_apps_not_yet_running_in_dock_order() {
        let running = vec![run("com.figma.Desktop", true)];
        let preset = kerja();
        let ids: Vec<_> = apps_to_open(&preset, &running)
            .iter()
            .map(|a| a.bundle_id.as_str())
            .collect();
        // Figma sudah berjalan, Notion bukan buka otomatis.
        assert_eq!(ids, vec!["com.anthropic.claudefordesktop", "com.tinyspeck.slackmacgap"]);
    }

    #[test]
    fn preset_from_current_marks_running_apps_auto_open() {
        let dock = vec![
            DockApp { bundle_id: "com.apple.Safari".into(), name: "Safari".into() },
            DockApp { bundle_id: "notion.id".into(), name: "Notion".into() },
        ];
        let running = vec![
            run("com.apple.Safari", true),
            run("com.figma.Desktop", true),
            run(FINDER_BUNDLE_ID, true),
            run("com.example.menubar", false),
        ];
        let p = preset_from_current("p".into(), "Baru".into(), &dock, &running, "id.docky");
        let got: Vec<_> = p.apps.iter().map(|a| (a.bundle_id.as_str(), a.order, a.auto_open)).collect();
        assert_eq!(
            got,
            vec![
                ("com.apple.Safari", 1, true),
                ("notion.id", 2, false),
                ("com.figma.Desktop", 3, true),
            ]
        );
    }
}
