# TODO:

- revist general json intellisense. Through our many refactors, many providers are no longer properly wired up in local schema writes. The issue may extend to to all schema gen too.
- revisit commit 3e3fa88543b9b5435ea87d89efa88bafc2aa1031
    - revisit shared shcedule profile usage. json intellisense is abolished by using this, also has some null-ralted type issues
    - revisit SchedulePreviePanel crash on line 120: `("Order", sg => sg.SortOrder.ToString())`
- customize pea:
  - make better system prompt
  - refine tools descriptions
  - make Documents/Pe.Tools agent guidance
  - make tool to semantic+structural validate json profiles 
  - expose host endpoints better (guidance and or point to the client)
  - make easier launcher
  - enable only openai models
  - add revit api docs mcp
  - add liteparse or markitdown support or LlamaParse
  - install via pnpm
  -
