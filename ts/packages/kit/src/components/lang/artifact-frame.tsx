/**
 * The one enclosure: the artifact plane (ground plus its hairline), no radius, no shadow.
 * Frame only a machine-operated object that carries state; plain content is never enclosed.
 */
import { Rail } from "./rail";
import { cn } from "../../lib/utils";

import "./lang.css";

interface ArtifactFrameProps {
  /** Recessed band across the top — the object's name and its machine-measured facts. */
  head?: React.ReactNode;
  headTrail?: React.ReactNode;
  /** The head's fit (see `Rail`): `wrap` for a trail that accumulates chips. */
  headFit?: "line" | "wrap";
  /** Recessed band across the bottom — counts, receipts, and the object's one commit verb. */
  foot?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  label?: string;
  /** The frame as a `Connectors` anchor. */
  "data-key"?: string;
}

export function ArtifactFrame({
  head,
  headTrail,
  headFit,
  foot,
  children,
  className,
  label,
  "data-key": key,
}: ArtifactFrameProps) {
  return (
    <div
      data-surface="artifact"
      data-slot="artifact-frame"
      data-key={key}
      className={cn("flex min-h-0 min-w-0 flex-1 flex-col", className)}
      role={label ? "group" : undefined}
      aria-label={label}
    >
      {head != null ? (
        <Rail ground="recess" lead={head} trail={headTrail} fit={headFit} size="control" />
      ) : null}
      {children}
      {foot != null ? <Rail ground="recess" lead={foot} edge="top" size="control" /> : null}
    </div>
  );
}
