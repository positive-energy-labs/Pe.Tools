import { useRef, type PointerEvent, type ReactNode } from "react";
import { Button } from "@pe/kit/lang/button";
import { ButtonGroup } from "@pe/kit/lang/button-group";
import { Input } from "@pe/kit/lang/input";
import { ListPopup } from "@pe/kit/lang/list-popup";
import { Switcher } from "@pe/kit/lang/switcher";
import type { SceneView } from "@pe/agent-contracts";
import type { Bounds } from "./types";
import type { Project } from "./projection";
import { PRESETS } from "./presets";
import { fitSection, limitsOf, SECTION_AXES, type Section, type SectionAxis } from "./section";

export function SectionControls({
  view,
  subject,
  padding,
  onChange,
}: {
  view: SceneView;
  subject: Bounds;
  padding: number;
  onChange: (view: SceneView) => void;
}) {
  const section = view.section;
  const current = PRESETS.find((p) => p.value === view.preset)!;
  const setSection = (next: Section | null) => onChange({ ...view, section: next });
  const plane = (axis: SectionAxis): Section => ({
    kind: "plane",
    axis,
    keep: section?.kind === "plane" ? section.keep : "below",
    offset: (limitsOf(subject, axis)[0] + limitsOf(subject, axis)[1]) / 2,
  });
  return (
    <div className="flex flex-col items-start gap-1" data-section-controls="">
      <div className="flex items-center gap-1">
        <ListPopup
          face="control"
          anchor="trigger"
          trigger={current.label}
          triggerLabel={`Context preset: ${current.label}`}
          aria-label="Context preset"
          items={PRESETS}
          keyOf={(p) => p.value}
          labelOf={(p) => p.label}
          select="single"
          selected={[view.preset]}
          empty="No presets"
          detail={(p) => p.title}
          row={(p) => ({ label: p.label, title: p.title })}
          onPick={(p) =>
            onChange({
              preset: p.value,
              section: p.value === "nearby-structure" ? fitSection(subject, padding) : section,
            })
          }
        />
        <ButtonGroup>
          <Button
            label="Section to subject"
            pressed={section?.kind === "box"}
            onClick={() => setSection(fitSection(subject, padding))}
          >
            Section to subject
          </Button>
          <Button
            label="Plane cut"
            pressed={section?.kind === "plane"}
            onClick={() => setSection(section?.kind === "plane" ? null : plane("z"))}
          >
            Plane
          </Button>
          {section && (
            <Button label="Clear section" onClick={() => setSection(null)}>
              Clear
            </Button>
          )}
        </ButtonGroup>
      </div>
      {section?.kind === "plane" && (
        <div className="flex items-center gap-1">
          <Switcher
            ariaLabel="Section plane axis"
            value={section.axis}
            onChange={(axis) => setSection(plane(axis))}
            options={SECTION_AXES.map((value) => ({
              value,
              label: value.toUpperCase(),
              title: `Cut perpendicular to ${value.toUpperCase()}`,
            }))}
          />
          <span className="w-24">
            <Input
              key={`${section.axis}:${section.offset}`}
              type="number"
              face="mono"
              aria-label="Plane offset in feet"
              defaultValue={section.offset}
              step={0.25}
              onBlur={(e) => {
                const offset = e.currentTarget.valueAsNumber;
                if (Number.isFinite(offset)) setSection({ ...section, offset });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
          </span>
          <span>ft</span>
          <Button
            label="Flip kept side"
            onClick={() =>
              setSection({ ...section, keep: section.keep === "below" ? "above" : "below" })
            }
          >
            Keep {section.keep}
          </Button>
        </div>
      )}
    </div>
  );
}

type Handle = { axis: SectionAxis; side: "min" | "max"; at: number[]; label: string };
function sectionHandles(section: Section, subject: Bounds): Handle[] {
  const bounds = section.kind === "box" ? section.bounds : subject;
  const centre = SECTION_AXES.map((axis) => {
    const [a, b] = limitsOf(bounds, axis);
    return (a + b) / 2;
  });
  return SECTION_AXES.flatMap((axis, i) => {
    if (section.kind === "plane")
      return section.axis === axis
        ? [
            {
              axis,
              side: "max" as const,
              at: centre.map((n, j) => (i === j ? section.offset : n)),
              label: `${axis.toUpperCase()} cut`,
            },
          ]
        : [];
    return (["min", "max"] as const).map((side, n) => ({
      axis,
      side,
      at: centre.map((v, j) => (i === j ? limitsOf(bounds, axis)[n]! : v)),
      label: `${axis.toUpperCase()}${side === "min" ? "−" : "+"}`,
    }));
  });
}

export function moveSectionFace(
  section: Section,
  handle: Pick<Handle, "axis" | "side">,
  offset: number,
): Section {
  if (section.kind === "plane") return { ...section, offset };
  const suffix = handle.axis.toUpperCase() as "X" | "Y" | "Z";
  const [lo, hi] = limitsOf(section.bounds, handle.axis);
  return {
    ...section,
    bounds: {
      ...section.bounds,
      [`${handle.side}${suffix}`]:
        handle.side === "min" ? Math.min(offset, hi - 0.01) : Math.max(offset, lo + 0.01),
    },
  };
}

/** Face motion previews locally; only pointer release publishes the authored section to Page. */
export function SectionHandles({
  section,
  subject,
  project,
  onPreview,
  onCommit,
}: {
  section: Section;
  subject: Bounds;
  project: Project;
  onPreview: (section: Section | undefined) => void;
  onCommit: (section: Section) => void;
}): ReactNode {
  const drag = useRef<{
    id: number;
    section: Section;
    handle: Handle;
    x: number;
    y: number;
    dx: number;
    dy: number;
    next: Section;
  } | null>(null);
  const end = (e: PointerEvent, cancel = false) => {
    const own = drag.current;
    if (!own || own.id !== e.pointerId) return;
    drag.current = null;
    if (cancel) onPreview(undefined);
    else onCommit(own.next);
  };
  return (
    <div className="pointer-events-none absolute inset-0" aria-label="Section faces">
      {sectionHandles(section, subject).map((handle) => {
        const at = project(handle.at);
        if (!at) return null;
        const axis = SECTION_AXES.indexOf(handle.axis);
        const next = project(handle.at.map((n, i) => (i === axis ? n + 1 : n)));
        const dx = next ? next[0] - at[0] : 0,
          dy = next ? next[1] - at[1] : 0;
        const edgeOn = dx * dx + dy * dy < 0.04;
        return (
          <span
            key={handle.label}
            className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: at[0], top: at[1] }}
          >
            <Button
              label={`Drag section ${handle.label}; arrow keys adjust by 0.25 feet`}
              kind="framed"
              onPointerDown={(e) => {
                if (e.button !== 0 || edgeOn) return;
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.setPointerCapture(e.pointerId);
                drag.current = {
                  id: e.pointerId,
                  section,
                  handle,
                  x: e.clientX,
                  y: e.clientY,
                  dx,
                  dy,
                  next: section,
                };
              }}
              onPointerMove={(e) => {
                const own = drag.current;
                if (!own || own.id !== e.pointerId) return;
                const delta =
                  ((e.clientX - own.x) * own.dx + (e.clientY - own.y) * own.dy) /
                  (own.dx * own.dx + own.dy * own.dy);
                own.next = moveSectionFace(own.section, own.handle, own.handle.at[axis]! + delta);
                onPreview(own.next);
              }}
              onPointerUp={(e) => end(e)}
              onPointerCancel={(e) => end(e, true)}
              onLostPointerCapture={(e) => end(e, true)}
              onKeyDown={(e) => {
                if (!["ArrowLeft", "ArrowDown", "ArrowRight", "ArrowUp", "Escape"].includes(e.key))
                  return;
                e.preventDefault();
                e.stopPropagation();
                if (e.key === "Escape") {
                  drag.current = null;
                  onPreview(undefined);
                  return;
                }
                onCommit(
                  moveSectionFace(
                    section,
                    handle,
                    handle.at[axis]! + (["ArrowLeft", "ArrowDown"].includes(e.key) ? -0.25 : 0.25),
                  ),
                );
              }}
            >
              {handle.label}
            </Button>
          </span>
        );
      })}
    </div>
  );
}
