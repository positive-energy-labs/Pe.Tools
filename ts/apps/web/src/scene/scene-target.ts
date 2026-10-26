import { observedElements, type NativeObservation } from "#/revit/observation";
import type { ElementTarget } from "#/revit/element-target";
import type { SceneInstance } from "./types";

/**
 * What the element menu acts on for one drawn element: the displayed observation's captured member,
 * held to the mesh's own UniqueId. A linked element, or one the displayed read never captured,
 * still declares itself so the menu refuses it in words; with no observation the canvas is inert.
 */
export function sceneTarget(
  observation: NativeObservation,
  instance: SceneInstance,
): ElementTarget | null {
  if (!observation.scope) return null;
  if (instance.revitId === null)
    return {
      scope: observation.scope,
      ids: [],
      refs: [
        {
          elementId: null,
          uniqueId: instance.uniqueId,
          documentKey: instance.documentKey,
          linkInstanceIds: instance.linkInstanceId === null ? [] : [instance.linkInstanceId],
        },
      ],
    };
  const target = observedElements(observation, [instance.revitId]);
  return {
    ...target,
    refs: [...(target.refs ?? []), { elementId: instance.revitId, uniqueId: instance.uniqueId }],
  };
}
