import { inflateRawSync } from "node:zlib";

/** Reads .xlsx and .docx straight from their zip XML, so no LibreOffice is needed. Text only, read-only. */

/** Every entry of a zip, inflated. ponytail: no zip64 or encryption; Office files under 4 GB never need them. */
function unzip(zip: Buffer): Map<string, Buffer> {
  let eocd = zip.length - 22;
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("not a zip file");
  const entries = new Map<string, Buffer>();
  let at = zip.readUInt32LE(eocd + 16);
  for (let n = zip.readUInt16LE(eocd + 10); n > 0; n--) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error("corrupt zip directory");
    const method = zip.readUInt16LE(at + 10);
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const tail = zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.toString("utf8", at + 46, at + 46 + nameLength);
    const data = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(data, data + size);
    entries.set(name, method === 8 ? inflateRawSync(raw) : raw);
    at += 46 + nameLength + tail;
  }
  return entries;
}

const unescapeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === "#"
      ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1))
      : ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[
          e.toLowerCase()
        ]!,
  );

const attr = (tag: string, name: string) =>
  unescapeXml(new RegExp(String.raw`\b${name}="([^"]*)"`).exec(tag)?.[1] ?? "");

/** The text runs of a fragment: `<t>` in spreadsheets, `<w:t>` in Word; tabs and breaks kept. */
const runs = (xml: string, tag: "t" | "w:t") =>
  [
    ...xml.matchAll(
      new RegExp(String.raw`<${tag}(?:\s[^>]*)?>([\s\S]*?)</${tag}>|<w:tab/>|<w:br/>`, "g"),
    ),
  ]
    .map((m) => (m[1] !== undefined ? unescapeXml(m[1]) : m[0] === "<w:tab/>" ? "\t" : "\n"))
    .join("");

function part(files: Map<string, Buffer>, name: string): string {
  return files.get(name)?.toString("utf8") ?? "";
}

function xlsxText(files: Map<string, Buffer>): string {
  const shared = [...part(files, "xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map(
    // Phonetic guides (`<rPh>`) are a second reading of the same cell, not text.
    (m) => runs(m[1]!.replace(/<rPh\b[\s\S]*?<\/rPh>/g, ""), "t"),
  );
  const targets = new Map(
    [...part(files, "xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)].map((m) => [
      attr(m[0], "Id"),
      attr(m[0], "Target").replace(/^\/?(xl\/)?/, "xl/"),
    ]),
  );
  const sheets = [...part(files, "xl/workbook.xml").matchAll(/<sheet\b[^>]*>/g)].map((m) => ({
    name: attr(m[0], "name"),
    file: targets.get(attr(m[0], "r:id")),
  }));
  return sheets
    .map(({ name, file }) => {
      const rows = new Map<string, string[]>();
      for (const [, tag, body = ""] of part(files, file ?? "").matchAll(
        /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
      )) {
        const type = attr(tag!, "t");
        const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "";
        const value =
          type === "s" ? shared[+v] : type === "inlineStr" ? runs(body, "t") : unescapeXml(v);
        const ref = attr(tag!, "r");
        if (value) {
          const row = ref.replace(/^[A-Z]+/, "");
          rows.set(row, [...(rows.get(row) ?? []), `${ref}=${value}`]);
        }
      }
      return `--- sheet "${name}" ---\n${[...rows.values()].map((cells) => cells.join(" | ")).join("\n")}`;
    })
    .join("\n\n");
}

function docxText(files: Map<string, Buffer>): string {
  const doc = part(files, "word/document.xml");
  const paragraph = (xml: string) => runs(xml, "w:t");
  const blocks = [
    ...doc.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g),
  ].map(([block]) =>
    block.startsWith("<w:tbl>")
      ? [...block.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g)]
          .map(([row]) =>
            [...row.matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)]
              .map(([cell]) =>
                [...cell.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)]
                  .map((p) => paragraph(p[0]))
                  .join(" "),
              )
              .join(" | "),
          )
          .join("\n")
      : paragraph(block),
  );
  // A comment's anchor is the text between its range markers; the comment body lives in word/comments.xml.
  const comments = [
    ...part(files, "word/comments.xml").matchAll(/<w:comment\b([^>]*)>([\s\S]*?)<\/w:comment>/g),
  ].map(([, tag, body]) => {
    const id = attr(tag!, "w:id");
    const anchor = new RegExp(
      String.raw`<w:commentRangeStart w:id="${id}"/>([\s\S]*?)<w:commentRangeEnd w:id="${id}"/>`,
    ).exec(doc);
    const on = anchor ? ` on "${paragraph(anchor[1]!)}"` : "";
    return `[comment ${id}] ${attr(tag!, "w:author")} ${attr(tag!, "w:date")}${on}: ${[...body!.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map((p) => paragraph(p[0])).join(" ")}`;
  });
  return [
    blocks.join("\n"),
    comments.length ? `--- review comments ---\n${comments.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const officeExtensions = [".xlsx", ".docx"];

/** Cell grid (xlsx) or paragraphs, tables and review comments (docx) of an Office file's bytes. */
export function readOfficeText(extension: string, bytes: Buffer): string {
  const files = unzip(bytes);
  return extension === ".xlsx" ? xlsxText(files) : docxText(files);
}
