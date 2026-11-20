# Prarilis Windows x64 tanpa tanda tangan

Installer NSIS ini ditujukan untuk pengujian, bukan rilis stabil. Workflow GitHub Actions memasangnya dalam mode senyap dan memeriksa bahwa aplikasi dapat diluncurkan pada runner Windows.

Cocokkan SHA-256 installer dengan berkas `SHA256SUMS` yang disertakan. Checksum mendeteksi perubahan berkas, tetapi tidak memverifikasi identitas penerbit. SmartScreen, Smart App Control, atau kebijakan perangkat dapat memperingatkan atau memblokir installer ini. Jangan nonaktifkan perlindungan Windows.
