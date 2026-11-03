#[cfg(target_os = "windows")]
fn endpoint_volume(value: Option<f32>) -> Result<f32, String> {
    std::thread::spawn(move || {
        use windows::Win32::Media::Audio::{eMultimedia, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
        use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
        use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED};
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED).ok().map_err(|e| e.to_string())?;
            let result = (|| -> windows::core::Result<f32> {
                let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
                let device = enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia)?;
                let volume: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None)?;
                if let Some(value) = value {
                    volume.SetMasterVolumeLevelScalar(value, std::ptr::null())?;
                    volume.SetMute(value == 0.0, std::ptr::null())?;
                }
                if volume.GetMute()?.as_bool() { Ok(0.0) } else { volume.GetMasterVolumeLevelScalar() }
            })();
            CoUninitialize();
            result.map_err(|e| e.to_string())
        }
    }).join().map_err(|_| "Pengaturan volume gagal".to_string())?
}

#[cfg(not(target_os = "windows"))]
fn endpoint_volume(_value: Option<f32>) -> Result<f32, String> {
    Err("Volume perangkat hanya tersedia di Windows".to_string())
}

#[tauri::command]
pub fn get_device_volume() -> Result<f32, String> { endpoint_volume(None) }

#[tauri::command]
pub fn set_device_volume(volume: f32) -> Result<f32, String> {
    if !volume.is_finite() || !(0.0..=1.0).contains(&volume) {
        return Err("Volume harus berada di antara 0 dan 1".to_string());
    }
    endpoint_volume(Some(volume))
}

#[cfg(test)]
mod tests {
    #[test]
    fn invalid_volume_never_reaches_device() {
        for value in [f32::NAN, f32::INFINITY, -0.1, 1.1] {
            assert!(super::set_device_volume(value).is_err());
        }
    }

    #[test]
    #[ignore = "Memerlukan perangkat audio Windows"]
    fn read_real_device_volume() {
        let value = super::get_device_volume().expect("Perangkat audio harus dapat dibaca");
        assert!((0.0..=1.0).contains(&value));
    }
}
