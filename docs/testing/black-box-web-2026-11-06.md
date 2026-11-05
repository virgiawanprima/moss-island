# Uji black box web Moss Island, 6 November 2026

Lingkup: aplikasi web nyata http://127.0.0.1:1420/?tab=focus, commit bf4854c. Pengujian memakai klik, keyboard, input dan pembacaan tampilan. Tidak memanggil metode internal timer, tidak mengubah localStorage lewat skrip, tidak memakai mockmedia. Ini pengujian web, bukan kelulusan APK/native Tauri. Permintaan audit tidak dianggap izin memperbaiki seluruh temuan.

## Temuan

| ID | Tingkat | Langkah dan hasil aktual | Harapan / saran |
| --- | --- | --- | --- |
| BB-01 | Sedang | Belum mulai → Rencana → Batalkan rencana. Timer25:00/Siap mulai tidak berubah, menu tetap terbuka. | Sembunyikan/nonaktifkan pembatalan saat tidak ada sesi aktif, dengan penjelasan singkat bila perlu. |
| BB-02 | Sedang | Klik Workspace pada dock: tidak ada perubahan. | Beri fungsi, status belum tersedia, atau hapus kontrol placeholder. |
| BB-03 | Sedang | Klik Catatan pada dock: tidak ada perubahan. | Sama seperti BB-02. |
| BB-04 | Rendah | Rencana1menit menampilkan TOTAL0JAM1M dan 1m Fokus+0m istirahat. | Format1menit; hilangkan unit0 yang tidak diperlukan. |
| BB-05 | Perlu verifikasi lanjutan | Menyimpan perubahan musim saat fokus berjalan: timer tetap lanjut, tetapi tunas tidak tampak pada screenshot35–57%. | Periksa apakah state tunas hilang karena renderer dibuat ulang. Pohon tetap tumbuh ketika sesi selesai dan tetap ada setelah reload. Jadi penanaman akhir berhasil; tampilan tunas selama perubahan musim masih perlu diperiksa terpisah. |

## Alur yang dijalankan

| Area | Input/tindakan | Hasil aktual |
| --- | --- | --- |
| Timer | Mulai25:00, tunggu, Jeda | Menjadi24:53/Fokus dijeda. |
| Persistensi | Reload saat dijeda | Tetap24:53 dan Lanjut. |
| Akhir alami | Atur1menit lewat UI, Mulai, tunggu60detik nyata |00:00,100%, RENCANA SELESAI dan Mulai Baru. Satu pohon terlihat, tetap ada setelah reload. Status selesai sendiri kembali Siap mulai setelah reload; belum diputuskan apakah memang perilaku yang diinginkan. |
| Batas input | Jam25 dan menit60 | Pesan jam0–24 dan menit0–59, preview invalid. |
| Pembatalan aktif | Rencana→Batalkan | Konfirmasi muncul; Rencana tersembunyi. |
| Batal konfirmasi | Escape dan Lanjutkan rencana | Kembali, waktu tetap24:53. |
| Durasi nol | Jam0, menit0 | Pesan Durasi minimal1menit; preview invalid. |
| Perubahan durasi aktif | Ubah4jam menjadi3jam, Simpan, Cancel dialog | Rencana4jam/24:53 tetap; modal belum tersimpan. |
| Simpan disetujui | Simpan lagi, OK dialog native browser | Menjadi3jam,6sesi,25:00; opsi manual rehat ditampilkan. |
| Persistensi konfigurasi | Reload |3jam/6sesi bertahan. |
| Musim | Pilih manual dingin/semi/panas/gugur dan Simpan | Warna/lantai pulau berubah sesuai pilihan. |
| Intensitas Momo | Tenang lalu Ekspresif, Simpan | Pilihan tersimpan dan tampil kembali di modal. Detail perbedaan gerak belum dikuantifikasi. |
| Hover | Aktifkan, keluar area | Panel kembali ke bilah; kontrol perluas membuka panel. Kembali nonaktif pada akhir uji. |
| Sumber musik | Musik bawaan lalu Otomatis | Label pilihan berubah; sumber desktop tidak tersedia di web. |
| Volume | Home pada slider |0%; uji audio berikut dilakukan senyap. |
| Putar/jeda | Klik Putar lalu Jeda musik | Label berubah, clock mencapai00:00:05; tidak menguji kualitas suara. |
| Playlist | Next berulang, Previous | Jazz Noir→Wave to Earth→Laufey→Rainy Lo-fi→Jazz Noir; Previous mengembalikan trek. |
| Repeat lokal | Inspeksi tombol | Disabled dengan keterangan playlist selalu diulang. |
| Seek lokal | Inspeksi timeline | Tidak tersedia pada sumber lokal; bukan bukti seek sesi native. |
| Momo musik | Klik Sapa Momo | Klik diterima; perubahan pose singkat belum tertangkap sebagai bukti terukur. |
| Minimize | Tombol− | Bilah muncul dengan timer/judul; expand kembali panel. |
| Pet | Tombol× | Pet utuh terlihat; klik Buka Moss Island membuka kembali panel. Gerak menjauh/dance tidak diukur ulang dalam uji ini. |
| Keluar web | Menu titik tiga→Keluar aplikasi | Alert: Untuk keluar, tutup tab atau jendela peramban. Ditutup dengan OK. |
| Lirik | Inspeksi koreksi−/+ dan Reset | Disabled tanpa rekaman sesi native. |
| Autostart | Inspeksi opsi | Disabled, keterangan hanya desktop. |

## Belum terverifikasi

- Siklus nyata25menit fokus→istirahat5menit→fokus, rehat panjang setelah4sesi, dan musim otomatis setelah6sesi. Uji sebelumnya dengan data dipercepat bukan bukti black box alami dalam sesi ini.
- Hujan acak, seluruh pohon mendapat perawatan, reduced motion, drag pet, batas layar/DPI, multi-monitor.
- Tray, shortcut global, always-on-top, snap10%, autostart Windows, keluar proses native.
- Spotify/Windows media asli, artwork, seek, repeat, LRCLIB online dan koreksi lirik aktif.
- Mode offline, file audio hilang, error recovery jaringan dan uji aksesibilitas menyeluruh.

Timeout alat ketika Simpan/Keluar terjadi karena dialog confirm/alert native browser menahan CDP. Dialog diinspeksi lewat UI desktop dan dijawab; timeout itu sendiri tidak dilaporkan sebagai aplikasi hang.

## Keadaan akhir dan batas kesimpulan

Pengaturan durasi dipulihkan4jam, otomatis rehat/fokus aktif, hover nonaktif, intensitas Ekspresif, sumber Otomatis. Mode musim dikembalikan cycle; musim aktif tetap Gugur setelah pengujian manual, dan satu pohon hasil uji dipertahankan. Audio dijeda dan volume0. Tidak menghapus progres pengguna. Perubahan hanya laporan; kode aplikasi tidak diperbaiki dalam audit ini. Tidak menjalankan ulang tes unit sebagai pengganti pengujian black box. Laporan ini tidak menyatakan seluruh kombinasi fitur lulus. Fitur tanpa bukti hasil terukur dicatat eksplisit, bukan diluluskan karena tombol menerima klik.
