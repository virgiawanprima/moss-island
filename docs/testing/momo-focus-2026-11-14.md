---
title: Momo berhenti di tunas saat Fokus 2026-11-14
date: 2026-11-14
tags: [moss-island, bugfix, testing]
---

# Momo berhenti di tunas saat Fokus

Permintaan: perbaiki Momo yang tidak berjalan ke mana-mana setelah mendatangi tunas saat Fokus aktif.

## Fakta dan perbaikan

`IslandRenderer.update()` langsung menghentikan gerak ketika `gardenSchedule.active` bernilai false. Setelah kunjungan awal selesai, Momo tetap di samping tunas sampai tugas perawatan berikutnya atau kegiatan santai lari terpilih. Rute jalan biasa sudah ada tetapi tidak diproses.

`src/canvas/islandRenderer.ts` sekarang melanjutkan rute jalan biasa ketika tidak ada perawatan aktif. Jika rute yang tersimpan masih rute tanaman, rute dan penghitungnya dikembalikan ke jalan setapak. Tugas perawatan berikutnya tetap mengambil prioritas melalui dispatchCare. Jeda, istirahat, cuaca, dan reduced motion tetap menggunakan pembatas gerak yang ada.

## Verifikasi

- Tes regresi renderer asli di `tests/test_suite.ts` gagal sebelum perbaikan pada asersi bahwa Momo berjalan di sela perawatan; suite awal 179/180 lulus.
- Setelah perbaikan, `npm test`: 180/180 lulus. Tes baru mencakup selesai menanam/merawat, meninggalkan tunas, tidak melakukan perawatan di sela jadwal, berhenti saat jeda, kembali menyiram setelah resume, dan tidak menambah pohon sebelum fokus selesai.
- `npm run build`: lulus.
- `git diff --check`: lulus, terdapat peringatan normalisasi CRLF pada beberapa berkas.
- Verifikasi visual Tauri setelah perbaikan belum dilakukan. Tidak menjalankan ulang Rust karena kode Rust tidak berubah.

Gotcha: ketika menambahkan scheduler perawatan, jangan menjadikan ketiadaan tugas sebagai penghentian seluruh gerak; tetap jalankan rute biasa tanpa mengulang aksi tanaman.

Perubahan versi/taskbar sebelumnya dan berkas pengguna lain dipertahankan. Commit/push/rilis belum tersedia karena batas Git dan jaringan sesi sebelumnya. Vault dapat dibaca tetapi tidak berada dalam direktori yang diizinkan untuk menulis; pembaruan catatan utama, handoff, gotcha dan jurnal tertunda. Bahan sinkronisasi: [[moss-island]], [[moss-island-handoff]], [[moss-island-gotcha]], [[moss-island-2026-11-14]]. Belum ada rujukan balik baru dari vault.

- Pemeriksaan tambahan: npm run lint lulus tanpa warning.

## Lanjutan: variasi aktivitas, rute acak, dan render sprite

Permintaan lanjutan: perbaiki render pada screenshot, jangan hanya berjalan/berkebun atau terlalu sering kembali ke tunas, jelajahi semua petak secara acak, dan hindari aktivitas berjalan bersamaan dengan animasi diam.

Fakta: dispatchCare sebelumnya memanggil leisure.stop yang mereset cooldown setiap kunjungan, sementara clock kegiatan santai berhenti selama perawatan. Kombinasi itu dapat menunda aktivitas santai terus-menerus. Render aksesori musiman digambar langsung sebagai vektor pada target yang sudah diperkecil, sedangkan tubuh memakai raster 64x64; kedua lapisan memakai cara sampling berbeda. Rotasi kontinu juga membuat grid sprite miring. Screenshot pengguna menjadi laporan tampilan; ketajaman setelah perbaikan belum diverifikasi visual.

