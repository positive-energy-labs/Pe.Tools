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
  - set default provider/model for all modes, observer and reflector, and make bespoke/agents. We want to posture more towards revit agent than coding agent.
  - set other defaults like yolo, and om threshholds.
  - write to our own settings path: `createMastraCode() loads settings at startup via loadSettings(config?.settingsPath)`
  - make C# host client a first class citizen
  - fix guidance for revit docs mcp to prevent misfires for semantic searches
  - seed scripting behvior instructions better (right now it always misfires the first try, then finds a smample script and copies that)
  - add open view to host-status
  - add parameter service cache and parameters.txt file path to host-status????
  - add log paths to host-status
  - add project-browser organization to host-status??? I think this is kinda essential so agents know what it means when you say "mechanical schedule" or "design view for level 1". I feel like a top-level file-strucutre like output could be useful here. whether in a project or family this will help model get on same page as user. 
    - or maybe make dedicated project-browser endpoint, because being able to see all views and sheets etc (with sorting/organization metadata) could be really useful. adding it in host-status would require a really abbreviated version for it to make sense.


## pea System Prompt:

```
You are a Revit agent named pea (for Positive Energy Agent) designed to work alongside MEP engineers, architects, and BIM users. Your primary modalities are as a question-answering chatbot and a scripting/automation assistant. 

Positive Energy application Architecture: 
- Revit addin suite
- Pe.Host: local http bridge between Revit and frontends; regularly monitor its status. 
- frontends: pea cli (web UIs coming soon)

Pe.Host also exposes a number of revit-snooping http endpoints which mask unfriendly Revit API code. These are exposed as a C# client available in scripting.
```

## pea Tools
```
check_status
execute_revit_script
execute_powershell
edit_file
ocr_file
... should we make tools for every host endpoint too? or maybe scope them to specialized subagents? or put them behind tool_search_tool? or just keep them accessible from the C# client and improve guidance on that?
```
maybe remove some extra coding agent related tools?

## Documents/Pe.Tools AGENTS.md
```
The <user>/Documents/Pe.Tools workspace houses user-facing app data. 

Within ./settings and ./output each top level folder corresponds to a Revit addin. addin settings are json with injected schemas. Pe.Tools' storage hydrates schemas with Revit data at runtime to enable LSP when hand authoring. Note that the most crucial LSP suggestions are document-dependent, e.g. parameter names, line styles, etc.)

In ./scripts every workspace is csproj where reusable scripts can be written. Microsoft.CodeAnalysis is used to compile, then run *one* .cs file with *one* PeScriptingContainer* in workspace/src. A history of inline scripts is also preserved in ./scripting/.inline.
```
