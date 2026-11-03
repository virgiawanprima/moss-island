# Riset pengambilan dan sinkronisasi lirik Moss Island

Tanggal riset: 2026-10-31.
Lingkup: riset internet, dokumentasi resmi, dan pembandingan dengan kode saat ini. Tidak memasang provider, memasukkan kredensial, atau mengubah implementasi aplikasi dalam tugas riset ini.

## Kesimpulan

Ketahanan transport, identitas rekaman, cakupan provider, dan ketepatan clock adalah empat persoalan berbeda. Retry memperbaiki gangguan sementara, tetapi tidak menambah timestamp yang belum tersedia. Pilihan yang layak untuk produk adalah LRCLIB yang dipakai sesuai kontrak, ditambah provider sinkron berlisensi bila kebutuhan cakupan lebih tinggi. Jangan menjadikan endpoint privat atau proxy komunitas tanpa jaminan sebagai fondasi produksi.

## Temuan sumber primer

| Sumber | Temuan yang diperiksa |
| --- | --- |
| LRCLIB API reference | CORS sudah diaktifkan. API anonim tersedia. Identitas klien wajib; registrasi aplikasi opsional menawarkan allowance lebih tinggi. Angka kuota bersifat perkiraan dan dapat berubah. |
| LRCLIB API reference | `Retry-After` pada 429 dan 503 harus dipatuhi, disertai jitter. Respons edge dapat bukan JSON. Periksa status dan Content-Type. |
| LRCLIB API reference | Search maksimal 20 hasil tanpa pagination. GET presisi menggunakan judul/artis; album dan durasi direkomendasikan. Dokumentasi menyebut kecocokan durasi sekitar dua detik. GET berdasarkan ID rekaman juga tersedia. |
| LRCLIB API reference | Record memiliki `instrumental`, `hasWordSync`, `syncedLyrics`, `plainLyrics`, dan `lyricsfile`. Tidak semua record memiliki timestamp baris. |
| Musixmatch API resmi | `matcher.subtitle.get` mendukung judul/artis/durasi dan ISRC. `track.subtitle.get` menerima identifier rekaman termasuk ISRC dan memiliki parameter Spotify ID serta format LRC. Akses perlu API key serta paket/izin yang sesuai. |
| Musixmatch implementation guidelines | Identifier rekaman lebih baik daripada pencarian nama; ISRC direkomendasikan. Periksa versi dan panjang subtitle. Ada kewajiban atribusi, tracking, dan pembatasan wilayah. |
| Musixmatch content restrictions | `has_subtitles` atau konten terlihat pada layanan lain tidak menjamin subtitle dikembalikan kepada aplikasi kita. Restriksi dapat berlaku per artis, lagu, atau negara. |
| LyricFind Lyric Display | Menawarkan static, line-by-line, dan word-by-word melalui produk berlisensi. Akses dan cakupan harus dikonfirmasi kepada penyedia, bukan diasumsikan dari halaman produk. |
| Spotify Web API | Endpoint track/currently-playing mendokumentasikan metadata, identifier dan progres, bukan endpoint lirik publik pada referensi yang diperiksa. OAuth tidak otomatis memberikan akses lirik Spotify. |
| Spotify Developer Policy | Ada batasan penggabungan layanan, sinkronisasi konten, penggunaan AI, dan core experience. Integrasi metadata/overlay yang akan didistribusikan perlu tinjauan ketentuan atau izin; API key provider lirik bukan izin menyeluruh untuk Spotify Platform. |
| Spotify PKCE | PKCE direkomendasikan untuk aplikasi yang tidak bisa menyimpan client secret dengan aman. Tetap ada syarat akses dan kuota development mode; jangan menambahkan login sebagai prasyarat Moss Island tanpa keputusan pengguna. |
| Microsoft GSMTC timeline | Position berlaku pada LastUpdatedTime; StartTime/EndTime adalah timestamp media. Clock lokal perlu menghitung laju dan peristiwa pause/seek, bukan hanya menerima angka posisi lama. |

## Koreksi terhadap asumsi sebelumnya

