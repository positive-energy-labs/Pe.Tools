import { reachProps } from "./reach";
import { Fragment } from "react";
import { ChevronRight } from "lucide-react";
import { revitTarget } from "./revit-target";
import { TooltipHint } from "./tooltip";
import "./lang.css";

/** Scope › subject › selection. The scope gives way first; the subject holds its name. */
export function PaneCrumb({
  segments,
}: {
  segments: readonly { label: string; onPress?: () => void; revit?: readonly number[] }[];
}) {
  return (
    <span className="dl-pane-crumb" role="group" aria-label="scope and selection">
      {segments.map((segment, index) => (
        <Fragment key={index}>
          {index ? <ChevronRight aria-hidden /> : null}
          <TooltipHint content={segment.label}>
            {segment.onPress ? (
              <button
                type="button"
                className="veil"
                onClick={segment.onPress}
                {...reachProps()}
                {...revitTarget(segment.revit)}
                data-crumb-segment={
                  index === segments.length - 1 ? "selection" : index === 0 ? "scope" : "subject"
                }
              >
                {segment.label}
              </button>
            ) : (
              <span
                {...reachProps()}
                {...revitTarget(segment.revit)}
                data-crumb-segment={
                  index === segments.length - 1 ? "selection" : index === 0 ? "scope" : "subject"
                }
              >
                {segment.label}
              </span>
            )}
          </TooltipHint>
        </Fragment>
      ))}
    </span>
  );
}
