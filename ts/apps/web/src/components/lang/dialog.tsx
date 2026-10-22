"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";

import { tv } from "@pe/kit/lib/tv";
import { Button } from "@pe/kit/lang/button";
import { X as RiCloseLine } from "lucide-react";

// One column with a zero minimum: a row wider than the dialog truncates, never scrolls the dialog sideways.
export const dialogRecipe = tv({
  slots: {
    overlay: "fixed inset-0 isolate z-modal bg-scrim supports-backdrop-filter:backdrop-blur-xs",
    content:
      "fixed top-1/2 left-1/2 z-modal grid grid-cols-[minmax(0,1fr)] max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto text-ink shadow-modal outline-none sm:max-w-lg",
    header: "flex flex-col gap-1",
    title: "t-title",
  },
  variants: {
    // A dialog whose body is one self-padding surface (the command palette) takes no chrome of
    // its own — two nested pads read as a box inside a box.
    pad: { normal: { content: "gap-4 p-4" }, none: { content: "" } },
  },
  defaultVariants: { pad: "normal" },
});

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogOverlay(props: Omit<DialogPrimitive.Backdrop.Props, "className">) {
  const { overlay } = dialogRecipe();
  return <DialogPrimitive.Backdrop data-slot="dialog-overlay" className={overlay()} {...props} />;
}

function DialogContent({
  children,
  showCloseButton = true,
  pad,
  ...props
}: Omit<DialogPrimitive.Popup.Props, "className"> & {
  showCloseButton?: boolean;
  pad?: "normal" | "none";
}) {
  const { content } = dialogRecipe({ pad });
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={content()}
        {...props}
        data-surface="artifact"
      >
        {children}
        {showCloseButton && (
          <span className="absolute top-3 right-3">
            <DialogPrimitive.Close
              data-slot="dialog-close"
              render={<Button label="Close" icon={RiCloseLine} />}
            />
          </span>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}

function DialogHeader(props: Omit<React.ComponentProps<"div">, "className">) {
  const { header } = dialogRecipe();
  return <div data-slot="dialog-header" className={header()} {...props} />;
}

function DialogTitle(props: Omit<DialogPrimitive.Title.Props, "className">) {
  const { title } = dialogRecipe();
  return <DialogPrimitive.Title data-slot="dialog-title" className={title()} {...props} />;
}

export { Dialog, DialogContent, DialogHeader, DialogTitle };
