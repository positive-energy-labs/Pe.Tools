import { useState } from "react";
import { Dialog, DialogContent } from "#/components/lang/dialog";
import { Press } from "#/components/lang/press";

/**
 * The one image thumbnail in chat: composer chips, sent attachments, and the images a tool call
 * captured. A press opens the image full size in the kit dialog (the app's one scrim).
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
  return (
    <>
      <Press
        type="button"
        hover="bare"
        title={`Open ${name} full size`}
        onClick={() => setOpen(true)}
      >
        <img
          src={src}
          alt={name}
          className={
            fit === "chip"
              ? "size-8 object-cover"
              : "hairline-x-faint hairline-y-faint max-h-40 object-contain"
          }
        />
      </Press>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent pad="none" aria-label={name}>
          <img src={src} alt={name} className="max-h-[calc(100dvh-4rem)] w-full object-contain" />
        </DialogContent>
      </Dialog>
    </>
  );
}
