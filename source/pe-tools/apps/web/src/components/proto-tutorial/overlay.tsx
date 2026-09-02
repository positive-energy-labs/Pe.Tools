import { useEffect, useMemo, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { useHotkeys } from "@tanstack/react-hotkeys";
import { Keyboard } from "lucide-react";

import { EmptyState } from "#/components/lang/empty";
import { Press } from "#/components/lang/press";
import { TutorialChart } from "./chart";
import { readCurrentManifest } from "./manifest-ref";
import { measureLayout, type MeasuredLayout } from "./measure";

function OverlayBody({ onClose }: { onClose: () => void }) {
  const [layout, setLayout] = useState<MeasuredLayout | null>(null);
  const manifest = useMemo(() => readCurrentManifest(), []);

  useEffect(() => {
    setLayout(measureLayout());
  }, []);

  return (
    <>
      <div data-surface="page" className="absolute inset-0" onClick={onClose} />
      {layout == null ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <div data-surface="page" className="border border-line p-6">
            <EmptyState
              story="scope"
              exit="open a workspace route (takeoffs, family, grilles) and reopen"
            >
              this route draws no panes to explain
            </EmptyState>
          </div>
        </div>
      ) : (
        <TutorialChart layout={layout} manifest={manifest} />
      )}
    </>
  );
}

export function ProtoTutorialButton() {
  const [open, setOpen] = useState(false);
  useHotkeys([
    {
      hotkey: "Alt+/",
      callback: () => setOpen(true),
      options: { ignoreInputs: true },
    },
  ]);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger
        render={<Press tone="quiet" size="icon" />}
        title="how this route works — panes, hotkeys, and what each verb needs (Alt+/)"
      >
        <Keyboard />
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Popup className="fixed inset-0 z-modal outline-none">
          <OverlayBody onClose={() => setOpen(false)} />
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
