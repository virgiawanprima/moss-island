# Menyiapkan rilis Windows

Workflow **Build Windows release** hanya menerbitkan rilis dari `main`. Installer NSIS x64 dan aplikasi yang terpasang harus memiliki tanda tangan Authenticode valid, timestamp, dan identitas penerbit yang sesuai. Workflow juga menjalankan instalasi dan memeriksa bahwa proses aplikasi tetap hidup selama lima detik. Ini bukan pengujian lengkap UI atau SmartScreen pada semua PC.

1. Siapkan profil produksi **Public Trust** melalui [Azure Artifact Signing](https://learn.microsoft.com/en-us/azure/artifact-signing/quickstart). Periksa kelayakan negara sebelum mendaftar. Jika tidak memenuhi syarat, gunakan penyedia sertifikat penandatanganan kode yang dipercaya Windows dan sesuaikan integrasi [Tauri](https://v2.tauri.app/distribute/sign/windows/). Jangan gunakan profil Test atau sertifikat buatan sendiri untuk distribusi publik.
2. Beri identitas aplikasi Azure peran **Artifact Signing Certificate Profile Signer** untuk profil rilis. Buat GitHub Actions environment `windows-release`, batasi deployment ke `main`, dan simpan konfigurasi berikut di environment tersebut.

| Jenis | Nama | Isi |
| --- | --- | --- |
| Variable | `WINDOWS_SIGNING_ENDPOINT` | URL HTTPS layanan signing |
| Variable | `WINDOWS_SIGNING_ACCOUNT` | Nama akun Artifact Signing |
| Variable | `WINDOWS_SIGNING_PROFILE` | Nama profil produksi Public Trust |
| Variable | `WINDOWS_SIGNING_SUBJECT` | Subject Authenticode penerbit secara persis, sesuai `SignerCertificate.Subject` pada sampel yang ditandatangani dengan profil itu |
| Secret | `AZURE_CLIENT_ID` | ID aplikasi Azure |
| Secret | `AZURE_TENANT_ID` | ID tenant Azure |
| Secret | `AZURE_CLIENT_SECRET` | Secret aplikasi Azure. Simpan di GitHub, bukan di Git atau chat |

3. Jalankan **Build Windows release** dari `main` setelah CI lulus. Workflow menerbitkan installer dan checksum SHA-256 hanya setelah pengujian berhasil. GitHub membuat tag rilis pada commit yang diuji.

Tanda tangan mengidentifikasi penerbit dan membantu mendeteksi perubahan pada file. Checksum memeriksa integritas unduhan, bukan identitas penerbit. SmartScreen masih bisa menampilkan peringatan berdasarkan reputasi file atau kebijakan perangkat; jangan nonaktifkan perlindungan Windows.
