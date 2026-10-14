/** Region orientation, available on hover and keyboard focus. */
import { Tooltip, TooltipTrigger, TooltipContent } from "@pe/kit/lang/tooltip";

export function HelpTip({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        aria-label="What is this?"
        className="grid size-5 cursor-help place-items-center t-small face-mono text-ink-2"
      >
        ?
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}
