import { Popover, PopoverContent, PopoverTrigger } from "@pe/kit/lang/popover";
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
    <Popover>
      <PopoverTrigger render={<Button label={label} icon={icon} />} />
      <PopoverContent align="end">
        <h2 className="t-small t-upper mb-3">{label}</h2>
        {children}
      </PopoverContent>
    </Popover>
  );
}
