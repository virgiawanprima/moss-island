import { isTauri } from './storage';

/**
 * Layanan Startup Otomatis (Tauri 2 Autostart Plugin)
 * Mengelola pendaftaran aplikasi untuk dimulai otomatis saat pengguna login desktop
 * pada Windows dan Linux.
 */
export async function isAutostartEnabled(): Promise<boolean | null> {
  if (!isTauri()) return null;
  try {
    const { isEnabled } = await import('@tauri-apps/plugin-autostart');
    return await isEnabled();
  } catch {
    return null;
  }
}

export async function setAutostartEnabled(enabled: boolean): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const { enable, disable } = await import('@tauri-apps/plugin-autostart');
    if (enabled) {
      await enable();
    } else {
      await disable();
    }
    return true;
  } catch (err) {
    console.error('Gagal mengatur autostart:', err);
    return false;
  }
}
