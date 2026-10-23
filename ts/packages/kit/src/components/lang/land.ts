const landings = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/** A named arrival scrolls nearest and marks once; focus is reserved for editing destinations. */
export function land(
  el: HTMLElement | null | undefined,
  {
    focus = false,
    requested = true,
    scroll,
  }: { focus?: boolean; requested?: boolean; scroll?: () => void } = {},
) {
  if (!requested) return;
  scroll?.();
  if (!el) return;
  clearTimeout(landings.get(el));
  el.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "instant" });
  if (focus)
    (el.querySelector<HTMLElement>("input, select, textarea, button, [tabindex]") ?? el).focus({
      preventScroll: true,
    });
  el.removeAttribute("data-landed");
  // Restart the CSS animation even for two consecutive arrivals on the same element.
  void el.offsetWidth;
  el.setAttribute("data-landed", "");
  const duration =
    getComputedStyle(el).getPropertyValue("--motion-land").trim() ||
    getComputedStyle(document.documentElement).getPropertyValue("--motion-land").trim();
  const ms = parseFloat(duration) * (duration.endsWith("ms") ? 1 : 1000);
  landings.set(
    el,
    setTimeout(
      () => {
        el.removeAttribute("data-landed");
        landings.delete(el);
      },
      Number.isFinite(ms) ? ms : 0,
    ),
  );
}
