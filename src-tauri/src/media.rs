use serde::{Deserialize, Serialize};

/// Representasi artwork pada kontrak Rust -> TypeScript.
/// `artwork_key` mengikat gambar ke identitas sesi + rekaman yang menghasilkannya.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SystemMediaArtwork {
    pub session_key: String,
    pub record_key: String,
    pub artwork_key: String,
    pub data_base64: String,
    pub mime_type: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SystemMediaTrack {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub is_playing: bool,
    /// AUMID mentah dari sesi (bisa kosong)
    pub source_app: String,
    /// Nama aplikasi sumber yang ramah pengguna, mis. "Opera", "Spotify"
    pub source_display_name: String,
    /// Klasifikasi layanan: "spotify_desktop" | "web_media" | "native_app" | "unknown"
    pub service_kind: String,
    /// true HANYA jika identitas aplikasi benar-benar Spotify (bukan dari judul/artis)
    pub is_spotify: bool,
    pub has_session: bool,
    /// Identitas sesi yang stabil antar polling (untuk konsistensi metadata, sampul, dan kontrol)
    pub session_key: String,
    /// Identitas rekaman (judul+artis+album+nomor trek+durasi) untuk deteksi pergantian lagu/versi
    pub record_key: String,
    /// Apakah sesi menyediakan thumbnail sistem (belum tentu dibaca karena caching)
    pub has_thumbnail: bool,
    pub position_secs: f64,
    pub duration_secs: f64,
}

impl SystemMediaTrack {
    fn empty() -> Self {
        Self {
            title: String::new(),
            artist: String::new(),
            album: String::new(),
            is_playing: false,
            source_app: String::new(),
            source_display_name: String::new(),
            service_kind: "unknown".to_string(),
            is_spotify: false,
            has_session: false,
            session_key: String::new(),
            record_key: String::new(),
            has_thumbnail: false,
            position_secs: 0.0,
            duration_secs: 0.0,
        }
    }
}

/// Batas aman ukuran data gambar yang dikirim ke frontend (bytes).
/// Thumbnail sistem umumnya 20 KB - 500 KB; di atas batas ini dianggap tidak layak dikirim.
const MAX_ARTWORK_BYTES: usize = 2_500_000;
/// Batas jumlah entri cache artwork (LIFO sederhana) agar memori tetap terkendali.
const ARTWORK_CACHE_CAP: usize = 6;

