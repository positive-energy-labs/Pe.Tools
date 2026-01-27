---
name: Unified Sidebar Panel API
overview: Standardize all palette sidebars on ISidebarPanel, remove redundant patterns (NextPalette, raw Sidebar, OnSelectionChangedDebounced), reducing API surface and eliminating pattern confusion.
todos:
  - id: remove-nextpalette
    content: Remove NextPalette from PaletteAction, ActionBinding.IsNextPaletteAction, and Palette.xaml.cs handlers
    status: completed
  - id: remove-sidebar-options
    content: Remove PaletteOptions.Sidebar and PaletteOptions.OnSelectionChangedDebounced properties
    status: completed
  - id: cleanup-factory
    content: Remove raw Sidebar handling code and PaletteSidebar class from PaletteFactory
    status: completed
  - id: migrate-view-panel
    content: Migrate ViewPreviewPanel to ISidebarPanel<UnifiedViewItem>
    status: completed
  - id: migrate-profile-panel
    content: Migrate ProfilePreviewPanel to ISidebarPanel<ProfileListItem>
    status: completed
  - id: migrate-schedule-panel
    content: Migrate SchedulePreviewPanel to ISidebarPanel<ISchedulePaletteItem>
    status: completed
  - id: update-view-palette
    content: Update ViewPaletteBase to use SidebarPanel instead of Sidebar + callback
    status: completed
  - id: update-foundry-builder
    content: Update FoundryPaletteBuilder to use SidebarPanel and pass dependencies to panel
    status: completed
  - id: update-schedule-manager
    content: Update CmdScheduleManager to use SidebarPanel and pass context to panel
    status: completed
  - id: remove-nextpalette-action
    content: Remove redundant NextPalette action from CmdPltCommands
    status: completed
isProject: false
---

# Unified Sidebar Panel API

## Goals

- **One pattern**: All sidebars implement `ISidebarPanel<TItem>`
- **Reduced API**: Remove `Sidebar`, `OnSelectionChangedDebounced`,
  `NextPalette`
- **Clear DX**: Explicit `SidebarPanel = panel` at each call site

## Files to Modify

### Core Infrastructure (Pe.Ui)

**[source/Pe.Ui/Core/PaletteFactory.cs](source/Pe.Ui/Core/PaletteFactory.cs)**

- Remove `Sidebar` property from `PaletteOptions<TItem>`
- Remove `OnSelectionChangedDebounced` property from `PaletteOptions<TItem>`
- Remove handling code for raw `Sidebar` pattern (lines 157-175)
- Keep `SidebarPanel` as the only sidebar mechanism

**[source/Pe.Ui/Core/PaletteAction.cs](source/Pe.Ui/Core/PaletteAction.cs)**

- Remove `NextPalette` property (line 43)
- Update XML docs to remove NextPalette references

**[source/Pe.Ui/Core/ActionBinding.cs](source/Pe.Ui/Core/ActionBinding.cs)**

- Remove `IsNextPaletteAction` method (lines 88-89)

**[source/Pe.Ui/Components/Palette.xaml.cs](source/Pe.Ui/Components/Palette.xaml.cs)**

- Remove `ShowNextPaletteInSidebar` method (lines 461-473)
- Remove NextPalette handling in `ExecuteItemTyped` (lines 487-491)
- Remove NextPalette handling in action menu click handler (lines 259-263)

### Migrate Panels to ISidebarPanel

**[source/Pe.App/Commands/Palette/ViewPalette/ViewPreviewPanel.cs](source/Pe.App/Commands/Palette/ViewPalette/ViewPreviewPanel.cs)**

- Change from `UserControl` to implement `ISidebarPanel<UnifiedViewItem>`
- Add `Clear()` method to reset state
- Change `UpdatePreview(UnifiedViewItem)` to
  `Update(UnifiedViewItem?, CancellationToken)`
- Add `Content` property returning `this`
- Add cancellation token checks for expensive operations

**[source/Pe.App/Commands/FamilyFoundry/FamilyFoundryUi/ProfilePreviewPanel.cs](source/Pe.App/Commands/FamilyFoundry/FamilyFoundryUi/ProfilePreviewPanel.cs)**

- Change from `UserControl` to implement `ISidebarPanel<ProfileListItem>`
- Add `Clear()` method
- Change `UpdatePreview(PreviewData)` to
  `Update(ProfileListItem?, CancellationToken)`
