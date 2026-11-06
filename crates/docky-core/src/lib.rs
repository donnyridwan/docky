//! Inti Docky: semua logika yang bisa diuji tanpa menyentuh Mac.
//!
//! - [`plan`]: app mana yang ditutup dan dibuka.
//! - [`scanner`]: AppScanner, daftar app terpasang dari Info.plist.
//! - [`dock`]: mengolah isi dock (`com.apple.dock`).
//! - [`store`]: PresetStore, SnapshotManager, dan cadangan dock di Application Support.
//! - [`engine`]: alur lima langkah menjalankan preset, Kembalikan, dan Dock asli.
//! - [`fakes`]: AppController dan DockManager palsu untuk tes.

pub mod dock;
pub mod engine;
pub mod fakes;
pub mod model;
pub mod plan;
pub mod scanner;
pub mod store;

pub use engine::{AppController, DockManager, Engine, EngineError};
pub use model::*;
pub use store::{LoadedPresets, Snapshot, Storage};
