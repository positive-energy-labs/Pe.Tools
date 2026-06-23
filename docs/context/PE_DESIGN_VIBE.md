# Positive Energy — Web Design Guide (for coding agents)

Condensed working reference for building internal tools (calculators, AI chat, project portal). Optimized for implementation, not philosophy.

## The vibe in one line
A design-conscious technical engineering practice. Everything should feel **calm, exact, architecturally literate, and humane** — serious without being cold, warm without being decorative. Sophistication comes from hierarchy, spacing, and restraint, never from ornament.

Five qualities every screen should signal before anyone reads the content: technical seriousness, architectural fluency, calm confidence, humane collaboration, trusted judgment.

Tagline / north star: **Healthy people, healthy planet.**

## Core rules (the non-negotiables)
- **Type creates order before color does.** Establish hierarchy with size/weight/spacing first; use color only to reinforce it.
- **White space is structural**, not leftover. Generous margins, deliberate spacing.
- **Color clarifies structure — it is never decorative or there to "add energy."** Each use needs a reason.
- **Restraint everywhere.** Limit the number of accent colors visible at once. Quiet headers/footers.
- Keep **PE Blue and PE Green** as the anchors. The earthy supporting palette stays secondary.

## Typography
Two typefaces, both freely available (Google Fonts):

| Role | Font | Use for |
|------|------|---------|
| Working/body (default) | **Open Sans** | body text, UI labels, tables, form inputs, data, navigation, anything dense or scanned |
| Display (selective only) | **Spectral** (serif) | page titles, major section headers, hero statements |

Rules:
- Open Sans is the default for ~everything. Spectral is a garnish — never use it for body, tables, dense content, or small text.
- Use Spectral in Medium / Semibold / Bold weights for headings. Avoid Spectral Italic in functional UI.
- Maintain a clear, minimal hierarchy: title → section head → subsection head → body → caption/metadata.

## Color palette

**Anchors (always primary):**
| Name | Hex | Use |
|------|-----|-----|
| PE Blue | `#005695` | primary headings, primary buttons, nav anchors, key structural moments, links |
| PE Green | `#72C6A2` | secondary emphasis, accents, success/active states, selected diagram categories |

**Supporting palette (always secondary, use sparingly):**
| Name | Hex | Use |
|------|-----|-----|
| Slate Field | `#4F6473` | subheads, table headers, labels, rules, data emphasis |
| Lichen | `#7C8B6B` | secondary category distinctions (when green is already in use) |
| Clay Wash | `#B78D6A` | rare callouts, dividers, highlighted notes. **Never a dominant UI color.** |
| Kiln Dust | `#C8BDAF` | soft fills, shaded boxes, chart fills, bands |
| Basalt | `#3E4340` | default body text, strong neutral headings, pull quotes |
| Mist | `#E8E4DD` | page/section background tint, cards, light table fills |

**Working ratio** (keeps it from getting muddy):
- ~60% white / off-white / Mist
- ~15% PE Blue
- ~10% PE Green
- ~15% supporting accents total

Pairings that work: Basalt text on Mist, Basalt text on Kiln Dust. Body text default = Basalt (not pure black).

## Layout / page architecture
- Generous margins; let empty space read as structure.
- Quiet headers and footers — keep them out of the way.
- Use rules and dividers sparingly, with real spacing around them.
- Section openings reset the eye via scale and spacing.
- The page should feel like a quiet, consistent system: enough order to earn trust before the content is read.

## Tables, data, diagrams
This firm lives in schedules and diagrams, so these matter a lot for the calculator/portal tools:
- Separate headings clearly from data (Slate Field headers work well).
- Group related fields; emphasize scanability; avoid crowding.
- Make exceptions/priorities easy to find at a glance.
- Diagrams/charts: clarity over spectacle. Limited, consistent color logic. Annotate selectively. Distinguish background info from active info.
- Don't rely on color alone to carry meaning (labels/weight/structure must still work in grayscale).

## Imagery
- Real buildings, conditions, collaborators — not stock lifestyle photography.
- No images that exist only to fill space or perform luxury.
- Respect texture, weathering, material truth.

## Voice & UI copy
Voice: clear, calm, technically literate, human, authoritative without theatrics.

Do:
- Lead with the point. Name the purpose early.
- Respect the reader's intelligence — don't oversimplify or oversell.
- Guide the reader (clear headings, sensible labels, obvious next steps).
- State difficult things plainly and calmly.

Don't:
- Sound like marketing copy or use inflated adjectives.
- Manufacture urgency or dramatize.
- Posture; let clarity do the persuading.

Tone by context: the **website is the most "open"** register (clear, substantive, slightly warmer). Internal tools and admin material should be **direct, neutral, exact**.

## Applying this to the three POCs

**Internal calculator tools** — Function first. Open Sans throughout, Slate Field table/label structure, PE Blue for primary actions, Mist/Kiln Dust for grouping/fills. Color only where it aids comprehension (categories, zones, results emphasis). Keep results scannable; strong number alignment.

**AI chat interface** — Calm and uncluttered. Lots of white space. PE Blue for primary/send actions and user emphasis, PE Green for accents/active states, Basalt body text on white/Mist. Spectral okay for a title or empty-state heading only. Keep the chrome quiet so content leads.

**Custom project portal** — Most "branded" of the three but still restrained. Spectral for page/section titles, Open Sans everywhere else, Mist section backgrounds, PE Blue navigation anchors, supporting palette for cards/bands/diagrams (sparingly). Stable, simple navigation; real project imagery if any.

---
*Source: Positive Energy Brand Manifesto & Guide (condensed). Drawing/Revit color standards and brand history omitted — not relevant to web UI.*
