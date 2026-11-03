// node --max-old-space-size=6000 ram1-heap-diff.mjs a.heapsnapshot b.heapsnapshot: top constructors by retained-self growth.
import { readFileSync } from "node:fs";
const summarize = (file) => {
  const s = JSON.parse(readFileSync(file, "utf8"));
  const f = s.snapshot.meta.node_fields, types = s.snapshot.meta.node_types[0], n = f.length;
  const iType = f.indexOf("type"), iName = f.indexOf("name"), iSize = f.indexOf("self_size");
  const by = new Map();
  for (let i = 0; i < s.nodes.length; i += n) {
    const type = types[s.nodes[i + iType]];
    const name = type === "object" || type === "native" || type === "closure" ? s.strings[s.nodes[i + iName]].slice(0, 80) : `(${type})`;
    const key = `${type}:${name}`;
    const e = by.get(key) ?? { count: 0, bytes: 0 };
    e.count++; e.bytes += s.nodes[i + iSize];
    by.set(key, e);
  }
  return by;
};
const [a, b] = process.argv.slice(2).map(summarize);
const rows = [...b].map(([k, v]) => ({ k, dCount: v.count - (a.get(k)?.count ?? 0), dMiB: (v.bytes - (a.get(k)?.bytes ?? 0)) / 2 ** 20, count: v.count, MiB: v.bytes / 2 ** 20 }));
const total = (m) => [...m.values()].reduce((t, v) => t + v.bytes, 0) / 2 ** 20;
console.log(`total MiB a=${total(a).toFixed(1)} b=${total(b).toFixed(1)}`);
for (const r of rows.sort((x, y) => y.dMiB - x.dMiB).slice(0, 25)) console.log(r.dMiB.toFixed(2).padStart(8), String(r.dCount).padStart(8), r.MiB.toFixed(1).padStart(8), String(r.count).padStart(8), r.k);
console.log("-- by count growth");
for (const r of rows.sort((x, y) => y.dCount - x.dCount).slice(0, 15)) console.log(String(r.dCount).padStart(8), r.dMiB.toFixed(2).padStart(8), r.k);
