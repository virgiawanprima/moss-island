# Pemeriksaan kode dan publikasi 2026-11-04

CI Windows menjalankan ESLint tanpa warning, 167 tes logika, build TypeScript/Vite, cargo check, Clippy seluruh target dengan -D warnings, dan tes Rust. Compiler CI dipatok ke Rust 1.99.1. ESLint memeriksa TypeScript, penggunaan Promise dalam kondisi dan await pada nilai non-Promise. Mock tes tetap mengizinkan any; callback DOM/Tauri async tetap diizinkan. Kontrak argumen command Tauri dipertahankan dengan pengecualian Clippy lokal yang beralasan.

Hasil lokal: ESLint lulus; npm test 167/167; npm run build lulus; cargo check dan Clippy seluruh target lulus; cargo test menghasilkan 4 lulus dan 3 ignored. Tes ignored yang memerlukan lingkungan nyata tidak dijalankan. Ini bukan bukti pengujian integrasi Spotify desktop. Override minimatch 11.0.4 menghasilkan audit npm tanpa kerentanan yang dilaporkan saat pemeriksaan.

Seluruh perubahan kode aplikasi serta aset ringan disiapkan untuk GitHub sesuai permintaan pengguna. Rekaman audio tetap lokal dan diabaikan Git. Tes utama menjaga katalog, kredit, ilustrasi serta perilaku pemutaran dengan mock. Pemeriksaan file rekaman dipisahkan secara eksplisit ke npm run test:audio: keempat rekaman lokal lulus pemeriksaan keberadaan, ukuran, header WebM dan kredit. Clone tanpa rekaman tetap dapat menjalankan tes utama dan build; pemutaran koleksi lokal membutuhkan berkas tersebut. Lihat README untuk nama berkas.

Status GitHub Actions harus diperiksa setelah push; hasil lokal tidak membuktikan workflow remote sudah lulus.

Snapshot Git tanpa audio juga lulus ESLint, 167/167 tes dan build. .gitattributes menetapkan LF agar tes pembacaan CSS konsisten pada checkout Windows; salinan awal dengan CRLF gagal diproses pada assertion CSS, kemudian pengujian ulang dengan LF berhasil.
