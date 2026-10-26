import { prepareGeometry, type PreparationInput } from "./prepare-geometry";

self.onmessage = ({ data }: MessageEvent<PreparationInput>) => {
  try {
    const result = prepareGeometry(data);
    const buffers = [
      result.positions.buffer,
      result.normals.buffer,
      result.continuation.buffer,
      result.field.data.buffer,
      ...result.edges.flatMap((edge) => (edge ? [edge.buffer] : [])),
    ];
    self.postMessage({ result }, { transfer: buffers });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