#[cfg(target_os = "windows")]
mod win_media {
    use super::{SystemMediaArtwork, SystemMediaTrack, ARTWORK_CACHE_CAP, MAX_ARTWORK_BYTES};
    use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
    use base64::Engine as _;
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{LazyLock, Mutex};
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession,
        GlobalSystemMediaTransportControlsSessionManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus,
    };
    use windows::Storage::Streams::{DataReader, IRandomAccessStream};
    use windows::core::{Interface, IUnknown};

    async fn get_manager() -> Result<GlobalSystemMediaTransportControlsSessionManager, String> {
        let op = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .map_err(|e| format!("Gagal meminta MediaSessionManager: {}", e))?;
        op.await
            .map_err(|e| format!("Gagal menginisialisasi MediaSessionManager: {}", e))
    }

    fn is_session_playing(session: &GlobalSystemMediaTransportControlsSession) -> bool {
        session
            .GetPlaybackInfo()
            .ok()
            .and_then(|info| info.PlaybackStatus().ok())
            .map(|st| st == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing)
            .unwrap_or(false)
    }

    // ======================================================================
    // IDENTITAS SUMBER: aplikasi dipisahkan dari layanan.
    // Verifikasi Spotify HANYA dari identitas aplikasi sesi. Judul, artis,
    // atau album yang mengandung kata "spotify" TIDAK dianggap bukti.
    // ======================================================================
    fn check_is_spotify(app_id: &str) -> bool {
        let low_id = app_id.to_lowercase();
        low_id.contains("spotify")
    }

    fn is_browser_app(low_app_id: &str) -> bool {
        ["opera", "chrome", "msedge", "microsoft edge", "firefox", "brave", "vivaldi"]
            .iter()
            .any(|b| low_app_id.contains(b))
    }

    fn derive_source_display_name(app_id: &str) -> String {
        let low = app_id.to_lowercase();
        let known = [
            ("spotify", "Spotify"),
            ("opera", "Opera"),
            ("msedge", "Edge"),
            ("microsoft edge", "Edge"),
            ("chrome", "Chrome"),
            ("firefox", "Firefox"),
            ("brave", "Brave"),
            ("vivaldi", "Vivaldi"),
            ("windowsmediaplayer", "Media Player"),
            ("zunemusic", "Groove Music"),
            ("itunes", "iTunes"),
            ("foobar", "foobar2000"),
            ("vlc", "VLC"),
        ];
        for (needle, name) in known {
            if low.contains(needle) {
                return name.to_string();
            }
        }
        // Ambil bagian terakhir AUMID yang bermakna ("Paket!App" atau "path\exe")
        let tail = app_id
            .rsplit(['\\', '!', '/'])
            .next()
            .unwrap_or(app_id)
            .trim();
        if tail.is_empty() {
            String::new()
        } else {
            tail.to_string()
        }
    }

    fn derive_service_kind(app_id: &str) -> &'static str {
        if check_is_spotify(app_id) {
            return "spotify_desktop";
        }
        if is_browser_app(&app_id.to_lowercase()) {
            return "web_media";
        }
        if !app_id.trim().is_empty() {
            return "native_app";
        }
        "unknown"
    }

    // ======================================================================
    // IDENTITAS SESI YANG STABIL ANTAR POLLING
    // Objek WinRT tidak memiliki SessionId, jadi identitas dibangun dari
    // pointer IUnknown objek sesi (hanya angka pointer yang disimpan, bukan
    // referensi COM). Jika objek dibungkus ulang oleh sistem, fingerprint
    // metadata dipakai untuk memakai kembali id lama.
    // ======================================================================
    static NEXT_SESSION_ID: AtomicU64 = AtomicU64::new(1);
    static SESSION_ID_BY_PTR: LazyLock<Mutex<HashMap<usize, u64>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    static SESSION_ID_BY_FINGERPRINT: LazyLock<Mutex<HashMap<String, u64>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    const SESSION_REGISTRY_CAP: usize = 64;

    fn register_session_identity(
        session: &GlobalSystemMediaTransportControlsSession,
        fingerprint: &str,
    ) -> String {
        // Pointer identitas objek COM (transien; tidak ada referensi yang disimpan)
        let ptr = session
            .cast::<IUnknown>()
            .ok()
            .map(|u| u.as_raw() as usize)
            .unwrap_or(0);

        if ptr != 0 {
            if let Some(id) = SESSION_ID_BY_PTR
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .get(&ptr)
            {
                return format!("media-session-{}", id);
            }
        }

        // Pointer baru: cocokkan fingerprint agar id tetap stabil saat objek dibungkus ulang
        if let Some(id) = SESSION_ID_BY_FINGERPRINT
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(fingerprint)
        {
            let id = *id;
            if ptr != 0 {
                let mut by_ptr = SESSION_ID_BY_PTR.lock().unwrap_or_else(|e| e.into_inner());
                if by_ptr.len() >= SESSION_REGISTRY_CAP {
                    by_ptr.clear();
                }
                by_ptr.insert(ptr, id);
            }
            return format!("media-session-{}", id);
        }

        let id = NEXT_SESSION_ID.fetch_add(1, Ordering::Relaxed);
        {
            let mut by_fp = SESSION_ID_BY_FINGERPRINT
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            if by_fp.len() >= SESSION_REGISTRY_CAP {
                by_fp.clear();
            }
            by_fp.insert(fingerprint.to_string(), id);
        }
        if ptr != 0 {
            let mut by_ptr = SESSION_ID_BY_PTR.lock().unwrap_or_else(|e| e.into_inner());
            if by_ptr.len() >= SESSION_REGISTRY_CAP {
                by_ptr.clear();
            }
            by_ptr.insert(ptr, id);
        }
        format!("media-session-{}", id)
    }

    struct CandidateSession {
        session: GlobalSystemMediaTransportControlsSession,
        title: String,
        artist: String,
        album: String,
        source_app: String,
        source_display_name: String,
        service_kind: String,
        is_spotify: bool,
        is_playing: bool,
        session_key: String,
        record_key: String,
        has_thumbnail: bool,
        position_secs: f64,
        duration_secs: f64,
    }

    async fn extract_candidate(
        session: GlobalSystemMediaTransportControlsSession,
    ) -> Option<CandidateSession> {
        let source_app = session
            .SourceAppUserModelId()
            .map(|s| s.to_string())
            .unwrap_or_default();

        let is_playing = is_session_playing(&session);

        let media_props = if let Ok(op) = session.TryGetMediaPropertiesAsync() {
            op.await.ok()
        } else {
            None
        };

        let title = media_props
            .as_ref()
            .and_then(|p| p.Title().ok())
            .map(|s| s.to_string())
            .unwrap_or_default();

        // Abaikan sesi yang tidak memiliki judul lagu (misal tab browser kosong)
        if title.trim().is_empty() {
            return None;
        }

        let artist = media_props
            .as_ref()
            .and_then(|p| p.Artist().ok())
            .map(|s| s.to_string())
            .unwrap_or_default();

        let album = media_props
            .as_ref()
            .and_then(|p| p.AlbumTitle().ok())
            .map(|s| s.to_string())
            .unwrap_or_default();

        let track_number = media_props
            .as_ref()
            .and_then(|p| p.TrackNumber().ok())
            .unwrap_or(0);

        let has_thumbnail = media_props
            .as_ref()
            .and_then(|p| p.Thumbnail().ok())
            .map(|t| !t.as_raw().is_null())
            .unwrap_or(false);

        let is_spotify = check_is_spotify(&source_app);

        let (position_secs, duration_secs) = if let Ok(timeline) = session.GetTimelineProperties() {
            let raw_pos = timeline
                .Position()
                .map(|ts| (ts.Duration as f64) / 10_000_000.0)
                .unwrap_or(0.0)
                .max(0.0);
            let dur = timeline
                .EndTime()
                .map(|ts| (ts.Duration as f64) / 10_000_000.0)
                .unwrap_or(0.0)
                .max(0.0);

            // Sesuai dokumentasi resmi Microsoft UWP:
            // Nilai Position adalah snapshot pada saat LastUpdatedTime.
            // Saat media sedang berputar (is_playing), posisi aktual dihitung dengan menambahkan
            // durasi waktu yang berlalu sejak LastUpdatedTime ke Position snapshot.
            let current_pos = if is_playing {
                if let Ok(lut) = timeline.LastUpdatedTime() {
                    // 116_444_736_000_000_000 adalah batas waktu 1 Januari 1970 UTC dalam unit 100ns (Windows epoch: 1601)
                    if lut.UniversalTime >= 116_444_736_000_000_000i64 {
                        let now_dur = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .unwrap_or_default();
                        let now_100ns = (now_dur.as_nanos() / 100) as i64 + 116_444_736_000_000_000i64;
                        let elapsed_100ns = (now_100ns - lut.UniversalTime).max(0);
                        let elapsed_secs = (elapsed_100ns as f64) / 10_000_000.0;
                        let calculated = raw_pos + elapsed_secs;
                        if dur > 0.0 {
                            calculated.min(dur)
                        } else {
                            calculated
                        }
                    } else {
                        raw_pos
                    }
                } else {
                    raw_pos
                }
            } else {
                raw_pos
            };

            (current_pos.max(0.0), dur)
        } else {
            (0.0, 0.0)
        };

        // Identitas rekaman: membedakan dua rekaman dengan judul & artis sama
        // (beda album/versi/nomor trek/durasi) sehingga sampul dan lirik ikut berganti.
        let record_key = format!(
            "{}|{}|{}|{}|{}",
            title.trim().to_lowercase(),
            artist.trim().to_lowercase(),
            album.trim().to_lowercase(),
            track_number,
            if duration_secs > 0.0 {
                duration_secs.round() as i64
            } else {
                0
            }
        );

        let source_display_name = derive_source_display_name(&source_app);
        let service_kind = derive_service_kind(&source_app).to_string();

        // Fingerprint sesi untuk menjaga identitas stabil saat objek dibungkus ulang
        let fingerprint = format!("{}|{}", source_app, record_key);
        let session_key = register_session_identity(&session, &fingerprint);

        Some(CandidateSession {
            session,
            title,
            artist,
            album,
            source_app,
            source_display_name,
            service_kind,
            is_spotify,
            is_playing,
            session_key,
            record_key,
            has_thumbnail,
            position_secs,
            duration_secs,
        })
    }

    async fn extract_all_candidates(
        manager: &GlobalSystemMediaTransportControlsSessionManager,
    ) -> Vec<CandidateSession> {
        let mut candidates = Vec::new();

        if let Ok(sessions) = manager.GetSessions() {
            let count = sessions.Size().unwrap_or(0);
            for i in 0..count {
                if let Ok(s) = sessions.GetAt(i) {
                    if let Some(c) = extract_candidate(s).await {
                        candidates.push(c);
                    }
                }
            }
        }

        if candidates.is_empty() {
            if let Ok(current) = manager.GetCurrentSession() {
                if let Some(c) = extract_candidate(current).await {
                    candidates.push(c);
                }
            }
        }

        candidates
    }

    fn find_best_candidate(mut candidates: Vec<CandidateSession>) -> Option<CandidateSession> {
        if candidates.is_empty() {
            return None;
        }

        // Prioritas 1: Sesi Spotify yang sedang memutar (is_playing)
        if let Some(idx) = candidates
            .iter()
            .position(|c| c.is_spotify && c.is_playing)
        {
            return Some(candidates.remove(idx));
        }

        // Prioritas 2: Sesi media apapun yang sedang memutar (is_playing)
        if let Some(idx) = candidates.iter().position(|c| c.is_playing) {
            return Some(candidates.remove(idx));
        }

        // Prioritas 3: Sesi Spotify yang sedang dijeda (Paused)
        if let Some(idx) = candidates.iter().position(|c| c.is_spotify) {
            return Some(candidates.remove(idx));
        }

        // Prioritas 4: Sesi pertama yang valid
        Some(candidates.remove(0))
    }

    fn to_track(c: &CandidateSession) -> SystemMediaTrack {
        SystemMediaTrack {
            title: c.title.clone(),
            artist: c.artist.clone(),
            album: c.album.clone(),
            is_playing: c.is_playing,
            source_app: c.source_app.clone(),
            source_display_name: c.source_display_name.clone(),
            service_kind: c.service_kind.clone(),
            is_spotify: c.is_spotify,
            has_session: true,
            session_key: c.session_key.clone(),
            record_key: c.record_key.clone(),
            has_thumbnail: c.has_thumbnail,
            position_secs: c.position_secs,
            duration_secs: c.duration_secs,
        }
    }

    pub async fn get_info() -> Result<SystemMediaTrack, String> {
        let manager = match get_manager().await {
            Ok(m) => m,
            Err(_) => {
                return Ok(SystemMediaTrack::empty());
            }
        };

        let candidates = extract_all_candidates(&manager).await;
        if let Some(c) = find_best_candidate(candidates) {
            Ok(to_track(&c))
        } else {
            Ok(SystemMediaTrack::empty())
        }
    }

    // ======================================================================
    // ARTWORK DARI SESI MEDIA AKTIF (BUKAN DARI PENCARIAN LUAR)
    // Dibaca pada command terpisah agar jalur pembaruan posisi musik tidak
    // menunggu pembacaan stream gambar. Hasil dicache per identitas
    // sesi+rekaman sehingga polling tidak membaca/mengirim ulang gambar penuh.
    // ======================================================================
    struct CachedArtwork {
        data_base64: String,
        mime_type: String,
    }

    static ARTWORK_CACHE: LazyLock<Mutex<Vec<(String, CachedArtwork)>>> =
        LazyLock::new(|| Mutex::new(Vec::new()));

    fn cache_get(key: &str) -> Option<(String, String)> {
        let cache = ARTWORK_CACHE.lock().unwrap_or_else(|e| e.into_inner());
        cache
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| (v.data_base64.clone(), v.mime_type.clone()))
    }

    fn cache_put(key: String, data_base64: String, mime_type: String) {
        let mut cache = ARTWORK_CACHE.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(slot) = cache.iter_mut().find(|(k, _)| *k == key) {
            slot.1 = CachedArtwork { data_base64, mime_type };
            return;
        }
        if cache.len() >= ARTWORK_CACHE_CAP {
            cache.remove(0);
        }
        cache.push((key, CachedArtwork { data_base64, mime_type }));
    }

    fn sniff_mime(bytes: &[u8], content_type: &str) -> Option<String> {
        if let Some(ct) = content_type
            .split(';')
            .next()
            .map(|s| s.trim().to_lowercase())
            .filter(|ct| ct.starts_with("image/") && !ct.is_empty())
        {
            return Some(ct);
        }
        // Sniff signature ketika content type tidak tersedia / tidak didukung
        if bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
            return Some("image/png".to_string());
        }
        if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
            return Some("image/jpeg".to_string());
        }
        if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
            return Some("image/webp".to_string());
        }
        if bytes.starts_with(&[b'G', b'I', b'F', b'8']) {
            return Some("image/gif".to_string());
        }
        None
    }

    async fn read_thumbnail_bytes(
        thumbnail: windows::Storage::Streams::IRandomAccessStreamReference,
    ) -> Option<(Vec<u8>, String)> {
        let open_op = thumbnail.OpenReadAsync().ok()?;
        let stream = open_op.await.ok()?;
        let content_type = stream
            .ContentType()
            .map(|s| s.to_string())
            .unwrap_or_default();
        let size = stream.Size().unwrap_or(0);

        // Thumbnail kosong atau terlalu besar: jangan kirim, fallback ke placeholder
        if size == 0 || size as usize > MAX_ARTWORK_BYTES {
            return None;
        }

        let raw_stream = stream.cast::<IRandomAccessStream>().ok()?;
        let reader = DataReader::CreateDataReader(&raw_stream).ok()?;
        let loaded: u32 = reader.LoadAsync(size as u32).ok()?.await.ok()?;
        if loaded == 0 {
            return None;
        }
        let mut bytes = vec![0u8; loaded as usize];
        reader.ReadBytes(&mut bytes).ok()?;
        let _ = reader.Close();

        let mime = sniff_mime(&bytes, &content_type)?;
        Some((bytes, mime))
    }

    pub async fn get_artwork(
        session_key: String,
        record_key: String,
    ) -> Result<Option<SystemMediaArtwork>, String> {
        let manager = get_manager().await?;
        let candidates = extract_all_candidates(&manager).await;

        // Terapkan hanya pada sesi yang sama dengan yang diminta frontend
        let candidate = match candidates.iter().find(|c| c.session_key == session_key) {
            Some(c) => c,
            None => return Ok(None),
        };

        // Rekaman sudah berganti sejak permintaan dikirim: jangan kembalikan gambar lama
        if candidate.record_key != record_key {
            return Ok(None);
        }

        let artwork_key = format!("{}#{}", session_key, record_key);

        if let Some((data_base64, mime_type)) = cache_get(&artwork_key) {
            return Ok(Some(SystemMediaArtwork {
                session_key: candidate.session_key.clone(),
                record_key: candidate.record_key.clone(),
                artwork_key,
                data_base64,
                mime_type,
            }));
        }

        // Ambil media properties lalu thumbnail referensinya (hemat, tanpa membaca stream)
        let media_props = match candidate.session.TryGetMediaPropertiesAsync() {
            Ok(op) => op.await.ok(),
            Err(_) => None,
        };

        let thumbnail = match media_props.and_then(|p| p.Thumbnail().ok()) {
            Some(t) if !t.as_raw().is_null() => t,
            _ => return Ok(None),
        };

        let (bytes, mime_type) = match read_thumbnail_bytes(thumbnail).await {
            Some(v) => v,
            None => return Ok(None),
        };

        let data_base64 = BASE64_STANDARD.encode(&bytes);
        cache_put(artwork_key.clone(), data_base64.clone(), mime_type.clone());

        Ok(Some(SystemMediaArtwork {
            session_key: candidate.session_key.clone(),
            record_key: candidate.record_key.clone(),
            artwork_key,
            data_base64,
            mime_type,
        }))
    }

    /**
     * Memilih sesi untuk perintah kontrol. Bila frontend mengirim session_key,
     * HANYA sesi itu yang boleh dikendalikan agar kontrol selalu konsisten
     * dengan sesi yang ditampilkan. Tanpa session_key, pilihan terbaik dipakai.
     */
    fn pick_controlled_candidate(
        candidates: Vec<CandidateSession>,
        session_key: &Option<String>,
    ) -> Option<CandidateSession> {
        match session_key {
            Some(key) if !key.trim().is_empty() => candidates
                .into_iter()
                .find(|c| &c.session_key == key),
            _ => find_best_candidate(candidates),
        }
    }

    pub async fn toggle_play_pause(session_key: Option<String>) -> Result<bool, String> {
        let manager = get_manager().await?;
        let candidates = extract_all_candidates(&manager).await;
        if let Some(c) = pick_controlled_candidate(candidates, &session_key) {
            let op = c
                .session
                .TryTogglePlayPauseAsync()
                .map_err(|e| e.to_string())?;
            let success = op.await.map_err(|e| e.to_string())?;
            Ok(success)
        } else if session_key.is_some() {
            // Sesi yang tampil sudah tidak aktif: tolak alih-alih mengendalikan sesi lain
            Err("Sesi media yang ditampilkan sudah tidak aktif".to_string())
        } else {
            Err("Tidak ada sesi media yang sedang aktif".to_string())
        }
    }

    pub async fn skip_next(session_key: Option<String>) -> Result<bool, String> {
        let manager = get_manager().await?;
        let candidates = extract_all_candidates(&manager).await;
        if let Some(c) = pick_controlled_candidate(candidates, &session_key) {
            let op = c.session.TrySkipNextAsync().map_err(|e| e.to_string())?;
            let success = op.await.map_err(|e| e.to_string())?;
            Ok(success)
        } else if session_key.is_some() {
            Err("Sesi media yang ditampilkan sudah tidak aktif".to_string())
        } else {
            Err("Tidak ada sesi media yang sedang aktif".to_string())
        }
    }

    pub async fn skip_prev(session_key: Option<String>) -> Result<bool, String> {
        let manager = get_manager().await?;
        let candidates = extract_all_candidates(&manager).await;
        if let Some(c) = pick_controlled_candidate(candidates, &session_key) {
            let op = c
                .session
                .TrySkipPreviousAsync()
                .map_err(|e| e.to_string())?;
            let success = op.await.map_err(|e| e.to_string())?;
            Ok(success)
        } else if session_key.is_some() {
            Err("Sesi media yang ditampilkan sudah tidak aktif".to_string())
        } else {
            Err("Tidak ada sesi media yang sedang aktif".to_string())
        }
    }

    pub async fn seek_to(
        position_secs: f64,
        session_key: Option<String>,
        record_key: Option<String>,
    ) -> Result<bool, String> {
        let manager = get_manager().await?;
        let candidates = extract_all_candidates(&manager).await;
        if let Some(c) = pick_controlled_candidate(candidates, &session_key) {
            // Seek terkait rekaman: tolak bila rekaman sudah berganti sejak
            // permintaan dikirim agar posisi tidak ditulis ke lagu yang salah
            if let Some(requested) = record_key {
                if !requested.trim().is_empty() && c.record_key != requested {
                    return Err("Rekaman sudah berganti; posisi tidak diubah".to_string());
                }
            }
            let pos_100ns = (position_secs * 10_000_000.0).round() as i64;
            let op = c
                .session
                .TryChangePlaybackPositionAsync(pos_100ns)
                .map_err(|e| e.to_string())?;
            let success = op.await.map_err(|e| e.to_string())?;
            Ok(success)
        } else if session_key.is_some() {
            Err("Sesi media yang ditampilkan sudah tidak aktif".to_string())
        } else {
            Err("Tidak ada sesi media yang sedang aktif".to_string())
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod non_win_media {
    use super::{SystemMediaArtwork, SystemMediaTrack};

    pub async fn get_info() -> Result<SystemMediaTrack, String> {
        Ok(SystemMediaTrack::empty())
    }

    pub async fn get_artwork(
        _session_key: String,
        _record_key: String,
    ) -> Result<Option<SystemMediaArtwork>, String> {
        Ok(None)
    }

    pub async fn toggle_play_pause(_session_key: Option<String>) -> Result<bool, String> {
        Err("Sistem media belum didukung pada platform ini".to_string())
    }

    pub async fn skip_next(_session_key: Option<String>) -> Result<bool, String> {
        Err("Sistem media belum didukung pada platform ini".to_string())
    }

    pub async fn skip_prev(_session_key: Option<String>) -> Result<bool, String> {
        Err("Sistem media belum didukung pada platform ini".to_string())
    }

    pub async fn seek_to(
        _position_secs: f64,
        _session_key: Option<String>,
        _record_key: Option<String>,
    ) -> Result<bool, String> {
        Err("Sistem media belum didukung pada platform ini".to_string())
    }
}

#[tauri::command]
pub async fn get_system_media_track() -> Result<SystemMediaTrack, String> {
    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(|| {
            tauri::async_runtime::block_on(async {
                win_media::get_info().await
            })
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "windows"))]
    {
        non_win_media::get_info().await
    }
}

#[tauri::command]
pub async fn get_system_media_artwork(
    session_key: String,
    record_key: String,
) -> Result<Option<SystemMediaArtwork>, String> {
    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            tauri::async_runtime::block_on(async move {
                win_media::get_artwork(session_key, record_key).await
            })
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "windows"))]
    {
        non_win_media::get_artwork(session_key, record_key).await
    }
}

#[tauri::command]
pub async fn system_media_toggle_play(session_key: Option<String>) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            tauri::async_runtime::block_on(async move {
                win_media::toggle_play_pause(session_key).await
            })
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "windows"))]
    {
        non_win_media::toggle_play_pause(session_key).await
    }
}

#[tauri::command]
pub async fn system_media_next(session_key: Option<String>) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            tauri::async_runtime::block_on(async move {
                win_media::skip_next(session_key).await
            })
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "windows"))]
    {
        non_win_media::skip_next(session_key).await
    }
}

#[tauri::command]
pub async fn system_media_prev(session_key: Option<String>) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            tauri::async_runtime::block_on(async move {
                win_media::skip_prev(session_key).await
            })
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "windows"))]
    {
        non_win_media::skip_prev(session_key).await
    }
}

#[tauri::command]
pub async fn system_media_seek(
    position_secs: f64,
    session_key: Option<String>,
    record_key: Option<String>,
) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            tauri::async_runtime::block_on(async move {
                win_media::seek_to(position_secs, session_key, record_key).await
            })
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "windows"))]
    {
        non_win_media::seek_to(position_secs, session_key, record_key).await
    }
}
