"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";

import { tv } from "#/lib/tv";
import { Press } from "#/components/lang/press";
import { X as RiCloseLine } from "lucide-react";

export const dialogRecipe = tv({
  slots: {
    overlay: "fixed inset-0 isolate z-modal bg-scrim supports-backdrop-filter:backdrop-blur-xs",
    content:
      "fixed top-1/2 left-1/2 z-modal grid max-h-[calc(100dvh-2rem)] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg text-ink ring-1 ring-line outline-none sm:max-w-lg",
    header: "flex flex-col gap-1",
    footer: "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
    title: "t-title",
    description: "text-ink-2 *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-ink",
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

function DialogTrigger({ ...props }: Omit<DialogPrimitive.Trigger.Props, "className">) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
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
              render={<Press tone="neutral" size="icon" />}
            >
              <RiCloseLine />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
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

function DialogDescription(props: Omit<DialogPrimitive.Description.Props, "className">) {
  const { description } = dialogRecipe();
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={description()}
      {...props}
    />
  );
}

export { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger };
