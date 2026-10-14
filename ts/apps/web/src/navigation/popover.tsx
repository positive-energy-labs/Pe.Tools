import { Popover } from "@base-ui/react/popover";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@pe/kit/lang/button";

export function Information({
  label,
  icon,
  children,
}: {
  label: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger render={<Button label={label} icon={icon} />} />
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6} className="isolate z-popup">
          <Popover.Popup
            data-surface="artifact"
            className="float-surface max-h-(--available-height) w-80 max-w-(--available-width) overflow-auto p-3"
          >
            <h2 className="t-small t-upper mb-3">{label}</h2>
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