1. Memindahkan request ke Rust berguna untuk kontrol timeout dan respons, tetapi tidak membuktikan CORS adalah akar keluhan pengguna. Dokumentasi LRCLIB secara eksplisit menyatakan API CORS-enabled.
2. Search kosong atau 20 kandidat yang tidak cocok bukan bukti tidak ada record lain. Endpoint pencarian dibatasi hasil dan provider dapat sementara sibuk.
3. HTTP 503 berarti layanan overload, bukan lirik tidak ada. HTTP 429 berarti pembatasan permintaan, bukan versi lagu salah.
4. Timestamp dari provider lain belum tentu sama dengan rekaman di Spotify walaupun judul dasar atau panjang lagunya dekat.
5. Provider berbayar tidak menjamin seluruh lagu, semua wilayah, atau hasil identik dengan Spotify. Belum dilakukan panggilan terautentikasi Musixmatch/LyricFind, sehingga cakupan Heaven Classic pada provider tersebut belum terverifikasi.

## Kesenjangan implementasi sekarang

| Prioritas | Kesenjangan hasil pembandingan kode | Usulan, belum diimplementasikan dalam riset |
| --- | --- | --- |
| Tinggi | `src-tauri/src/lyrics.rs` hanya mengembalikan status/body, membuang header retry | Teruskan Retry-After dan Content-Type; dukung delta-seconds dan tanggal HTTP yang valid. |
| Tinggi | `lyricsService.ts` dapat melanjutkan fallback endpoint setelah kegagalan provider | Jika 429/503, hentikan rangkaian provider tersebut sampai cooldown terpenuhi; jangan menghindari limit lewat endpoint lain. |
| Tinggi | Backoff ada, tetapi belum menghormati Retry-After dan jitter provider secara eksplisit | Scheduler satu pintu per provider, cooldown global per provider, satu permintaan aktif yang sesuai, batas retry, dan circuit breaker. |
| Tinggi | Hanya satu provider lirik, LRCLIB | Tambahkan adapter provider resmi berlisensi setelah izin/paket tersedia; fallback otomatis, bukan tombol untuk pengguna. |
| Sedang | Cache lirik utama di memori dan identitas metadata saja | Cache persisten berdasarkan provider record ID, recording identifier, metadata versi, dan revisi; TTL mengikuti hak dan ketentuan masing-masing provider. |
| Sedang | Guard hasil lama mencegah salah render tetapi tidak selalu membatalkan seluruh kerja jaringan yang sudah usang | Cancellation atau pemeriksaan generation sebelum memulai setiap fallback; jangan terus mencari lagu yang sudah ditinggalkan. |
| Sedang | Record instrumental dan format timing tambahan belum menjadi hasil domain tersendiri | Bedakan instrumental, plain, synced, not_found, temporary_failure, restricted, dan unverified. Evaluasi format Lyricsfile sebelum menyimpulkan tidak ada timing. |
| Sedang | Pencocokan string ketat menjaga ketepatan tetapi dapat kehilangan alias versi yang sah | Resolusi recording ID/ISRC bila tersedia secara sah; fallback metadata konservatif dengan konflik versi sebagai penolak. Jangan hanya menghapus tanda kurung. |

## Arsitektur yang direkomendasikan

1. **Playback source:** Windows GSMTC tetap menjadi sumber utama tanpa login tambahan. Pengayaan identifier bersifat opsional, resmi, dan terikat sesi yang benar.
2. **Recording resolver:** utamakan identifier yang sah dan dapat dibuktikan. Bila hanya metadata tersedia, periksa artis, label versi, album, dan durasi. Simpan alasan kandidat diterima/ditolak.
3. **Provider adapters:** kontrak hasil yang sama untuk LRCLIB dan provider berlisensi. Pertahankan metadata asal serta hak display/caching; hasil plain dari provider pertama tidak menutup peluang synced yang valid dari provider lain.
4. **Request scheduler:** patuhi header provider, jitter, throttling, cancellation, dan batas waktu total. Metadata lagu tidak perlu dikirim ke banyak proxy asing secara membabi buta.
5. **Persistent cache:** tampilkan cache positif yang masih diizinkan segera, lakukan pembaruan di latar belakang, dan cache hasil negatif dengan TTL. Temporary failure tidak menjadi not_found permanen.
6. **Playback clock:** clock monotonic lokal yang direkonsiliasi dengan snapshot native, LastUpdatedTime, playback rate, pause, seek, dan pergantian sesi. Keterlambatan unduhan lirik tidak menggeser clock lagu.
7. **Renderer:** tampilkan hasil terbaik yang valid secara otomatis. Pengguna tidak perlu menekan Cari sinkron. Jangan menandai plain sebagai synced atau mengarang timestamp.

