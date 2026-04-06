# Pe.Tools

A suite of Revit add-ins and supporting libraries.

## Add-ins

- Views Palette, browse all the views in a document, open them, and preview
  information about them.
- Command Palette, browse all the commands in the document and run them.
- Family Palette, browse all the families in the document and pick one to place
  or open.
- Family Elements Palette, browse all the elements in a family and pick one to
  edit.
- FF Manager a command for managing individual families.
- FF Migrator a command for bulk processing families.
- FF Param Aggregator a command for aggregating parameter data across an entire
  project.

Libraries rapid fire quick reference:

- The Family Foundry (Pe.Revit.FamilyFoundry namespace), a library for bulk processing
  families, batteries (storage) not included.
- Palette (in Pe.Revit.Ui namespace), a library for creating searchable palettes. Used
  for creating command palettes or UI's to pick between options.
- Storage (Pe.Revit.Global.Services.Storage namespace), a service for standardizing
  file system interaction and a good json experience (lsp, schema examples, less
  verbose writes, etc.).
- Extensions (Pe.Revit.Extensions namespace), a library of extension methods,
  primarily related to Revit families and parameters. These help unify the
  family document/FamilyManager APIs and also wrap for easier use.

## Dev

To enable LSP in Cursor, you must set `"dotnet.server.useOmnisharp": true` in
settings.json. This will allow Cursor's lack of support for IDE config
specification to suppliment with the omnisharp.json file in the root.
