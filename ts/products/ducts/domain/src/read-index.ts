/** Read-only projections consume solver indexes or published JSON without reconstructing either. */
export type ReadIndex<K extends string|number,V> = ReadonlyMap<K,V>|Readonly<Partial<Record<K,V>>>;
export const readIndex=<K extends string|number,V>(index:ReadIndex<K,V>|undefined,key:K):V|undefined => index instanceof Map ? index.get(key) : (index as Readonly<Partial<Record<K,V>>>|undefined)?.[key];
