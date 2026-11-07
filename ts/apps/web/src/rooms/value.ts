export const readingValue = <T>(reading:{value?:unknown;previous?:unknown}):T|null => (reading.value??reading.previous??null) as T|null;