- Panel extracts `PreviewData` from item or uses existing builder pattern

**[source/Pe.App/Commands/FamilyFoundry/ScheduleManagerUi/SchedulePreviewPanel.cs](source/Pe.App/Commands/FamilyFoundry/ScheduleManagerUi/SchedulePreviewPanel.cs)**

- Change from `UserControl` to implement `ISidebarPanel<ISchedulePaletteItem>`
- Add `Clear()` method
- Change `UpdatePreview(SchedulePreviewData)` to
  `Update(ISchedulePaletteItem?, CancellationToken)`
- Panel extracts preview data from item

### Update Palette Creation Sites

**[source/Pe.App/Commands/Palette/ViewPalette/ViewPaletteBase.cs](source/Pe.App/Commands/Palette/ViewPalette/ViewPaletteBase.cs)**

- Replace `Sidebar = new PaletteSidebar { Content = previewPanel }` with
  `SidebarPanel = previewPanel`
- Remove `OnSelectionChangedDebounced = previewPanel.UpdatePreview`

**[source/Pe.App/Commands/FamilyFoundry/FamilyFoundryUi/FoundryPaletteBuilder.cs](source/Pe.App/Commands/FamilyFoundry/FamilyFoundryUi/FoundryPaletteBuilder.cs)**

- Replace `Sidebar = new PaletteSidebar { Content = previewPanel }` with
  `SidebarPanel = previewPanel`
- Remove `OnSelectionChangedDebounced` callback
- Adapt preview data building to work within the panel's `Update` method

**[source/Pe.App/Commands/FamilyFoundry/CmdScheduleManager.cs](source/Pe.App/Commands/FamilyFoundry/CmdScheduleManager.cs)**

- Replace `Sidebar = new PaletteSidebar { Content = previewPanel }` with
  `SidebarPanel = previewPanel`
- Remove `OnSelectionChangedDebounced` callback
- Move preview data building logic into panel or make accessible from item

**[source/Pe.App/Commands/Palette/CmdPltCommands.cs](source/Pe.App/Commands/Palette/CmdPltCommands.cs)**

- Remove the redundant "Edit Shortcuts" `NextPalette` action (lines 63-72)
- Keep only the "Execute" action (SidebarPanel already shows editor on
  selection)

### Delete Obsolete Code

**[source/Pe.Ui/Core/PaletteFactory.cs](source/Pe.Ui/Core/PaletteFactory.cs)**

- Delete `PaletteSidebar` class (lines 204-214) - no longer needed

## Migration Pattern

For each panel, the transformation follows this pattern:

**Before:**

```csharp
public class MyPreviewPanel : UserControl {
    public void UpdatePreview(MyItem item) { ... }
}

// At call site:
Sidebar = new PaletteSidebar { Content = previewPanel },
OnSelectionChangedDebounced = item => previewPanel.UpdatePreview(item)
```

**After:**

```csharp
public class MyPreviewPanel : UserControl, ISidebarPanel<MyItem> {
    UIElement ISidebarPanel<MyItem>.Content => this;
    
    public void Clear() {
        // Reset UI to empty/loading state
    }
    
    public void Update(MyItem? item, CancellationToken ct) {
        if (item == null) { Clear(); return; }
        if (ct.IsCancellationRequested) return;
        // Render preview (with ct checks for expensive work)
    }
}

// At call site:
SidebarPanel = previewPanel
```

## Handling Preview Data Building

For panels where preview data is built externally (FoundryPaletteBuilder,
CmdScheduleManager):

**Option A: Lazy property on item** (like `UnifiedFamilyItem.PreviewData`)

- Works when preview data only depends on the item itself

**Option B: Panel builds preview data** (preferred for complex cases)

- Panel's `Update` method receives item + uses injected dependencies
- Dependencies passed to panel constructor (e.g., `SettingsManager`, `Document`)

For FoundryPaletteBuilder: Pass `SettingsManager` and `queueBuilder` to
ProfilePreviewPanel constructor. For CmdScheduleManager: Pass
`ScheduleManagerContext` to SchedulePreviewPanel constructor.

## Benefits

1. **Single pattern**: No more "which approach should I use?"
2. **Smaller API**: 3 properties removed from PaletteOptions
3. **Built-in features**: All panels get debounce, Clear(), cancellation for
   free
4. **Type safety**: ISidebarPanel contract enforced at compile time
5. **Explicit**: `SidebarPanel = panel` is clear about what's happening
