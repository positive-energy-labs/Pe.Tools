import { HOST_READ_WAIT_S } from "./waits";

/** Runs from SSR HTML even when a static route import prevents React from hydrating. */
export const startupWatch = `(() => {
  let reason = '';
  const failed = event => { reason = event.reason?.message || event.message || 'A page module failed to load.'; };
  window.addEventListener('error', failed, true);
  window.addEventListener('unhandledrejection', failed);
  const timer = setTimeout(() => {
    const root = document.querySelector('[data-startup]');
    if (!root) return;
    root.removeAttribute('data-working');
    root.setAttribute('aria-busy', 'false');
    const status = root.querySelector('[role=status]');
    if (status) {
      status.setAttribute('role', 'alert');
      status.textContent = reason || 'Page startup did not finish after ${HOST_READ_WAIT_S}s. A page module may be unavailable.';
      const retry = document.createElement('a');
      retry.href = location.href;
      retry.textContent = 'Reload page';
      status.after(retry);
    }
  }, ${HOST_READ_WAIT_S * 1000});
  window.addEventListener('pe:hydrated', () => {
    clearTimeout(timer);
    window.removeEventListener('error', failed, true);
    window.removeEventListener('unhandledrejection', failed);
  }, {once: true});
})()`;
