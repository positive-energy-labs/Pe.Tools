import { NumberCell } from "#/components/master-table/cells";
import type { RoomData, RoomEdit, ModelRoom } from "#/takeoff/world";

export function ManualJField({
  room,
  field,
  onPatch,
}: {
  room: ModelRoom;
  field: keyof RoomData;
  onPatch: (patch: RoomEdit) => void;
}) {
  return (
    <NumberCell
      value={room.data?.[field] ?? 0}
      digits={0}
      integer
      min={0}
      onCommit={(value) => onPatch({ [field]: value })}
    />
  );
}
