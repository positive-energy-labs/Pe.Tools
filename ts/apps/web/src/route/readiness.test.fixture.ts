/** Observe first chrome or any settled state, including refusal, without a timer. */
export function surfaceReadiness(phase: "pending" | "settled" = "settled") {
  return new Promise<Element>(resolve => {
    const inspect = () => {
      const node = document.querySelector('[aria-label="Route readiness"][data-readiness]');
      if (node && (phase === "pending" || node.getAttribute("data-readiness") !== "pending")) {
        observer.disconnect(); resolve(node);
      }
    };
    const observer = new MutationObserver(inspect);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    inspect();
  });
}
