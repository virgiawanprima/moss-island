import { isTauri } from './storage';

/**
 * Layanan Notifikasi Desktop Native (Tauri 2 Notification Plugin + Web Notification Fallback)
 * Mengirim notifikasi sistem operasi saat fokus selesai atau waktu hidrasi tiba,
 * terutama saat Dynamic Island berada di mode hidden atau compact.
 */
export async function sendDesktopNotification(title: string, body: string): Promise<void> {
  if (isTauri()) {
    try {
      const { isPermissionGranted, requestPermission, sendNotification } = await import('@tauri-apps/plugin-notification');
      let granted = await isPermissionGranted();
      if (!granted) {
        const permission = await requestPermission();
        granted = permission === 'granted';
      }
      if (granted) {
        sendNotification({
          title,
          body,
        });
        return;
      }
    } catch (err) {
      console.warn('Gagal memanggil Tauri notification plugin, mencoba web fallback:', err);
    }
  }

  // Web Notification fallback untuk mode pratinjau browser
  if (typeof window !== 'undefined' && 'Notification' in window) {
    try {
      if (Notification.permission === 'granted') {
        new Notification(title, {
          body,
          icon: '/icons/128x128.png',
        });
      } else if (Notification.permission !== 'denied') {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          new Notification(title, {
            body,
            icon: '/icons/128x128.png',
          });
        }
      }
    } catch (_e) {
      // Abaikan jika browser memblokir notifikasi
    }
  }
}

export async function initNotificationPermissions(): Promise<boolean> {
  if (isTauri()) {
    try {
      const { isPermissionGranted, requestPermission } = await import('@tauri-apps/plugin-notification');
      let granted = await isPermissionGranted();
      if (!granted) {
        const permission = await requestPermission();
        granted = permission === 'granted';
      }
      return granted;
    } catch {
      return false;
    }
  }
  return false;
}
