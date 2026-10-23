import { reachProps } from "./reach";
import { Fragment, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { revitTarget } from "./revit-target";
import { TooltipHint } from "./tooltip";
import "./lang.css";

/** Scope › subject › selection. The scope gives way first; the subject holds its name. */
export function PaneCrumb({
  segments,
}: {
  segments: readonly { label: ReactNode; onPress?: () => void; revit?: readonly number[] }[];
}) {
  return (
    <span className="dl-pane-crumb" role="group" aria-label="scope and selection">
      {segments.map((segment, index) => {
        const Tag = segment.onPress ? "button" : "span";
        return (
          <Fragment key={index}>
            {index ? <ChevronRight aria-hidden /> : null}
            <TooltipHint content={typeof segment.label === "string" ? segment.label : undefined}>
              <Tag
                type={segment.onPress ? "button" : undefined}
                className={segment.onPress ? "veil" : undefined}
                onClick={segment.onPress}
                {...reachProps()}
                {...revitTarget(segment.revit)}
                data-crumb-segment={
                  index === segments.length - 1 ? "selection" : index === 0 ? "scope" : "subject"
                }
              >
                {segment.label}
              </Tag>
            </TooltipHint>
          </Fragment>
        );
      })}
    </span>
  );
}
