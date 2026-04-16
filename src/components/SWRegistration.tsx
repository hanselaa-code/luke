'use client';

import { useEffect } from 'react';

export default function SWRegistration() {
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      const registerSW = async () => {
        try {
          const registration = await navigator.serviceWorker.register('/sw.js');
          console.log('[SW] Registration successful:', registration.scope);
        } catch (error) {
          console.error('[SW] Registration failed:', error);
        }
      };

      // Only register on production or if you want to test locally
      if (process.env.NODE_ENV === 'production' || window.location.hostname === 'localhost') {
        registerSW();
      }
    }
  }, []);

  return null;
}
