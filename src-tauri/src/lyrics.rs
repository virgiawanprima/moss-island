use serde::Serialize;
use std::sync::LazyLock;
use std::time::Duration;

static CLIENT: LazyLock<Result<reqwest::Client, reqwest::Error>> = LazyLock::new(|| {
    reqwest::Client::builder()
        .user_agent("MossIsland/0.1.0")
        .timeout(Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::none())
        .build()
});

#[derive(Serialize)]
pub struct LyricsResponse {
    status: u16,
    body: serde_json::Value,
    retry_after: Option<String>,
}

#[tauri::command]
pub async fn fetch_lyrics(
    endpoint: String,
    params: Vec<(String, String)>,
) -> Result<LyricsResponse, String> {
    if !["get", "search"].contains(&endpoint.as_str()) || params.len() > 5 {
        return Err("Permintaan lirik tidak valid".into());
    }
    let allowed = ["track_name", "artist_name", "album_name", "duration", "q"];
    if params.iter().any(|(key, value)| !allowed.contains(&key.as_str()) || value.len() > 1000) {
        return Err("Parameter lirik tidak valid".into());
    }
    let client = CLIENT.as_ref().map_err(|e| e.to_string())?;
    let mut response = client.get(format!("https://lrclib.net/api/{endpoint}"))
        .query(&params).send().await.map_err(|e| format!("LRCLIB: {e}"))?;
    let status = response.status().as_u16();
    let retry_after = response.headers().get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok()).map(str::to_string);
    if status != 200 {
        return Ok(LyricsResponse { status, body: serde_json::Value::Null, retry_after });
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > 1_000_000 {
            return Err("Respons lirik terlalu besar".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let body = serde_json::from_slice(&bytes).map_err(|e| format!("Respons LRCLIB tidak valid: {e}"))?;
    Ok(LyricsResponse { status, body, retry_after })
}

#[cfg(test)]
mod tests {
    use super::fetch_lyrics;

    #[test]
    fn rejects_arbitrary_endpoints_and_parameters_before_network() {
        tauri::async_runtime::block_on(async {
            assert!(fetch_lyrics("https://example.com".into(), vec![]).await.is_err());
            assert!(fetch_lyrics("../get".into(), vec![]).await.is_err());
            assert!(fetch_lyrics("get".into(), vec![("url".into(), "https://example.com".into())]).await.is_err());
            assert!(fetch_lyrics("get".into(), vec![("q".into(), "x".repeat(1001))]).await.is_err());
        });
    }

    #[test]
    #[ignore = "Memerlukan koneksi LRCLIB"]
    fn live_lrclib_transport() {
        tauri::async_runtime::block_on(async {
            let response = fetch_lyrics("search".into(), vec![
                ("track_name".into(), "Yellow".into()),
                ("artist_name".into(), "Coldplay".into()),
            ]).await.expect("Permintaan native LRCLIB gagal");
            assert_eq!(response.status, 200, "Status LRCLIB: {}", response.status);
            let records = response.body.as_array().expect("Respons search bukan array");
            assert!(!records.is_empty(), "Pencarian pembanding tidak memiliki hasil");
            println!("Native LRCLIB HTTP 200, {} kandidat", records.len());
        });
    }

    #[test]
    #[ignore = "Memerlukan sesi media aktif dan koneksi LRCLIB"]
    fn live_active_session_lookup() {
        tauri::async_runtime::block_on(async {
            let track = crate::media::get_system_media_track(None).await.expect("Gagal membaca sesi media");
            if !track.has_session {
                println!("Tidak ada sesi media aktif untuk diagnosis lirik");
                return;
            }
            println!("Sesi: {} | {} | {} | album={} | {} detik", track.source_display_name, track.title, track.artist, track.album, track.duration_secs);
            if track.duration_secs > 0.0 {
                let precise = fetch_lyrics("get".into(), vec![
                    ("track_name".into(), track.title.clone()), ("artist_name".into(), track.artist.clone()),
                    ("duration".into(), track.duration_secs.round().to_string()),
                ]).await.expect("Lookup presisi LRCLIB gagal");
                println!("Lookup presisi tanpa album: HTTP {}, durasi={}, sinkron={}", precise.status,
                    precise.body["duration"], precise.body["syncedLyrics"].as_str().is_some_and(|s| !s.is_empty()));
            }
            let params = vec![("track_name".into(), track.title.clone()), ("artist_name".into(), track.artist.clone())];
            let response = fetch_lyrics("search".into(), params).await.expect("Pencarian LRCLIB gagal");
            println!("LRCLIB HTTP {}", response.status);
            if let Some(records) = response.body.as_array() {
                for record in records.iter().take(5) {
                    println!("Kandidat: {} | {} | {} | sinkron={} biasa={}",
                        record["trackName"], record["artistName"], record["duration"],
                        record["syncedLyrics"].as_str().is_some_and(|s| !s.is_empty()),
                        record["plainLyrics"].as_str().is_some_and(|s| !s.is_empty()));
                }
                println!("Total kandidat: {}", records.len());
            }
        });
    }
}
