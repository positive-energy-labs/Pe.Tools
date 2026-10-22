import { useRef } from "react";
import { SpaceCanvas } from "./canvas";
import type { ResidentScene } from "#/scene/scene-cache";
import type { Metadata } from "./state";
import type { ComponentProps } from "react";

type Snapshot = Omit<ComponentProps<typeof SpaceCanvas>, "metadata" | "positions" | "active">;
type Props = Snapshot & {
  scenes: readonly ResidentScene<{ metadata: Metadata; positions: Float32Array }>[];
};

/** Reuse the real viewer and its GPU resources on return. Hidden scopes have no animation loop. */
export function SpaceViewer({ scenes, ...props }: Props) {
  const snapshots = useRef(new Map<string, Snapshot>());
  const active = props.state.scene;
  snapshots.current.set(active, props);
  for (const id of snapshots.current.keys())
    if (!scenes.some((scene) => scene.id === id)) snapshots.current.delete(id);
  return scenes.map((scene) => {
    const visible = scene.id === active;
    const snapshot = snapshots.current.get(scene.id);
    if (!snapshot) return null;
    return (
      <div key={scene.id} className="absolute inset-0" hidden={!visible} aria-hidden={!visible}>
        <SpaceCanvas
          {...snapshot}
          metadata={scene.metadata}
          positions={scene.positions}
          active={visible}
        />
      </div>
    );
  });
}
