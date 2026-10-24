use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, LogicalSize, Manager, PhysicalPosition, Position, Size};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

static ANIMATION_TOKEN: AtomicU64 = AtomicU64::new(0);
static IS_ANIMATING: AtomicBool = AtomicBool::new(false);
/// Token milik animasi yang sedang aktif; dipakai agar guard animasi lama
/// tidak mematikan status animasi milik pemanggil yang lebih baru.
static ANIMATION_OWNER_TOKEN: AtomicU64 = AtomicU64::new(0);

struct AnimationGuard {
    owner_token: u64,
}
impl Drop for AnimationGuard {
    fn drop(&mut self) {
        // Hanya animasi pemilik token terkini yang boleh mengubah status
        if ANIMATION_OWNER_TOKEN.load(Ordering::SeqCst) == self.owner_token {
            IS_ANIMATING.store(false, Ordering::SeqCst);
        }
    }
}

fn set_window_geometry(
    window: &tauri::Window,
    logical_w: f64,
    logical_h: f64,
    phys_x: i32,
    phys_y: i32,
    scale_factor: f64,
) {
    #[cfg(target_os = "windows")]
    {
        if let Ok(hwnd) = window.hwnd() {
            let phys_w = (logical_w * scale_factor).round() as i32;
            let phys_h = (logical_h * scale_factor).round() as i32;
            const SWP_NOZORDER: u32 = 0x0004;
            const SWP_NOACTIVATE: u32 = 0x0010;
            unsafe extern "system" {
                fn SetWindowPos(
                    hwnd: *mut std::ffi::c_void,
                    hwnd_insert_after: *mut std::ffi::c_void,
                    x: i32,
                    y: i32,
                    cx: i32,
                    cy: i32,
                    flags: u32,
                ) -> i32;
            }
            unsafe {
                SetWindowPos(
                    hwnd.0,
                    std::ptr::null_mut(),
                    phys_x,
                    phys_y,
                    phys_w,
                    phys_h,
                    SWP_NOZORDER | SWP_NOACTIVATE,
                );
            }
            return;
        }
    }

    let _ = window.set_size(Size::Logical(LogicalSize::new(logical_w, logical_h)));
    let _ = window.set_position(Position::Physical(PhysicalPosition::new(phys_x, phys_y)));
}

