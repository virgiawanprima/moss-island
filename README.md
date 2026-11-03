# Tauri + Vanilla TS

This template should help get you started developing with Tauri in vanilla HTML, CSS and Typescript.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Pemeriksaan kualitas

Workflow [CI](.github/workflows/ci.yml) berjalan pada push, pull request, atau pemicu manual di Windows.

| Pemeriksaan | Yang dijawab | Perintah lokal dari root |
| --- | --- | --- |
| Tipe/build | Apakah kode valid dan bisa dibangun? | `npm run build`, `cargo check --locked --all-targets --manifest-path src-tauri/Cargo.toml` |
| Tes logika | Apakah perilaku yang diuji sesuai harapan? | `npm test`, `cargo test --locked --manifest-path src-tauri/Cargo.toml` |
| ESLint/Clippy | Adakah pola kode mencurigakan meskipun bisa dibangun? | `npm run lint`, `cargo clippy --locked --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings` |

Jalankan `npm ci` untuk memasang dependensi frontend. CI memasang Rust **1.99.1** beserta komponen Clippy; gunakan versi compiler yang sama untuk hasil lint Rust yang konsisten. `rustc --version` dan `cargo clippy --version` menampilkan versi lokal.

ESLint memakai aturan recommended JavaScript/TypeScript serta pemeriksaan bertipe untuk `await` non-Promise dan penyalahgunaan Promise. Pemeriksaan mencakup `src`, `tests`, konfigurasi Vite, serta berkas `.mjs` di root. `--max-warnings 0` membuat peringatan menggagalkan CI. Berkas hasil build dan Rust diabaikan oleh ESLint karena memiliki pemeriksa tersendiri.

Pengecualian terbatas: mock tes lama boleh memakai `any`; callback DOM/Tauri boleh async; parameter/nama error berawalan `_` yang sengaja diabaikan dan properti yang dikeluarkan melalui rest destructuring tidak dianggap tidak terpakai. Satu alias `this` untuk mengamati instance Audio pada mock tes diberi alasan di barisnya. Kode aplikasi tetap diperiksa terhadap `any` eksplisit.

Clippy memeriksa seluruh target dan memperlakukan peringatan sebagai error. Command Tauri `animate_island_window` memiliki pengecualian lokal untuk jumlah argumen agar kontrak IPC frontend tidak berubah; pemeriksaan Clippy lain tetap berlaku.

Dependensi lint memakai override terbatas `minimatch@^10.0.0` ke `11.0.4` untuk menghindari [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249). Tinjau kembali override setelah dependensi induk mengadopsi versi yang diperbaiki. Jangan menjalankan `npm audit fix --force` karena rekomendasinya dapat menurunkan ESLint ke versi mayor lama.

Tes perangkat/jaringan Rust yang ditandai ignored tetap tidak dijalankan otomatis. Lint dan tes logika tidak menggantikan pemeriksaan UI atau integrasi pemutar media pada desktop nyata.

## Audio lokal

Rekaman audio besar tidak disertakan dalam Git. Folder `public/audio` menyimpan kredit dan ilustrasi SVG, sementara rekaman `.webm`, `.mp3`, `.ogg`, `.wav`, `.flac`, dan `.m4a` diabaikan Git. Berkas yang sudah ada di laptop tetap dipertahankan.

Untuk memakai playlist bawaan, sediakan rekaman yang penggunaannya diizinkan pada lokasi berikut:

| Trek | Berkas lokal |
| --- | --- |
| Jazz Noir | `public/audio/zmeHQsFYOYg.webm` |
| Wave to Earth | `public/audio/QOC5v9Yaj_k.webm` |
| Laufey | `public/audio/PggT2sFOsVg.webm` |
| Rainy Lo-fi | `public/audio/9kzE8isXlQY.webm` |

Lihat [kredit dan batas distribusi](public/audio/CREDITS.md). Clone baru tetap dapat menjalankan lint, tes logika, dan build tanpa rekaman tersebut; pemutaran playlist bawaan memerlukan berkas lokalnya. Sesi media Windows memakai sumber dari pemutar yang sedang berjalan.

`npm run test:audio` memeriksa keberadaan, ukuran, header WebM dan kredit keempat rekaman. Perintah ini sengaja terpisah dari CI karena berkasnya hanya ada secara lokal. Pemeriksaan katalog/kredit/ilustrasi serta perilaku pemutaran melalui mock tetap berada dalam `npm test`.
