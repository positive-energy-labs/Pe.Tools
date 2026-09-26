/**
 * The plan picture as drawn now: Revit's image, the regions, the callouts and the feedback marks
 * at the current pan and zoom, one PNG named `rooms-<view>-<stamp>.png`. The image is inlined as
 * a data URL (an SVG drawn to a canvas loads nothing external); if it cannot be read the picture
 * goes without it and says so.
 */
import { token } from "#/lib/token";

const NS = "http://www.w3.org/2000/svg";

/** The image as a data URL, through a canvas; a cross-origin image taints it and this throws. */
const dataUrl = async (href: string) => {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = href;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext("2d")!.drawImage(image, 0, 0);
  return canvas.toDataURL("image/png");
};

const download = (blob: Blob, name: string) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

/** Downloads the plan; answers what the picture leaves out, else null. */
export async function snapPlan(view: string): Promise<string | null> {
  const host = document.querySelector<HTMLElement>("[data-rooms-plan]");
  const world = host?.querySelector<SVGSVGElement>('svg[aria-label="rooms plan"]');
  if (!host || !world) return "no plan drawn to snap";
  const { width, height } = host.getBoundingClientRect();
  const move = /translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([-\d.e]+)\)/.exec(
    world.parentElement?.style.transform ?? "",
  );
  const [tx, ty, scale] = move ? move.slice(1).map(Number) : [0, 0, 1];
  const clone = world.cloneNode(true) as SVGSVGElement;
  let missing: string | null = null;
  for (const image of clone.querySelectorAll("image")) {
    try {
      image.setAttribute("href", await dataUrl(image.getAttribute("href") ?? ""));
    } catch {
      image.remove();
      missing = "saved without the plan image: it could not be read (cross-origin or unloaded)";
    }
  }
  const over = [
    ...host.querySelectorAll<SVGSVGElement>(
      'svg[aria-label="region callouts"], svg[data-layer="feedback"]',
    ),
  ];
  // A standalone SVG has no stylesheet: strokes read `--sw` from the world's own style.
  const svg =
    `<svg xmlns="${NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="${token("page")}"/>` +
    `<g transform="translate(${tx} ${ty}) scale(${scale})" style="--sw:${1 / scale!}">${clone.innerHTML}</g>` +
    over.map((layer) => layer.innerHTML).join("") +
    `</svg>`;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `rooms-${view}-${stamp}`;
  const source = new Blob([svg], { type: "image/svg+xml" });
  try {
    const image = new Image();
    image.src = URL.createObjectURL(source);
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width * devicePixelRatio;
    canvas.height = height * devicePixelRatio;
    const draw = canvas.getContext("2d")!;
    draw.scale(devicePixelRatio, devicePixelRatio);
    draw.drawImage(image, 0, 0);
    URL.revokeObjectURL(image.src);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) throw Error("the canvas gave no PNG");
    download(png, `${name}.png`);
    return missing;
  } catch (error) {
    download(source, `${name}.svg`);
    return `saved as SVG, the PNG failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}
