/**
 * PWA Utilities for Luke
 * Provides helpers for standalone detection and future push notifications.
 */

/**
 * Checks if the app is running in standalone mode (installed as PWA).
 */
export const isStandalone = (): boolean => {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone ||
    document.referrer.includes('android-app://')
  );
};

/**
 * Request permission for notifications (Placeholder for future V2 feature).
 */
export const requestNotificationPermission = async () => {
  if (!('Notification' in window)) {
    console.warn('This browser does not support notifications.');
    return 'unsupported';
  }

  const permission = await Notification.requestPermission();
  return permission;
};

/**
 * Get current location (Placeholder for future location-aware travel features).
 */
export const getCurrentLocation = (): Promise<GeolocationPosition> => {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by your browser'));
    } else {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 0,
      });
    }
  });
};
