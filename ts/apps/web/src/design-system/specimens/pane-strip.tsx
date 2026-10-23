import { useLiveOrbit } from "@pe/kit/lang/live-orbit";
/**
 * The pane strip specimen (ledger 2026-10-21): one pane with two modes, two floaters (a plane
 * minimap over a stand-in 4000x3000 field, an orbit globe with a few painted segments) and three
 * layers. Every chord is the pane's (S, M, G, 1-3) and Help (Alt+/) lists them; no key card here.
 */
import { useCallback, useState } from "react";
import { PictureReadout } from "@pe/kit/lang/readout";
import { Switcher } from "@pe/kit/lang/switcher";
import { Popover, PopoverTrigger, SubjectPopoverContent } from "@pe/kit/lang/popover";

import { Floater } from "@pe/kit/lang/floater";
import { Pane, PaneOverlay } from "@pe/kit/lang/pane";
import { PaneStrip } from "../../../../../packages/kit/src/components/lang/pane-strip";
import {
  canvasColor,
  OrbitMinimap,
  PlaneMinimap,
  type OrbitViewport,
  type PlaneViewport,
  type ScrollViewport,
} from "@pe/kit/lang/minimap";

import { SpecimenFrame } from "./recipe-grid";

const EXTENT = { width: 4000, height: 3000 };
const WINDOW = { width: 800, height: 600 };

const ROOMS = [
  ["A", 500, 500, 1000, 500],
  ["B", 2000, 1000, 1500, 1000],
  ["C", 500, 2000, 500, 500],
] as const;

/** Stand-in rooms on a 500-unit grid, drawn per layer; a consumer paints its own field. */
const paintField = (ctx: CanvasRenderingContext2D, k: number, layers: readonly string[]) => {
  if (layers.includes("grid")) {
    ctx.strokeStyle = canvasColor(ctx, "line-2");
    for (let x = 0; x < EXTENT.width; x += 500)
      for (let y = 0; y < EXTENT.height; y += 500) ctx.strokeRect(x * k, y * k, 500 * k, 500 * k);
  }
  ctx.fillStyle = canvasColor(ctx, "ink-2");
  for (const [name, x, y, w, h] of ROOMS) {
    if (layers.includes("rooms")) ctx.fillRect(x * k, y * k, w * k, h * k);
    if (layers.includes("labels")) ctx.fillText(name, x * k, y * k - 2);
  }
};

/** Three stand-in duct runs in unit-sphere space (z up). */
const SEGMENTS: readonly (readonly (readonly number[])[])[] = [
  [
    [-0.6, -0.4, 0],
    [0.5, -0.4, 0],
    [0.5, 0.5, 0],
  ],
  [
    [0.5, -0.4, 0],
    [0.5, -0.4, 0.5],
  ],
  [
    [-0.6, -0.4, 0],
    [-0.6, 0.4, 0],
  ],
];

const MODES = [
  { key: "plane", label: "plane", says: "Pan and zoom the field; the minimap writes tx/ty." },
  {
    key: "scroll",
    label: "scroll",
    chord: "S" as const,
    says: "Scroll the field; the minimap writes top/left.",
  },
];
const unbound = <T extends { chord?: unknown }>(options: readonly T[]) =>
  options.map(({ chord: _, ...option }) => option);
const LAYERS = [
  { key: "grid", label: "grid", chord: "1" as const, says: "The 500-unit grid." },
  { key: "rooms", label: "rooms", chord: "2" as const, says: "The stand-in rooms." },
  { key: "labels", label: "labels", chord: "3" as const, says: "Room labels." },
];

/** The parts alone, as the pane draws them: the strip in a header's trail, a floater in a body corner. */
function PaneStripAnatomy() {
  const [mode, setMode] = useState("plane");
  const [projection, setProjection] = useState("perspective");
  const [open, setOpen] = useState(true);
  const corner = {
    key: "anatomy",
    label: "corner",
    place: "tl" as const,
    open,
    onOpenChange: setOpen,
    render: () => "a corner surface; Esc inside closes it",
  };
  return (
    <SpecimenFrame name="PaneStrip and Floater, alone" importPath="@pe/kit/lang/floater">
      <div className="flex flex-wrap items-start gap-4">
        {/* No chords here: the pane above owns S, M, G and 1-3. */}
        <PaneStrip
          modes={{ value: mode, label: "viewport", options: unbound(MODES), onChange: setMode }}
          floaters={[corner]}
          layers={{ value: ["grid"], options: unbound(LAYERS), onToggle: () => {} }}
          projection={
            <Switcher
              ariaLabel="projection"
              value={projection}
              onChange={setProjection}
              options={[
                { value: "perspective", label: "perspective", title: "Perspective depth" },
                { value: "parallel", label: "parallel", title: "Parallel projection" },
              ]}
            />
          }
        />
        <div className="relative h-24 w-64" data-surface="support" data-slot="pane-field">
          {open ? <Floater spec={corner} /> : null}
        </div>
      </div>
    </SpecimenFrame>
  );
}