Perubahan:
- `momoWander.ts`: tujuan petak kosong diacak; BFS menyusun langkah bertetangga di grid 6x6, menghindari petak tanaman dan batas pulau. Semua petak kosong yang terhubung dikunjungi; rute baru diacak setelah selesai. Petak tanaman tidak dijadikan tujuan jalan santai.
- `momoLeisure.ts`: waktu tunggu tetap berjalan selama berkebun, tetapi aktivitas baru menunggu perawatan selesai. Interupsi perawatan tidak mereset cooldown.
- `gardenSchedule.ts`: tunas dirawat tiap60 detik aktif dan pohon tiap90 detik, menggantikan30/60 detik. Kunjungan awal tetap menanam, menyiram, memupuk.
- `islandRenderer.ts`: rute jalan/larian mencakup pulau; aktivitas diam menahan gerak, perawatan menyela aktivitas santai, lambaian/musiman menunggu aktivitas lain, efek musik hanya mengikuti tarian. Animasi menanam tidak lagi dipicu hanya karena progres tunas rendah. Status musik dijeda tidak membuat Fokus aktif terus beristirahat. Posisi sprite tetap di grid piksel; goyangan bertahap mengganti rotasi kontinu.
- `momoV2Atlas.ts`: tubuh dan aksesori disatukan pada kanvas64x64 sebelum pengecilan dengan smoothing nonaktif. Kanvas sementara digunakan ulang dan dibersihkan tiap gambar; frame atlas asli tidak diubah.
- `tests/test_suite.ts`: skenario rute seluruh pulau, penghindaran tanaman dan batas, perbedaan urutan random, simulasi Fokus10menit untuk keenam kegiatan santai, batas kunjungan tunas, polling musik dijeda, dan eksklusivitas gerak/aksi diam. Ekspektasi empat waypoint tengah dan interval30/60 detik diubah karena permintaan perilaku baru, bukan dilemahkan agar lulus.

Percobaan QA visual: bundel renderer untuk fixture lokal berhasil dibuat di test-results. Edge headless gagal diluncurkan (Target page/context/browser closed, TransactNamedPipe pipe ended); tidak ada screenshot sesudah perbaikan dan tidak ada klaim pengujian Tauri nyata. Kegagalan menulis bundel awal ke D:/workspace juga dicatat; output dipindahkan ke direktori test-results proyek yang diizinkan dan diabaikan Git. Tidak mengubah pengaturan keamanan atau proses pengguna.

Gotcha baru: cooldown kegiatan yang selalu direset oleh tugas berulang dapat menyebabkan starvation meskipun tes modul santai sendiri lulus. Uji renderer selama beberapa menit simulasi dan sertakan status media yang dipolling. Untuk pixel art, kompositkan aksesori pada grid sumber yang sama dan hindari rotasi kontinu; bukti ketajaman tetap memerlukan pemeriksaan visual desktop.

Sinkronisasi vault masih tertunda karena batas izin tulis. Terkait [[moss-island]], [[moss-island-handoff]], [[moss-island-gotcha]], [[moss-island-2026-11-14]].

## Verifikasi akhir dan pengamatan Tauri langsung

- npm test: 183/183 lulus setelah seluruh perubahan, termasuk polling musik dijeda selama simulasi Fokus10menit.
- npm run build: lulus, menghasilkan bundle index-BkUtAlIj.js.
- npm run lint: lulus tanpa warning. git diff --check lulus dengan peringatan normalisasi CRLF.
- Atas instruksi pengguna, Computer Use memilih jendela Moss Island yang sudah dijalankan pengguna, ID722978, proses D:/projects_win/moss-island/src-tauri/target/debug/tauri-app.exe. Frontend native termuat di http://localhost:1420/, bukan halaman error jaringan.
- Screenshot selama Fokus berjalan (sekitar sisa06:49 sampai05:20) menunjukkan Momo di dekat tunas, tengah pulau, lalu tepi kiri. Gerak tidak lagi terbatas pada area tunas atau empat petak tengah. Timer Fokus tetap berjalan; tidak menekan tombol, mengubah konfigurasi, atau menghentikan aplikasi pengguna.
- Pada sampel screenshot tersebut tidak tampak jalan dan berkebun bertumpuk. Sampel gambar bukan jaminan seluruh transisi bebas benturan. Keenam aktivitas santai dibuktikan lewat simulasi renderer, belum seluruhnya diamati langsung di Tauri. Semua petak/DPI/ukuran panel belum diperiksa di desktop nyata.
- Render sprite setelah perubahan terlihat langsung pada satu panel horizontal. Penilaian ketajaman menyeluruh dan seluruh frame pada DPI lain belum dilakukan; tidak mengklaim aset berubah menjadi resolusiHD. Screenshot memakai aset musiman aplikasi yang ada.

Pengamatan langsung ini memperbarui batas verifikasi visual sebelumnya untuk skenario yang disebutkan saja. Vault tetap belum diperbarui karena batas izin tulis.

## Penghapusan aktivitas menanam

