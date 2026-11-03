use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

static RUNNING: AtomicBool = AtomicBool::new(false);
static GENERATION: AtomicU64 = AtomicU64::new(0);
static BEATS: AtomicU64 = AtomicU64::new(0);

#[tauri::command]
pub fn stop_speaker_beat() {
    RUNNING.store(false, Ordering::SeqCst);
    GENERATION.fetch_add(1, Ordering::SeqCst);
}

#[tauri::command]
pub fn speaker_beat_count() -> Result<u64, String> {
    if !RUNNING.load(Ordering::SeqCst) { return Err("Analisis output berhenti".into()); }
    Ok(BEATS.load(Ordering::Relaxed))
}

#[tauri::command]
pub fn start_speaker_beat() -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    { Err("Analisis output hanya tersedia di Windows".into()) }
    #[cfg(target_os = "windows")]
    {
        if RUNNING.swap(true, Ordering::SeqCst) { return Ok(()); }
        let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        std::thread::spawn(move || {
            let result = capture(generation, &tx);
            if let Err(error) = result { let _ = tx.try_send(Err(error)); }
            if GENERATION.load(Ordering::SeqCst) == generation { RUNNING.store(false, Ordering::SeqCst); }
        });
        rx.recv_timeout(std::time::Duration::from_secs(5)).map_err(|_| {
            stop_speaker_beat();
            "Perangkat output tidak merespons".to_string()
        })?
    }
}

#[cfg(target_os = "windows")]
fn capture(generation: u64, ready: &std::sync::mpsc::SyncSender<Result<(), String>>) -> Result<(), String> {
    use std::collections::VecDeque;
    use wasapi::{DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat};
    wasapi::initialize_mta().ok().map_err(|e| e.to_string())?;
    let result = (|| -> Result<(), String> {
        let enumerator = DeviceEnumerator::new().map_err(|e| e.to_string())?;
        let device = enumerator.get_default_device(&Direction::Render).map_err(|e| e.to_string())?;
        let device_id = device.get_id().map_err(|e| e.to_string())?;
        let mut client = device.get_iaudioclient().map_err(|e| e.to_string())?;
        let format = WaveFormat::new(32, 32, &SampleType::Float, 44100, 2, None);
        let (_, min_time) = client.get_device_period().map_err(|e| e.to_string())?;
        client.initialize_client(&format, &Direction::Capture,
            &StreamMode::EventsShared { autoconvert: true, buffer_duration_hns: min_time })
            .map_err(|e| e.to_string())?;
        let event = client.set_get_eventhandle().map_err(|e| e.to_string())?;
        let input = client.get_audiocaptureclient().map_err(|e| e.to_string())?;
        client.start_stream().map_err(|e| e.to_string())?;
        let _ = ready.try_send(Ok(()));
        let mut bytes = VecDeque::new();
        let mut baseline = 0.0_f32;
        let mut last = std::time::Instant::now() - std::time::Duration::from_secs(1);
        let mut last_device_check = std::time::Instant::now();
        while RUNNING.load(Ordering::SeqCst) && GENERATION.load(Ordering::SeqCst) == generation {
            if last_device_check.elapsed() >= std::time::Duration::from_secs(2) {
                let current_id = enumerator.get_default_device(&Direction::Render)
                    .and_then(|current| current.get_id()).map_err(|e| e.to_string())?;
                if current_id != device_id { return Err("Perangkat output berubah".into()); }
                last_device_check = std::time::Instant::now();
            }
            if event.wait_for_event(250).is_err() { continue; }
            input.read_from_device_to_deque(&mut bytes).map_err(|e| e.to_string())?;
            let samples: Vec<u8> = bytes.drain(..).collect();
            let mut energy = 0.0_f32;
            let mut count = 0;
            for chunk in samples.as_chunks::<4>().0 {
                let value = f32::from_le_bytes(*chunk);
                if value.is_finite() { energy += value * value; count += 1; }
            }
            if count == 0 { continue; }
            let level = (energy / count as f32).sqrt();
            let beat = level > 0.015 && level > baseline * 1.55 + 0.008 && last.elapsed().as_millis() >= 280;
            baseline = baseline * 0.92 + level * 0.08;
            if beat { BEATS.fetch_add(1, Ordering::Relaxed); last = std::time::Instant::now(); }
        }
        client.stop_stream().map_err(|e| e.to_string())?;
        Ok(())
    })();
    wasapi::deinitialize();
    result
}
