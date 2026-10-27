/** Transient routing to the journal that owns a wire request. No execution or writable state lives here. */
type Owner = {
  refusal(): string | null;
  validate(): Promise<string | null>;
  dispatched(): Promise<void>;
};
const owners = new Map<string, Owner>();
export function bindActionDispatch(id: string, owner: Owner) {
  if (owners.has(id)) throw Error("A native request already has a journal owner");
  owners.set(id, owner);
  return () => {
    if (owners.get(id) === owner) owners.delete(id);
  };
}
export const dispatchRefusal = (id: string) => owners.get(id)?.refusal() ?? null;
export const validateDispatch = (id: string) => owners.get(id)?.validate() ?? Promise.resolve(null);
export const markDispatched = (id: string) => owners.get(id)?.dispatched() ?? Promise.resolve();
