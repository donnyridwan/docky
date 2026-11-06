//! Pengolahan isi dock (domain preferensi `com.apple.dock`).
//!
//! Prinsipnya: kalau formatnya tidak dikenali, jangan ubah apa pun.
//! Hanya deretan app (`persistent-apps`) dan `show-recents` yang diubah;
//! folder di sisi kanan (`persistent-others`) dan semua kunci lain dibiarkan utuh.

use std::collections::HashMap;

use plist::{Dictionary, Value};
use thiserror::Error;

use crate::plan::DockApp;

pub const KEY_APPS: &str = "persistent-apps";
pub const KEY_OTHERS: &str = "persistent-others";
pub const KEY_SHOW_RECENTS: &str = "show-recents";

/// Jenis tile yang dikenali di deretan app.
const KNOWN_APP_TILE_TYPES: &[&str] = &[
    "file-tile",
    "spacer-tile",
    "small-spacer-tile",
    "flex-spacer-tile",
];

#[derive(Debug, Error, PartialEq, Eq)]
pub enum DockFormatError {
    #[error("format dock tidak dikenali: {0}")]
    Unrecognized(String),
    #[error("file dock tidak bisa dibaca: {0}")]
    Parse(String),
}

/// Data untuk membuat satu tile app di dock.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TileSpec {
    pub bundle_id: String,
    pub name: String,
    /// Lokasi .app, misalnya `/Applications/Figma.app`.
    pub path: String,
}

/// Baca domain dock dari byte plist (XML atau biner).
pub fn parse(bytes: &[u8]) -> Result<Value, DockFormatError> {
    Value::from_reader(std::io::Cursor::new(bytes)).map_err(|e| DockFormatError::Parse(e.to_string()))
}

/// Tulis domain dock sebagai plist XML.
pub fn to_xml(value: &Value) -> Vec<u8> {
    let mut out = Vec::new();
    value
        .to_writer_xml(&mut out)
        .expect("menulis plist ke memori tidak mungkin gagal");
    out
}

/// Pastikan format dock dikenali sebelum diubah.
pub fn validate(domain: &Value) -> Result<(), DockFormatError> {
    let dict = domain
        .as_dictionary()
        .ok_or_else(|| unrecognized("isi file bukan dictionary"))?;

    let apps = dict
        .get(KEY_APPS)
        .ok_or_else(|| unrecognized("tidak ada persistent-apps"))?
        .as_array()
        .ok_or_else(|| unrecognized("persistent-apps bukan array"))?;

    for (i, tile) in apps.iter().enumerate() {
        let tile = tile
            .as_dictionary()
            .ok_or_else(|| unrecognized(&format!("tile app #{i} bukan dictionary")))?;
        let tile_type = tile
            .get("tile-type")
            .and_then(Value::as_string)
            .ok_or_else(|| unrecognized(&format!("tile app #{i} tanpa tile-type")))?;
        if !KNOWN_APP_TILE_TYPES.contains(&tile_type) {
            return Err(unrecognized(&format!("jenis tile tidak dikenal: {tile_type}")));
        }
        if tile_type == "file-tile" {
            tile.get("tile-data")
                .and_then(Value::as_dictionary)
                .ok_or_else(|| unrecognized(&format!("tile app #{i} tanpa tile-data")))?;
        }
    }

    if let Some(others) = dict.get(KEY_OTHERS) {
        if others.as_array().is_none() {
            return Err(unrecognized("persistent-others bukan array"));
        }
    }
    if let Some(v) = dict.get(KEY_SHOW_RECENTS) {
        if v.as_boolean().is_none() {
            return Err(unrecognized("show-recents bukan boolean"));
        }
    }
    Ok(())
}

fn unrecognized(msg: &str) -> DockFormatError {
    DockFormatError::Unrecognized(msg.to_string())
}

fn tile_bundle_id(tile: &Value) -> Option<&str> {
    tile.as_dictionary()?
        .get("tile-data")?
        .as_dictionary()?
        .get("bundle-identifier")?
        .as_string()
}

fn tile_label(tile: &Value) -> Option<&str> {
    tile.as_dictionary()?
        .get("tile-data")?
        .as_dictionary()?
        .get("file-label")?
        .as_string()
}

