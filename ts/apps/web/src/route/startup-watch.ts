import { HOST_READ_WAIT_S } from "./waits";

/** Runs from SSR HTML even when a static route import prevents React from hydrating. */
export const startupWatch = `(() => {
  let reason = '';
  let diagnostic;
  const failed = event => { reason = event.reason?.message || event.message || 'A page module failed to load.'; };
  window.addEventListener('error', failed, true);
  window.addEventListener('unhandledrejection', failed);
  const timer = setTimeout(() => {
    const root = document.querySelector('[data-startup]');
    if (!root) return;
    const slot = root.querySelector('[data-startup-diagnostic]');
    if (slot) {
      // Hydration must see the original SSR light DOM even after this timer fires.
      diagnostic = slot.shadowRoot || slot.attachShadow({mode: 'open'});
      const status = document.createElement('p');
      status.setAttribute('role', 'alert');
      status.textContent = reason || 'Page startup did not finish after ${HOST_READ_WAIT_S}s. A page module may be unavailable.';
      const retry = document.createElement('a');
      retry.href = location.href;
      retry.textContent = 'Reload page';
      diagnostic.replaceChildren(status, retry);
    }
  }, ${HOST_READ_WAIT_S * 1000});
  window.addEventListener('pe:hydrated', () => {
    clearTimeout(timer);
    diagnostic?.replaceChildren();
    window.removeEventListener('error', failed, true);
    window.removeEventListener('unhandledrejection', failed);
  }, {once: true});
})()`;