/** Only the scope is named on the Pane; the readout supplies subject and selection at both widths. */
function PaneStripWidths() {
  const [selected, setSelected] = useState<string | undefined>();
  const strip = (id: string) => (
    <Pane picture legend={null} id={id} title="Systems" flush scroll="clip">
      <div className="relative size-full">
        <PictureReadout
          subject="supply air, level 2"
          title={selected}
          onClear={() => setSelected(undefined)}
        >
          {selected ? "stand-in selection facts" : "stand-in system summary"}
          <button
            type="button"
            className="veil"
            onClick={() => setSelected(selected === "Room A" ? "Room B, a longer name" : "Room A")}
          >
            select another room
          </button>
        </PictureReadout>
        <PaneOverlay label="subject facts" place="tr">
          <Popover>
            <PopoverTrigger>facts</PopoverTrigger>
            <SubjectPopoverContent>stand-in facts, away from the picture</SubjectPopoverContent>
          </Popover>
        </PaneOverlay>
      </div>
    </Pane>
  );
  return (
    <SpecimenFrame name="Pane strip, narrow and wide" importPath="@pe/kit/lang/pane">
      <div className="flex flex-col gap-4">
        <div className="h-48 w-[400px]" data-strip-width="narrow">
          {strip("pane-strip-narrow")}
        </div>
        <div className="h-48 w-full" data-strip-width="wide">
          {strip("pane-strip-wide")}
        </div>
      </div>
    </SpecimenFrame>
  );
}

export function PaneStripSpecimen() {
  const [mode, setMode] = useState("plane");
  const [plane, setPlane] = useState<PlaneViewport>({ kind: "plane", scale: 1, tx: 0, ty: 0 });
  const [scroll, setScroll] = useState<ScrollViewport>({ kind: "scroll", top: 0, left: 0 });
  const [orbit, setOrbit] = useState<OrbitViewport>({
    kind: "orbit",
    yaw: 30,
    elev: 30,
    zoom: 1,
    pivot: [0, 0, 0],
  });
  const camera = useLiveOrbit(orbit, setOrbit, "specimen");
  const [mapOpen, setMapOpen] = useState(true);
  const [globeOpen, setGlobeOpen] = useState(false);
  const [layers, setLayers] = useState<readonly string[]>(["grid", "rooms"]);
  const viewport = mode === "plane" ? plane : scroll;
  // A new paint identity per layer set: the thumbnail repaints only when a layer turns.
  const paint = useCallback(
    (ctx: CanvasRenderingContext2D, k: number) => paintField(ctx, k, layers),
    [layers],
  );
  return (
    <>
      <SpecimenFrame name="Pane strip, Floater, Minimap" importPath="@pe/kit/lang/pane">
        <div className="h-96 w-full max-w-3xl">
          <Pane
            id="pane-strip-specimen"
            title="field"
            modes={{ value: mode, label: "viewport", options: MODES, onChange: setMode }}
            layers={{
              value: layers,
              options: LAYERS,
              onToggle: (key) =>
                setLayers((on) => (on.includes(key) ? on.filter((k) => k !== key) : [...on, key])),
            }}
            floaters={[
              {
                key: "minimap",
                label: "minimap",
                chord: "M",
                says: "The whole field with the view drawn on it; a click moves the view.",
                place: "br",
                open: mapOpen,
                onOpenChange: setMapOpen,
                render: () => (
                  <PlaneMinimap
                    viewport={viewport}
                    onViewport={(next) =>
                      next.kind === "plane" ? setPlane(next) : setScroll(next)
                    }
                    extent={EXTENT}
                    viewportSize={WINDOW}
                    paint={paint}
                  />
                ),
              },
              {
                key: "globe",
                label: "globe",
                chord: "G",
                says: "The orbit camera; a stop click turns the view to it.",
                place: "tr",
                open: globeOpen,
                onOpenChange: setGlobeOpen,
                render: () => <OrbitMinimap orbit={camera} lines={SEGMENTS} />,
              },
            ]}
          >
            {/* Stand-in: the consumer's canvas draws here; this reads back what the floaters wrote. */}
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 face-mono t-small">
              <dt className="text-ink-mute">viewport</dt>
              <dd>
                {viewport.kind === "plane"
                  ? `plane scale ${viewport.scale} tx ${Math.round(viewport.tx)} ty ${Math.round(viewport.ty)}`
                  : `scroll top ${Math.round(viewport.top)} left ${Math.round(viewport.left)}`}
              </dd>
              <dt className="text-ink-mute">orbit</dt>
              <dd>
                yaw {Math.round(orbit.yaw)}° elev {Math.round(orbit.elev)}°
              </dd>
              <dt className="text-ink-mute">layers</dt>
              <dd>{layers.length ? layers.join(", ") : "none on"}</dd>
            </dl>
          </Pane>
        </div>
      </SpecimenFrame>
      <PaneStripWidths />
      <PaneStripAnatomy />
    </>
  );
}