fn apps_array(domain: &Value) -> &[Value] {
    domain
        .as_dictionary()
        .and_then(|d| d.get(KEY_APPS))
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

/// App di dock sekarang, urut dari kiri. Spacer dilewati.
pub fn dock_apps(domain: &Value) -> Vec<DockApp> {
    apps_array(domain)
        .iter()
        .filter_map(|tile| {
            let id = tile_bundle_id(tile)?;
            Some(DockApp {
                bundle_id: id.to_string(),
                name: tile_label(tile).unwrap_or(id).to_string(),
            })
        })
        .collect()
}

/// Bundle ID app di dock, urut dari kiri.
pub fn app_ids(domain: &Value) -> Vec<String> {
    dock_apps(domain).into_iter().map(|a| a.bundle_id).collect()
}

/// Deretan app sebagai nilai plist, untuk disimpan di potret.
pub fn apps_value(domain: &Value) -> Value {
    Value::Array(apps_array(domain).to_vec())
}

/// Nilai `show-recents` sekarang, kalau ada.
pub fn show_recents(domain: &Value) -> Option<bool> {
    domain
        .as_dictionary()
        .and_then(|d| d.get(KEY_SHOW_RECENTS))
        .and_then(Value::as_boolean)
}

/// Buat tile app baru, dengan bentuk yang sama seperti yang ditulis Dock sendiri.
pub fn make_tile(spec: &TileSpec) -> Value {
    let mut file_data = Dictionary::new();
    file_data.insert("_CFURLString".into(), Value::String(file_url(&spec.path)));
    file_data.insert("_CFURLStringType".into(), Value::Integer(15.into()));

    let mut tile_data = Dictionary::new();
    tile_data.insert("bundle-identifier".into(), Value::String(spec.bundle_id.clone()));
    tile_data.insert("file-data".into(), Value::Dictionary(file_data));
    tile_data.insert("file-label".into(), Value::String(spec.name.clone()));
    tile_data.insert("file-type".into(), Value::Integer(41.into()));

    let mut tile = Dictionary::new();
    tile.insert("tile-data".into(), Value::Dictionary(tile_data));
    tile.insert("tile-type".into(), Value::String("file-tile".into()));
    Value::Dictionary(tile)
}

/// Ganti deretan app sesuai preset dan urutannya, biarkan folder di kanan,
/// dan matikan "recent apps". Tile yang sudah ada dipakai ulang apa adanya.
pub fn apply_preset(domain: &Value, tiles: &[TileSpec]) -> Result<Value, DockFormatError> {
    validate(domain)?;

    let existing: HashMap<&str, &Value> = apps_array(domain)
        .iter()
        .filter_map(|t| tile_bundle_id(t).map(|id| (id, t)))
        .collect();

    let new_apps: Vec<Value> = tiles
        .iter()
        .map(|spec| match existing.get(spec.bundle_id.as_str()) {
            Some(tile) => (*tile).clone(),
            None => make_tile(spec),
        })
        .collect();

    let mut dict = domain.as_dictionary().cloned().expect("sudah divalidasi");
    dict.insert(KEY_APPS.into(), Value::Array(new_apps));
    dict.insert(KEY_SHOW_RECENTS.into(), Value::Boolean(false));
    Ok(Value::Dictionary(dict))
}

/// Pulihkan deretan app dan `show-recents` dari potret / cadangan,
/// tanpa menyentuh kunci lain (ukuran dock, posisi, folder).
pub fn restore_apps(
    domain: &Value,
    saved_apps: &Value,
    saved_show_recents: Option<bool>,
) -> Result<Value, DockFormatError> {
    validate(domain)?;
    // Data yang dipulihkan juga harus berformat benar.
    let mut probe = Dictionary::new();
    probe.insert(KEY_APPS.into(), saved_apps.clone());
    validate(&Value::Dictionary(probe))?;

    let mut dict = domain.as_dictionary().cloned().expect("sudah divalidasi");
    dict.insert(KEY_APPS.into(), saved_apps.clone());
    match saved_show_recents {
        Some(v) => {
            dict.insert(KEY_SHOW_RECENTS.into(), Value::Boolean(v));
        }
        None => {
            dict.remove(KEY_SHOW_RECENTS);
        }
    }
    Ok(Value::Dictionary(dict))
}

/// `/Applications/Visual Studio Code.app` → `file:///Applications/Visual%20Studio%20Code.app/`
pub fn file_url(path: &str) -> String {
    let mut out = String::from("file://");
    for b in path.trim_end_matches('/').bytes() {
        let keep = b.is_ascii_alphanumeric() || matches!(b, b'/' | b'-' | b'_' | b'.' | b'~');
        if keep {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out.push('/');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> Value {
        let path = format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
        parse(&std::fs::read(path).unwrap()).unwrap()
    }

    const FIXTURES: &[&str] = &["dock-macos13.plist", "dock-macos14.plist", "dock-macos15.plist"];

    fn spec(id: &str, name: &str, path: &str) -> TileSpec {
        TileSpec { bundle_id: id.into(), name: name.into(), path: path.into() }
    }

    #[test]
    fn all_fixtures_are_recognized() {
        for f in FIXTURES {
            validate(&fixture(f)).unwrap_or_else(|e| panic!("{f}: {e}"));
            assert!(!dock_apps(&fixture(f)).is_empty(), "{f}");
        }
    }

    #[test]
    fn apply_preset_keeps_folders_and_other_keys() {
        let tiles = vec![
            spec("com.anthropic.claudefordesktop", "Claude", "/Applications/Claude.app"),
            spec("com.apple.Safari", "Safari", "/Applications/Safari.app"),
        ];
        for f in FIXTURES {
            let before = fixture(f);
            let after = apply_preset(&before, &tiles).unwrap();
            let (b, a) = (before.as_dictionary().unwrap(), after.as_dictionary().unwrap());

            assert_eq!(b.get(KEY_OTHERS), a.get(KEY_OTHERS), "{f}: folder kanan berubah");
            for (k, v) in b.iter() {
                if k != KEY_APPS && k != KEY_SHOW_RECENTS {
                    assert_eq!(a.get(k), Some(v), "{f}: kunci {k} berubah");
                }
            }
            assert_eq!(
                app_ids(&after),
                vec!["com.anthropic.claudefordesktop", "com.apple.Safari"],
                "{f}"
            );
            assert_eq!(show_recents(&after), Some(false), "{f}");
            validate(&after).unwrap();
        }
    }

    #[test]
    fn existing_tiles_are_reused_unchanged() {
        let before = fixture("dock-macos14.plist");
        let safari_before = apps_array(&before)
            .iter()
            .find(|t| tile_bundle_id(t) == Some("com.apple.Safari"))
            .cloned()
            .unwrap();
        let after = apply_preset(&before, &[spec("com.apple.Safari", "Safari", "/x")]).unwrap();
        assert_eq!(apps_array(&after)[0], safari_before);
    }

    #[test]
    fn new_tile_has_expected_shape() {
        let t = make_tile(&spec("com.microsoft.VSCode", "Visual Studio Code", "/Applications/Visual Studio Code.app"));
        let d = t.as_dictionary().unwrap();
        assert_eq!(d.get("tile-type").unwrap().as_string(), Some("file-tile"));
        let td = d.get("tile-data").unwrap().as_dictionary().unwrap();
        let url = td.get("file-data").unwrap().as_dictionary().unwrap().get("_CFURLString").unwrap();
        assert_eq!(url.as_string(), Some("file:///Applications/Visual%20Studio%20Code.app/"));
        assert_eq!(td.get("bundle-identifier").unwrap().as_string(), Some("com.microsoft.VSCode"));
    }

    #[test]
    fn unrecognized_format_is_rejected() {
        let bad = fixture("dock-unknown.plist");
        assert!(matches!(validate(&bad), Err(DockFormatError::Unrecognized(_))));
        assert!(apply_preset(&bad, &[]).is_err());
        assert!(parse(b"bukan plist").is_err());
    }

    #[test]
    fn unknown_tile_type_is_rejected() {
        let mut d = fixture("dock-macos15.plist").into_dictionary().unwrap();
        let apps = d.get_mut(KEY_APPS).unwrap().as_array_mut().unwrap();
        let mut t = Dictionary::new();
        t.insert("tile-type".into(), Value::String("hologram-tile".into()));
        apps.push(Value::Dictionary(t));
        assert!(validate(&Value::Dictionary(d)).is_err());
    }

    #[test]
    fn restore_apps_round_trips() {
        for f in FIXTURES {
            let original = fixture(f);
            let saved = apps_value(&original);
            let saved_recents = show_recents(&original);
            let changed = apply_preset(&original, &[spec("a.b", "A", "/Applications/A.app")]).unwrap();
            let restored = restore_apps(&changed, &saved, saved_recents).unwrap();
            assert_eq!(restored, original, "{f}");
        }
    }

    #[test]
    fn binary_and_xml_round_trip() {
        let v = fixture("dock-macos15.plist");
        let mut bin = Vec::new();
        v.to_writer_binary(&mut bin).unwrap();
        assert_eq!(parse(&bin).unwrap(), v);
        assert_eq!(parse(&to_xml(&v)).unwrap(), v);
    }
}