## Pemilihan provider

| Opsi | Manfaat | Keterbatasan dan keputusan |
| --- | --- | --- |
| LRCLIB yang diperkuat | Tanpa API key wajib; cocok untuk jalur bebas login | Tidak menjamin cakupan, kualitas timing, atau uptime. Harus mematuhi limit dan memperhatikan hak penggunaan konten. |
| Musixmatch resmi | API subtitle dan matching identifier yang terdokumentasi | Memerlukan akses, biaya/ketentuan sesuai paket, atribusi, tracking, dan restriction handling. Jangan embed secret layanan bersama di binary desktop; gunakan backend yang dikelola atau model kredensial yang disetujui provider. |
| LyricFind berlisensi | Produk line/word-sync dan hak display yang dinegosiasikan | Integrasi, biaya, wilayah, cache, dan cakupan perlu konfirmasi; belum diuji dengan lagu pengguna. |
| Proxy komunitas/private API | Berguna mempelajari adapter, fallback, dan format timing | Tidak menjadi rekomendasi default. Token anonim, cookie, endpoint reverse-engineered, lisensi kode, privasi, dan kestabilan upstream perlu audit tersendiri. |
| Forced alignment | Dapat menghasilkan timing dari audio yang memang boleh diproses | Membutuhkan audio rekaman yang sama serta komputasi/model; bukan solusi dari teks saja. Jangan mengambil audio Spotify atau memasukkannya ke model tanpa mematuhi hak dan ketentuan yang berlaku. Tidak direkomendasikan sebagai fallback default. |

Beautiful Lyrics Reborn merupakan contoh arsitektur komunitas multi-provider dan prioritas word/line/static. README terbarunya menyatakan proxy Lyrically/Paxsenix sudah dihapus; hasil search engine yang lebih lama masih menyebut proxy itu. Ini contoh mengapa sumber primer perlu dibaca, bukan menyalin konfigurasi dari cuplikan pencarian. Tidak ada kode proyek tersebut yang dipasang atau dijalankan.

## Urutan pengerjaan yang disarankan

1. Perbaiki scheduler/header LRCLIB, client identification, cache, dan pembatalan request usang. Jangan memperbanyak retry sebagai pengganti provider.
2. Bangun kontrak adapter dan pengujian kualitas rekaman secara terpisah dari UI.
3. Lakukan evaluasi resmi Musixmatch atau LyricFind dengan daftar uji yang mencakup Heaven Classic, lagu studio/live, kolaborasi, instrumental, dan versi berjudul serupa. Pastikan izin penggunaan overlay yang dimaksud.
4. Integrasikan hanya setelah akses dan hasil uji nyata memenuhi target. Sediakan fallback otomatis yang tidak menghilangkan teks.

Tidak ada janji seluruh lagu dapat sinkron secara gratis. Riset ini belum menjadi izin membeli paket, membuat akun, mengubah konfigurasi, atau memasang provider baru.

## Sumber yang dibaca

1. https://lrclib.net/docs.txt
2. https://lrclib.net/llms.txt
3. https://docs.musixmatch.com/implementation-guidelines.md
4. https://docs.musixmatch.com/api-reference/lyrics-catalog/matcher-subtitle-get.md
5. https://docs.musixmatch.com/api-reference/lyrics-catalog/track-subtitle-get.md
6. https://docs.musixmatch.com/content-restrictions.md
7. https://docs.musixmatch.com/getting-started.md
8. https://www.lyricfind.com/products/lyric-display
9. https://developer.spotify.com/documentation/web-api/reference/get-track
10. https://developer.spotify.com/documentation/web-api/reference/get-the-users-currently-playing-track
11. https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow
12. https://developer.spotify.com/policy
13. https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssessiontimelineproperties
14. https://raw.githubusercontent.com/yeahnangua/beautiful-lyrics-reborn/main/README.md
15. https://github.com/m-bain/whisperX

## Status pencatatan

Laporan ini disimpan di repo sebagai pembaruan pengetahuan yang menunggu sinkronisasi Obsidian. Konteks batas akses MCP dicatat di `anti-slop/audit-002-2026-10-31.md`. Tidak mencoba melewati allowlist direktori vault.
