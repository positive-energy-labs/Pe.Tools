/** Opt-in marks for the actual viewer, including GPU completion rather than a bare RAF tick. */
export function spaceMark(phase: string, detail: Record<string, unknown> = {}) {
  if (typeof location === "undefined" || !new URLSearchParams(location.search).has("spacePerf"))
    return;
  performance.mark(`space:${phase}`, { detail });
}

export function spaceTiming() {
  return typeof location !== "undefined" && new URLSearchParams(location.search).has("spacePerf");
}