Permintaan terbaru: hapus kegiatan Momo mendatangi tunas baru untuk menanam. Aktivitas plant dihapus dari GardenAction, buildGardenRoute, dan daftar tugas awal GardenSchedule. Parameter includePlant serta durasi waypoint khusus menanam dihapus. Renderer tetap membuat tunas langsung saat awal Fokus dan memperbarui pertumbuhannya; kunjungan awal sekarang hanya water lalu fertilize. Sprite atlas bernama plant masih dipakai sebagai pose dasar memupuk, bukan tugas menanam; tidak menghapus aset yang dipakai aktivitas lain.

Berkas: src/canvas/gardening.ts, src/canvas/gardenSchedule.ts, src/canvas/islandRenderer.ts, tests/test_suite.ts, docs/releases/v0.1.2.md. Tes93/94/172 mengikuti kontrak baru dan memeriksa urutan perawatan tanpa plant. npm test183/183 lulus; git diff --check lulus dengan peringatan CRLF. Verifikasi visual Tauri tidak diulang setelah penghapusan ini. Teks menanam dalam bagian sebelumnya merupakan histori dan digantikan keputusan ini.

Gotcha: menghapus tugas menanam tidak berarti menghapus atlas plant karena pose tersebut digunakan memupuk. Pertahankan pertumbuhan tunas serta penambahan pohon setelah Fokus. Sinkronisasi vault tetap tertunda karena direktori tidak diizinkan untuk penulisan sesi. Terkait [[moss-island]] [[moss-island-handoff]] [[moss-island-gotcha]] [[moss-island-2026-11-14]].

Build setelah penghapusan menanam: npm run build lulus (index-BNy8miJo.js).

## Percobaan publikasi ulang dan skrip rilis

Pengguna meminta push dan release lagi setelah aktivitas menanam dihapus. git add kembali ditolak saat membuat .git/index.lock (Permission denied), sehingga commit/push tidak dijalankan. gh release list gagal terhubung ke api.github.com. Installer yang tersedia tetap0.1.0/0.1.1, bukan0.1.2; tidak dipublikasikan ulang sebagai versi baru.

Disiapkan scripts/publish-v0.1.2.ps1 untuk dijalankan pengguna dari PowerShell Windows biasa. Skrip memeriksa branch/staging, koneksi GitHub, tes/lint/Rust, membangun NSIS baru, memeriksa versi/nama/waktu installer, membuat SHA256, men-stage hanya berkas cakupan, commit/push, lalu membuat draft dengan installer dan checksum sebelum menerbitkannya. Berhenti pada setiap kegagalan; tidak mengganti aset rilis lama. Validasi parser PowerShell lulus; skrip belum dieksekusi end-to-end. Tidak mengubah pembatasan Git/jaringan sesi atau mengalihkan eksekusi agen untuk melewati pembatasan. Catatan vault belum dapat ditulis.

## Validasi publikasi 2026-11-14

Permintaan: push dan release v0.1.2 ke origin/main. Belum melakukan staging, commit, push, atau publikasi.

Hasil aktual: npm test awal 182/183, gagal pada Uji153 (seek asinkron); pengulangan tanpa perubahan kode 183/183 lulus. Ini menunjukkan kegagalan intermiten dan belum merupakan diagnosis penyebab. npm run lint dan build frontend lulus. cargo check --locked lulus. cargo test --lib dan build NSIS satu job masih berjalan saat catatan ini ditulis. Tes layout gagal meluncurkan Edge (Target page, context or browser has been closed); hasilnya tidak membuktikan regresi layout.

Pemeriksaan persetujuan otomatis menolak skrip publish-v0.1.2.ps1 karena meminta otorisasi spesifik untuk target virgiawanprima/moss-island, commit ke main dan unggahan installer/checksum. Tidak mencoba melewati penolakan. Catatan vault belum diperbarui karena berada di luar root tulis sesi; laporan ini menjadi bahan sinkronisasi. Rujukan: [[moss-island]], [[moss-island-handoff]], [[moss-island-gotcha]], [[moss-island-2026-11-14]].

## Pengujian ulang atas permintaan pengguna

Tanpa perubahan kode: npm test lulus 183/183. npm run test:layout dijalankan dengan izin di luar sandbox; seluruh 30 tes lulus dalam 39,1 detik. Hasil ini memperjelas kegagalan peluncuran Edge sebelumnya sebagai batas lingkungan sesi. cargo test --locked --lib selesai: 4 lulus, 3 ignored. Sesuai instruksi terbaru pengguna, Obsidian tidak digunakan atau diperbarui. Build installer masih berjalan; belum push/rilis.

