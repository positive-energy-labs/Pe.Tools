"use client";

import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { Search } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#/components/lang/dialog";
import { InputGroup, InputGroupAddon } from "#/components/lang/input-group";
import { tv } from "#/lib/tv";

export const commandRecipe = tv({
  slots: {
    root: "flex size-full flex-col overflow-hidden rounded-lg bg-artifact p-1 text-ink",
    input: "w-full t-value outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
    list: "no-scrollbar max-h-72 scroll-py-1 overflow-x-hidden overflow-y-auto outline-none",
    empty: "py-6 text-center t-value",
    group:
      "overflow-hidden p-1 text-ink **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-1 **:[[cmdk-group-heading]]:t-label **:[[cmdk-group-heading]]:t-upper **:[[cmdk-group-heading]]:text-ink-2",
    item: "group/command-item relative flex min-h-7 cursor-default items-center gap-2 rounded-sm border-l-2 border-transparent px-2 py-1 t-prose outline-hidden select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-selected:border-ink data-selected:bg-select data-selected:text-ink [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 [&_svg]:text-ink-2",
    shortcut:
      "ml-auto face-mono t-caption t-upper text-ink-2 group-data-selected/command-item:text-ink",
  },
});

function Command(props: Omit<React.ComponentProps<typeof CommandPrimitive>, "className">) {
  const { root } = commandRecipe();
  return <CommandPrimitive data-slot="command" className={root()} {...props} />;
}

function CommandDialog({
  title = "Command Palette",
  description = "Search for a command to run...",
  children,
  showCloseButton = false,
  ...props
}: Omit<React.ComponentProps<typeof Dialog>, "children"> & {
  title?: string;
  description?: string;
  showCloseButton?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Dialog {...props}>
      <div className="sr-only">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
      </div>
      <DialogContent showCloseButton={showCloseButton}>
        <Command>{children}</Command>
      </DialogContent>
    </Dialog>
  );
}

function CommandInput(
  props: Omit<React.ComponentProps<typeof CommandPrimitive.Input>, "className">,
) {
  const { input } = commandRecipe();
  return (
    <div data-slot="command-input-wrapper" className="p-1 pb-0">
      <InputGroup>
        <CommandPrimitive.Input data-slot="command-input" className={input()} {...props} />
        <InputGroupAddon>
          <Search className="size-3.5 shrink-0 opacity-50" />
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}

function CommandList(props: Omit<React.ComponentProps<typeof CommandPrimitive.List>, "className">) {
  const { list } = commandRecipe();
  return <CommandPrimitive.List data-slot="command-list" className={list()} {...props} />;
}

function CommandEmpty(
  props: Omit<React.ComponentProps<typeof CommandPrimitive.Empty>, "className">,
) {
  const { empty } = commandRecipe();
  return <CommandPrimitive.Empty data-slot="command-empty" className={empty()} {...props} />;
}

function CommandGroup(
  props: Omit<React.ComponentProps<typeof CommandPrimitive.Group>, "className">,
) {
  const { group } = commandRecipe();
  return <CommandPrimitive.Group data-slot="command-group" className={group()} {...props} />;
}

function CommandItem({
  children,
  ...props
}: Omit<React.ComponentProps<typeof CommandPrimitive.Item>, "className">) {
  const { item } = commandRecipe();
  return (
    <CommandPrimitive.Item data-slot="command-item" className={item()} {...props}>
      {children}
    </CommandPrimitive.Item>
  );
}

function CommandShortcut(props: Omit<React.ComponentProps<"span">, "className">) {
  const { shortcut } = commandRecipe();
  return <span data-slot="command-shortcut" className={shortcut()} {...props} />;
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
};
