import { DUCTS_SHEET_GUIDE } from "@pe/agent-contracts";
import { z } from "zod";

export function renderDuctsSkill(): string {
  return [
    "---",
    "name: calc-duct-pressure-drop",
    "description: Use for any ductwork airflow question - what a unit (ERV, MUAS, fan coil, AHU) connects or ties into, what it feeds or draws from, which way air flows - and for duct pressure drop, static pressure or required ESP. Reads the fan sheet and explains its path ends, blockers and sourced inputs.",
    "---",
    "",
    "# Calculate Duct Pressure Drop",
    "",
    DUCTS_SHEET_GUIDE.summary,
    "Connectivity and airflow questions (what a unit ties into, where its air goes, whether two units are connected) are answered by this sheet's path ends and legs, which resolve airflow direction from the network. Never answer them from a script over connector Direction or flow-direction flags: those are per-connector labels, not the air's path, and reading them reads the air backwards. Name each unit by its mark or type, and say when a path ends at an open end instead of a unit.",
    "Registered reads use route:reads.value with { read, args, subscription, generation }: put target and sheet selectors in args, choose a unique subscription per consumer and a nonnegative generation, and read the result from value.data.",
    "Sheet and roster reads never edit Work. Stage edits through route:ducts Work verbs at expectedRevision. For duct losses, heal, or assign-fan, send only the document target and work: { key, revision }, the route:ducts Work handle; never send native arrays or coefficients. Before planning duct losses, stage route:fans writeIntent.walk { unitId, portIndex } from route:reads.value (read fans.roster); the plan reads sibling Fans Work at the same document, or readWorks.fans. Fan write cells are derived from the walk and staged edits. The open Page never supplies the walk. Stage writeIntent.groups for heal scope or writeIntent.fan { unitId, systemId } for fan assignment. Preview first; apply re-derives and refuses a changed seal without clearing edits.",
    "Frame an equipment question as what each component on the walked path does to the air, not which number is right. For each component whose number feeds a calc (flow, pressure, capacity, rating, and a value that cannot be wrong, such as a connection size), get that component's own data: the project cut sheet or submittal first, then a schedule, then the vendor's site. Cite the page.",
    "Read schedules and charts with read_document, image: true and a crop. The text layer drops strike-throughs and revision clouds.",
    "",
    "## Evidence for a calc-relevant number",
    "",
    "When two sources disagree on a number that feeds a calc, or the user asks whether the documents were checked, do these in order before you answer:",
    "0. Locate the project folder before anything else. Take the project's distinctive words from the document title. List every drive letter, including mapped network drives and synced shared drives (for example G:/Shared drives/*/), and match folder names only, two or three levels deep on each; never run a deep recursive find over a home or OneDrive folder. A firm keeps one project folder with calcs, submissions and cut sheets in it; a model-sync mirror (ACC, Desktop Connector) holds models, not the design record. A Pe.Tools source checkout and its .artifacts are developer evidence, never project documents.",
    "1. Inventory the project folder once. List every file recursively with its path, extension, size and modified date (one shell command; do not open files yet). Sort them into kinds: design-basis calcs (spreadsheets such as .xlsx with load, ventilation, makeup air or sizing in the name or path), issued documents (ASI, addendum, bulletin, RFI response, revision, CD or permit set), submittals and cut sheets, schedules, and markups or redlines.",
    "2. Rank the sources. The newest issued document for that system wins over older issued sets, and every issued document wins over markups, redlines and drafts. Take the date from the file name first, then the title block, then the modified date. On the winning sheet, a revision cloud or delta marks a change, and a struck-through row or value is deleted: say so instead of quoting it. Name the document you ranked first and why. Before you say a tag is not scheduled, search the text of every page of the winning set for it. Before you quote any schedule row, render that page with read_document, image: true and a crop around the row: the text layer reports a struck row as live.",
    "3. Find the design basis. A scheduled or modeled number came from a calc. Open every design-basis spreadsheet that could hold it (read all tabs with Python, openpyxl with data_only=True, and print the labelled rows), and find the row that produces the number. Cite file, tab and cell, and state the basis in words.",
    "4. Get each component's performance data. For the fan, heater, coil, filter, damper and louver on the walked path, use the project cut sheet or submittal; when that lacks a curve or a rating, fetch the manufacturer's published data yourself: WebSearch for the exact model with submittal, performance or catalog, download the PDF with curl into the product home, and read the curve with read_document, image: true and a crop. Read off the value at the design flow. Never ask the user or a rep for data a public page holds.",
    "5. Check each candidate number against each component's limits (minimum airflow, maximum velocity, available static pressure), and say which candidate the components can actually support.",
    "6. Report one row per component on the walked path (fan, heater or coil, filter, silencer, damper, louver or hood, the duct itself, and each unit the path ends at): its model, the source of its data, its pressure drop or available pressure at the design flow, and its limit. A schedule source is a page you rendered and cropped to that row; a vendor source is a URL you fetched. A cell may stay blank only after you ran a WebSearch for that exact model's data and it came back empty: name the query. A blank with no search behind it means step 4 is not done.",
    "When a sheet input is blank and the model or a document has the value, fill it yourself through the Ducts tool's Work with the source cited, then read the sheet again. Do not only offer to.",
    "",
    ...DUCTS_SHEET_GUIDE.walk.map((step, i) => `${i + 1}. ${step}`),
    "",
    ...DUCTS_SHEET_GUIDE.never.map((rule) => `- ${rule}`),
    "",
  ].join("\n");
}

export const ductsGuideInputSchema = z.strictObject({
  section: z.enum(["summary", "walk", "never"]).optional(),
});
export type DuctsGuideSection = keyof typeof DUCTS_SHEET_GUIDE;
export function ductsGuideReading(section?: DuctsGuideSection) {
  return section ? { [section]: DUCTS_SHEET_GUIDE[section] } : DUCTS_SHEET_GUIDE;
}
