/** Observe the shared chrome, including its first React commit, without a timer. */
export function surfaceReadiness(state: "pending" | "ready" | "blocked") {
  return new Promise<Element>(resolve => {
    const inspect = () => {
      const node = document.querySelector(`[aria-label="Route readiness"][data-readiness="${state}"]`);
      if (node) { observer.disconnect(); resolve(node); }
    };
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    inspect();
  });
}
