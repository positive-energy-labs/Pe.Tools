import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Dialog, DialogContent } from "@pe/kit/lang/dialog";
import { Button } from "@pe/kit/lang/button";
import { useCopy } from "@pe/kit/lib/use-copy";

/** The clipboard takes PNG only: anything else is redrawn through a canvas. */
export async function pngBlob(src: string): Promise<Blob> {
  const blob = await (await fetch(src)).blob();
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  return canvas.convertToBlob({ type: "image/png" });
}

/**
 * The one image thumbnail in chat: composer chips, sent attachments, and the images a tool call
 * captured. A press opens the image full size in the kit dialog (the app's one scrim); a strip
 * thumbnail wears a copy press at its top right on hover.
 */
export function Thumbnail({
  src,
  name,
  fit = "strip",
}: {
  src: string;
  name: string;
  /** `chip`: a square crop inside a composer chip. `strip`: the whole image, capped in height. */
  fit?: "chip" | "strip";
}) {
  const [open, setOpen] = useState(false);
  const { copied, copy } = useCopy();
  return (
    <>
      <span className="relative inline-flex">
        <Button label={`Open ${name} full size`} onClick={() => setOpen(true)}>
          <img
            src={src}
            alt={name}
            className={
              fit === "chip"
                ? "size-8 object-cover"
                : "hairline-x-faint hairline-y-faint max-h-40 object-contain"
            }
          />
        </Button>
        {fit === "strip" ? (
          <span className="dl-corner-copy">
            <Button
              label={copied ? "Image copied" : "Copy image"}
              icon={copied ? <Check size={13} /> : <Copy size={13} />}
              onClick={() => copy(pngBlob(src))}
            />
          </span>
        ) : null}
      </span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent pad="none" aria-label={name}>
          <img src={src} alt={name} className="max-h-[calc(100dvh-4rem)] w-full object-contain" />
        </DialogContent>
      </Dialog>
    </>
  );
}
