// Mencegah jendela konsol tambahan di Windows saat rilis. Tidak berpengaruh di macOS.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    docky_lib::run()
}
