"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";

import { tv } from "#/lib/tv";
import { Press } from "#/components/lang/press";
import { X as RiCloseLine } from "lucide-react";

export const dialogRecipe = tv({
  slots: {
    overlay:
      "fixed inset-0 isolate z-modal bg-scrim duration-control supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
    content:
      "fixed top-1/2 left-1/2 z-modal grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg bg-artifact p-4 t-value text-ink ring-1 ring-line duration-control outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
    header: "flex flex-col gap-1",
    footer: "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
    title: "t-title",
    description: "t-value text-ink-2 *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-ink",
  },
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
  ...props
}: Omit<DialogPrimitive.Popup.Props, "className"> & {
  showCloseButton?: boolean;
}) {
  const { content } = dialogRecipe();
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup data-slot="dialog-content" className={content()} {...props}>
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={<Press tone="neutral" size="icon" />}
          >
            <RiCloseLine />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
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

export {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
