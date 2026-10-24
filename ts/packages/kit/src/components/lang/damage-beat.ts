// CSS animations join the document timeline, including SVG and rows mounted by virtualization.
const synchronize = (event: AnimationEvent) => {
  if (event.animationName !== "pe-damage-beat" || !(event.target instanceof Element)) return;
  for (const animation of event.target.getAnimations())
    if ("animationName" in animation && animation.animationName === "pe-damage-beat")
      animation.startTime = 0;
};
if (typeof document !== "undefined") {
  document.addEventListener("animationstart", synchronize, true);
  import.meta.hot?.dispose(() => document.removeEventListener("animationstart", synchronize, true));
}