#[tauri::command]
fn set_island_window_size(
    window: tauri::Window,
    width: f64,
    height: f64,
    min_width: Option<f64>,
    min_height: Option<f64>,
    resizable: Option<bool>,
) -> Result<(), String> {
    // Batalkan animasi berjalan jika ada
    ANIMATION_TOKEN.fetch_add(1, Ordering::SeqCst);
    IS_ANIMATING.store(false, Ordering::SeqCst);

    if let Some(r) = resizable {
        let _ = window.set_resizable(r);
    }

    if let (Some(mw), Some(mh)) = (min_width, min_height) {
        let _ = window.set_min_size(Some(Size::Logical(LogicalSize::new(mw, mh))));
    } else {
        let _ = window.set_min_size(None::<Size>);
    }
    window
        .set_size(Size::Logical(LogicalSize::new(width, height)))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn animate_island_window(
    window: tauri::Window,
    target_width: f64,
    target_height: f64,
    duration_ms: Option<u64>,
    y_offset: Option<f64>,
    resizable: Option<bool>,
    min_width: Option<f64>,
    min_height: Option<f64>,
) -> Result<(), String> {
    // Token unik untuk mendeteksi pembatalan animasi oleh pemanggilan baru
    let current_token = ANIMATION_TOKEN.fetch_add(1, Ordering::SeqCst) + 1;
    ANIMATION_OWNER_TOKEN.store(current_token, Ordering::SeqCst);

    let offset_y = y_offset.unwrap_or(0.0);
    let dur = duration_ms.unwrap_or(200);

    let monitor = match window.current_monitor() {
        Ok(Some(m)) => m,
        _ => {
            if let Some(r) = resizable {
                let _ = window.set_resizable(r);
            }
            if let (Some(mw), Some(mh)) = (min_width, min_height) {
                let _ = window.set_min_size(Some(Size::Logical(LogicalSize::new(mw, mh))));
            } else {
                let _ = window.set_min_size(None::<Size>);
            }
            let _ = window.set_size(Size::Logical(LogicalSize::new(target_width, target_height)));
            return Ok(());
        }
    };

    let monitor_size = monitor.size();
    let monitor_pos = monitor.position();
    let scale_factor = monitor.scale_factor();

    // Jika durasi 0 (misal: prefers-reduced-motion aktif), langsung terapkan ukuran dan posisi target seketika tanpa jeda langkah
    if dur == 0 {
        if let Some(r) = resizable {
            let _ = window.set_resizable(r);
        }
        if let (Some(mw), Some(mh)) = (min_width, min_height) {
            let _ = window.set_min_size(Some(Size::Logical(LogicalSize::new(mw, mh))));
        } else {
            let _ = window.set_min_size(None::<Size>);
        }
        let final_x = monitor_pos.x as f64 + ((monitor_size.width as f64 - (target_width * scale_factor)) / 2.0);
        let final_y = monitor_pos.y as f64 + (offset_y * scale_factor);
        set_window_geometry(
            &window,
            target_width,
            target_height,
            final_x.round() as i32,
            final_y.round() as i32,
            scale_factor,
        );
        return Ok(());
    }

    let start_size = window.outer_size().unwrap_or_default();
    let start_logical_w = (start_size.width as f64) / scale_factor;
    let start_logical_h = (start_size.height as f64) / scale_factor;

    // Jika ukuran saat ini sudah sangat dekat dengan target, langsung terapkan
    if (start_logical_w - target_width).abs() < 2.0 && (start_logical_h - target_height).abs() < 2.0 {
        if let Some(r) = resizable {
            let _ = window.set_resizable(r);
        }
        if let (Some(mw), Some(mh)) = (min_width, min_height) {
            let _ = window.set_min_size(Some(Size::Logical(LogicalSize::new(mw, mh))));
        } else {
            let _ = window.set_min_size(None::<Size>);
        }
        let final_x = monitor_pos.x as f64 + ((monitor_size.width as f64 - (target_width * scale_factor)) / 2.0);
        let final_y = monitor_pos.y as f64 + (offset_y * scale_factor);
        set_window_geometry(
            &window,
            target_width,
            target_height,
            final_x.round() as i32,
            final_y.round() as i32,
            scale_factor,
        );
        return Ok(());
    }

    IS_ANIMATING.store(true, Ordering::SeqCst);
    let _guard = AnimationGuard { owner_token: current_token };

    // Bebaskan batas ukuran minimum sementara agar animasi perubahan ukuran dapat berjalan mulus
    let _ = window.set_min_size(None::<Size>);

    let steps = 14;
    let step_delay = (dur / steps).max(8);

    for step in 1..=steps {
        if ANIMATION_TOKEN.load(Ordering::SeqCst) != current_token {
            return Ok(());
        }

        let t = step as f64 / steps as f64;
        let ease = 1.0 - (1.0 - t).powi(3);

        let curr_w = start_logical_w + (target_width - start_logical_w) * ease;
        let curr_h = start_logical_h + (target_height - start_logical_h) * ease;

        let curr_x = monitor_pos.x as f64 + ((monitor_size.width as f64 - (curr_w * scale_factor)) / 2.0);
        let curr_y = monitor_pos.y as f64 + (offset_y * scale_factor);

        set_window_geometry(
            &window,
            curr_w,
            curr_h,
            curr_x.round() as i32,
            curr_y.round() as i32,
            scale_factor,
        );

        tokio::time::sleep(tokio::time::Duration::from_millis(step_delay)).await;
        if ANIMATION_TOKEN.load(Ordering::SeqCst) != current_token {
            return Ok(());
        }
    }

    if ANIMATION_TOKEN.load(Ordering::SeqCst) != current_token {
        return Ok(());
    }

    if let Some(r) = resizable {
        let _ = window.set_resizable(r);
    }
    if let (Some(mw), Some(mh)) = (min_width, min_height) {
        let _ = window.set_min_size(Some(Size::Logical(LogicalSize::new(mw, mh))));
    } else {
        let _ = window.set_min_size(None::<Size>);
    }

    let final_x = monitor_pos.x as f64 + ((monitor_size.width as f64 - (target_width * scale_factor)) / 2.0);
    let final_y = monitor_pos.y as f64 + (offset_y * scale_factor);
    set_window_geometry(
        &window,
        target_width,
        target_height,
        final_x.round() as i32,
        final_y.round() as i32,
        scale_factor,
    );

    Ok(())
}

#[tauri::command]
fn position_island_top_center(window: tauri::Window, y_offset: Option<f64>) -> Result<(), String> {
    if IS_ANIMATING.load(Ordering::SeqCst) {
        return Ok(());
    }
    let offset_y = y_offset.unwrap_or(0.0);
    if let Ok(Some(monitor)) = window.current_monitor() {
        let monitor_size = monitor.size();
        let monitor_pos = monitor.position();
        let scale_factor = monitor.scale_factor();
        let win_size = window.outer_size().unwrap_or_default();

        let target_x = monitor_pos.x as f64 + ((monitor_size.width as f64 - win_size.width as f64) / 2.0);
        let target_y = monitor_pos.y as f64 + (offset_y * scale_factor);

        let _ = window.set_position(Position::Physical(PhysicalPosition::new(
            target_x.round() as i32,
            target_y.round() as i32,
        )));
    }
    Ok(())
}

#[tauri::command]
fn snap_to_top_center(window: tauri::Window) -> Result<(), String> {
    if let Ok(Some(monitor)) = window.current_monitor() {
        let monitor_size = monitor.size();
        let monitor_pos = monitor.position();
        let win_size = window.outer_size().unwrap_or_default();

        let target_x = monitor_pos.x as f64 + ((monitor_size.width as f64 - win_size.width as f64) / 2.0);
        let target_y = monitor_pos.y as f64; // Tepat pada bezel atas monitor tanpa celah

        let _ = window.set_position(Position::Physical(PhysicalPosition::new(
            target_x.round() as i32,
            target_y.round() as i32,
        )));
    }
    Ok(())
}

#[tauri::command]
fn set_always_on_top(window: tauri::Window, always_on_top: bool) -> Result<(), String> {
    window
        .set_always_on_top(always_on_top)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn minimize_app(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
fn close_app(app_handle: tauri::AppHandle) {
    app_handle.exit(0);
}

mod media;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            // System Tray Menu & Event
            let show_item = MenuItem::with_id(app, "show", "Tampilkan Moss Island", true, None::<&str>)?;
            let hide_item = MenuItem::with_id(app, "hide", "Sembunyikan ke Notch", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Keluar dari Moss Island", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &hide_item, &quit_item])?;

            if let Some(icon) = app.default_window_icon() {
                let _tray = TrayIconBuilder::new()
                    .icon(icon.clone())
                    .menu(&tray_menu)
                    .tooltip("Moss Island")
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| {
                        match event.id.as_ref() {
                            "show" => {
                                if let Some(window) = app.get_webview_window("main") {
                                    let _ = window.unminimize();
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                    let _ = window.emit("tray-show", ());
                                }
                            }
                            "hide" => {
                                if let Some(window) = app.get_webview_window("main") {
                                    let _ = window.emit("tray-hide", ());
                                }
                            }
                            "quit" => {
                                app.exit(0);
                            }
                            _ => {}
                        }
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.unminimize();
                                let _ = window.show();
                                let _ = window.set_focus();
                                let _ = window.emit("tray-toggle", ());
                            }
                        }
                    })
                    .build(app)?;
            }

            // Shortcut Keyboard Global: CmdOrCtrl+Shift+M
            let shortcut = "CmdOrCtrl+Shift+M".parse::<Shortcut>();
            if let Ok(sc) = shortcut {
                let _ = app.global_shortcut().on_shortcut(sc, |app, _sc, event| {
                    if event.state == ShortcutState::Pressed {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                            let _ = window.emit("toggle-island-state", ());
                        }
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_island_window_size,
            animate_island_window,
            position_island_top_center,
            snap_to_top_center,
            set_always_on_top,
            minimize_app,
            close_app,
            media::get_system_media_track,
            media::get_system_media_artwork,
            media::system_media_toggle_play,
            media::system_media_next,
            media::system_media_prev,
            media::system_media_seek
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
