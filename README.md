# Docky

Docky adalah app macOS berupa panel mengambang yang merapikan Mac dengan satu klik: jalankan preset, app di luar preset ditutup, app preset dibuka, dan isi dock diganti.

Gratis dan open source (MIT), dibagikan di luar Mac App Store karena App Store tidak mengizinkan app mengubah dock. Dibangun dengan [Tauri 2](https://v2.tauri.app): tampilan React + TypeScript, logika sistem Rust.

> Status: **beta 0.x**. Butuh macOS 13 Ventura atau lebih baru.

## Cara kerja

Docky berjalan tanpa ikon di dock. Klik ikon Docky di menu bar untuk membuka panel tepat di atas dock.

- **Chip preset** di baris bawah memilih preset. Tombol bulat biru menjalankannya.
- **Isi dock** menampilkan app di preset sesuai urutannya. Tombol bergaris putus-putus membuka Pengaturan untuk menambah app.
- **Mode** di kanan:
  - *Bersih total*: tutup app di luar preset, ganti dock, lalu buka app yang ditandai "buka otomatis".
  - *Ganti dock saja*: hanya mengganti isi dock.
- **+** membuat preset dari kondisi sekarang: app yang sedang terbuka ditandai "buka otomatis", app yang hanya ada di dock ditandai tidak.
- **Kembalikan** membatalkan preset terakhir: dock dipulihkan dan app yang tadi ditutup dibuka lagi. Dokumen di dalam app belum tentu ikut kembali, tergantung apakah app itu memulihkan jendelanya sendiri.
- **Dock asli** (menu ☰ atau menu ikon menu bar) memulihkan dock seperti sebelum Docky pertama dipakai.

Contoh preset *Kerja*:

| App    | Urutan di dock | Buka otomatis |
|--------|----------------|---------------|
| Claude | 1              | Ya            |
| Figma  | 2              | Ya            |
| Slack  | 3              | Ya            |
| Notion | 4              | Tidak         |

Yang ditutup hanya app yang sama sekali tidak ada di preset. Notion dibiarkan kalau sudah terbuka, dan tidak dibuka kalau belum.

### Alur menjalankan preset

1. **Potret kondisi sekarang**: catat app yang terbuka dan isi dock, untuk Kembalikan.
2. **Tutup app di luar preset**: semua diminta tutup bersamaan dengan sopan, seperti ⌘Q. Yang dilewati: app di preset, daftar pengecualian, Finder, dan app latar belakang / menu bar.
3. **Tunggu maksimal sekitar 5 detik**: dialog "Save?" tidak dijawab dan app tidak pernah dipaksa tutup. Setelah batas waktu, Docky lanjut tanpa app itu dan menyebutnya di ringkasan.
4. **Ganti isi dock**: deretan app diganti sesuai preset dan urutannya, folder di sisi kanan (misalnya Downloads) dibiarkan, "recent apps" dimatikan, lalu Dock di-restart. Setelah restart isi dock dibaca ulang; kalau tidak sesuai, isi sebelumnya dipulihkan.
5. **Buka app "buka otomatis"**: yang sudah berjalan dilewati. Langkah ini sengaja setelah restart Dock.

Mode *Ganti dock saja* hanya menjalankan langkah 1 dan 4.

Prinsip penanganan masalah: kalau ragu, Docky lebih baik tidak mengubah apa pun daripada merusak Mac.

| Masalah | Yang dilakukan Docky |
|---|---|
| App di preset sudah dihapus | Tampil abu-abu di editor; dilewati saat dijalankan dan disebut di ringkasan |
| Format dock tidak dikenali (misalnya macOS baru) | Batalkan ganti dock tanpa mengubah apa pun, lalu beri tahu pengguna |
| Dock tidak sesuai setelah restart | Baca ulang isi dock; kalau salah, pulihkan isi sebelumnya |
| `presets.json` rusak | Simpan sebagai `presets.broken.json`, mulai dengan daftar kosong, beri tahu pengguna |
| App gagal dibuka | Catat di ringkasan; preset tetap selesai |
| App punya pekerjaan belum disimpan atau macet | Tunggu sekitar 5 detik, lanjut tanpa app itu, sebut di ringkasan |

Di luar lingkup versi pertama: tab browser, desktop lain (Spaces), monitor kedua, posisi jendela, shortcut keyboard per preset, jadwal otomatis, Focus mode / Shortcuts, dan URL atau profil browser per preset.

## Pasang (beta)

1. Unduh `Docky_*.dmg` dari [GitHub Releases](https://github.com/donnyridwan/docky/releases), buka, dan seret Docky ke Applications.
2. Build beta belum ditandatangani, jadi macOS akan menolak membukanya dengan klik dua kali. Buka **System Settings → Privacy & Security**, gulir ke bawah, lalu klik **Open Anyway** untuk Docky. Atau dari Terminal:

   ```bash
   xattr -dr com.apple.quarantine /Applications/Docky.app
   ```

3. Saat pertama dibuka, Docky menyimpan cadangan dock aslimu sebelum mengubah apa pun.

## Data dan privasi

Semua data ada di `~/Library/Application Support/Docky/`:

| File | Isi | Kapan ditulis |
|---|---|---|
| `presets.json` | Semua preset, dengan nomor versi format | Saat preset dibuat atau diedit |
| `settings.json` | Daftar pengecualian, batas waktu tunggu, penanda layar pengenalan | Saat pengaturan diubah |
| `dockbackup.plist` | Cadangan dock asli | Sekali, saat Docky pertama dipakai; tidak pernah ditimpa |
| `lastsnapshot.json` | Potret kondisi sebelum preset terakhir | Setiap kali preset dijalankan |

App di preset dicatat dengan bundle ID (contoh `com.figma.Desktop`), bukan lokasi file, karena bundle ID tetap sama walaupun app dipindah atau di-update. Setiap penulisan memakai file sementara yang lalu menggantikan file lama, supaya file tidak rusak kalau Mac mati di tengah proses.

Docky tidak mengirim data apa pun ke internet.

## Memulihkan dock secara manual

Untuk jaga-jaga kalau Docky sendiri tidak bisa dibuka. Jalankan di Terminal.

**Kembali ke dock sebelum Docky dipakai** (memakai cadangan yang dibuat Docky; ukuran dan posisi dock juga ikut kembali ke saat itu):

```bash
defaults import com.apple.dock ~/Library/Application\ Support/Docky/dockbackup.plist
```

```bash
killall Dock
```

**Kembali ke dock bawaan macOS** (kalau cadangan tidak ada):

```bash
defaults delete com.apple.dock
```

```bash
killall Dock
```

Untuk menghapus Docky sepenuhnya: keluar dari Docky lewat menu ikon menu bar, hapus `Docky.app` dari Applications, lalu hapus folder data:

```bash
rm -rf ~/Library/Application\ Support/Docky
```

## Pengembangan

Kebutuhan: macOS 13+, [Rust](https://rustup.rs) stabil, Node.js 20+, dan Xcode Command Line Tools.

```bash
npm install
```

```bash
npm run tauri dev
```

Tampilan juga bisa dikembangkan di browser biasa tanpa Mac: `npm run dev` lalu buka `http://localhost:1420` (panel) atau `http://localhost:1420/settings.html` (Pengaturan). Di luar Tauri, `src/api.ts` memakai data contoh.

### Struktur

```
crates/docky-core/     Logika murni, dites dengan cargo test (jalan juga di Linux)
  src/plan.rs          Penentuan app yang ditutup dan dibuka, preset dari kondisi sekarang
  src/dock.rs          Pengolahan isi dock (com.apple.dock): ganti app, folder kanan utuh
  src/store.rs         PresetStore, settings, SnapshotManager, cadangan dock; tulis atomik
  src/engine.rs        Alur lima langkah, Kembalikan, Dock asli; trait AppController & DockManager
  src/scanner.rs       AppScanner: app terpasang dari Info.plist
  src/fakes.rs         AppController dan DockManager palsu untuk tes
  tests/fixtures/      Contoh file dock beberapa versi macOS
src-tauri/             App Tauri
  src/lib.rs           Tauri command, ikon menu bar, jendela panel dan Pengaturan
  src/platform/        AppController (NSRunningApplication), DockManager, ikon app (NSWorkspace)
src/                   Tampilan React + TypeScript
  panel/               Panel mengambang (Figma: Variasi B · Panel bawah, gaya Skala)
  settings/            Jendela Pengaturan: editor preset, pengecualian, umum
  assets/icons/        Ikon 16 px dari Figma
```

Hanya `AppController` dan `DockManager` yang menyentuh macOS. Keduanya trait dengan versi palsu, jadi sebagian besar tes tidak menutup app atau mengubah dock sungguhan.

Isi dock dibaca dan ditulis lewat `defaults export` / `defaults import com.apple.dock` (isi yang sama dengan `~/Library/Preferences/com.apple.dock.plist`), supaya perubahan melewati `cfprefsd` dan tidak ditimpa cache preferensi, lalu Dock di-restart dengan `killall Dock`.

Tauri command yang dipanggil tampilan: `scan_apps`, `list_presets`, `save_preset`, `delete_preset`, `preset_from_current`, `get_settings`, `save_settings`, `run_preset`, `undo_last`, `restore_original_dock`, `app_status`, serta perintah jendela (`resize_panel`, `hide_panel`, `open_settings`, `quit_app`). Progres `run_preset` dikirim lewat event `run-progress`, satu event per langkah.

### Tes

```bash
cargo test
```

```bash
npm run typecheck
```

Tes otomatis mencakup penentuan app yang ditutup (dari daftar app berjalan, isi preset, dan pengecualian), pengolahan file dock dari beberapa versi macOS (folder di sisi kanan tetap utuh), konversi format preset lama ke baru, penanganan file rusak, dan seluruh alur menjalankan preset dengan versi palsu.

Contoh file dock di `crates/docky-core/tests/fixtures/` adalah tiruan format macOS 13, 14, dan 15. Tambahkan salinan asli dari Mac uji (`defaults export com.apple.dock dock-macosXX.plist`) setiap kali menguji versi macOS baru.

### Uji manual sebelum setiap rilis

Lakukan di akun pengguna macOS terpisah supaya dock kerja tetap aman, di macOS 13 sampai versi terbaru:

- [ ] Preset saat TextEdit punya dokumen belum disimpan
- [ ] Preset saat ada app macet
- [ ] Preset berisi app yang sudah dihapus
- [ ] Tombol "Kembalikan"
- [ ] Pilihan "Dock asli"
- [ ] Pengalaman pertama membuka Docky
- [ ] Menjalankan preset selesai dalam kurang dari 10 detik, termasuk restart Dock

## Rilis dan distribusi

1. **Beta 0.x** untuk lingkaran kecil, lewat GitHub Releases. Belum ditandatangani; lihat cara membukanya di atas. Workflow `release` membuat `.dmg` saat tag `v*` di-push.
2. **Rilis publik**: daftar Apple Developer, lalu tandatangani dan notarisasi app (lihat komentar di `.github/workflows/release.yml`).
3. **Update otomatis** dengan plugin updater Tauri dan file daftar versi di GitHub.
4. **Homebrew**, setelah ada pengguna.

Catatan nama: "Docky" pernah dipakai untuk dock populer di Linux. Perlu dicek sebelum rilis publik.

## Lisensi

[MIT](LICENSE). Font [Archivo](https://fonts.google.com/specimen/Archivo) disertakan dengan lisensi SIL Open Font License 1.1.
