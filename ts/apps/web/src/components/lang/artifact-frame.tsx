/**
 * The one enclosure: the artifact plane (ground plus its hairline), no radius, no shadow.
 * Frame only a machine-operated object that carries state; plain content is never enclosed.
 */
import { Rail } from "./rail";

import "./lang.css";

interface ArtifactFrameProps {
  /** Recessed band across the top — the object's name and its machine-measured facts. */
  head?: React.ReactNode;
  headTrail?: React.ReactNode;
  /** Recessed band across the bottom — counts, receipts, and the object's one commit verb. */
  foot?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  label?: string;
}

export function ArtifactFrame({
  head,
  headTrail,
  foot,
  children,
  className,
  label,
}: ArtifactFrameProps) {
  return (
    <div
      data-surface="artifact"
      data-slot="artifact-frame"
      className={className}
      role={label ? "group" : undefined}
      aria-label={label}
    >
      {head != null ? <Rail ground="recess" lead={head} trail={headTrail} /> : null}
      {children}
      {foot != null ? <Rail ground="recess" lead={foot} edge="top" /> : null}
    </div>
  );
}
