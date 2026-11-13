import { isTauri } from '@tauri-apps/api/core';

if (
  import.meta.env.PROD &&
  !isTauri() &&
  'serviceWorker' in navigator
) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, {
        scope: import.meta.env.BASE_URL,
      })
      .catch((error: unknown) => {
        console.error('تعذر تفعيل وضع العمل دون اتصال.', error);
      });
  });
}
