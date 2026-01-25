using Autodesk.Windows;
using System.ComponentModel;
using System.Windows.Media;

namespace Pe.Global.Revit.Ui;

public class Ribbon {
    /// <summary>
    ///     Container types that can have child ribbon items.
    ///     Static to avoid allocation on every HasItemsCollection call.
    /// </summary>
    private static readonly HashSet<string> ContainerTypes = [
        "RibbonFoldPanel",
        "RibbonRowPanel",
        "RibbonSplitButton",
        "RibbonChecklistButton",
        "RvtMenuSplitButton",
        "SplitRadioGroup",
        "DesignOptionCombo",
        "RibbonMenuItem",
        "SwitchWindowMenuButton" // Dynamic menu showing open views 
    ];

    public static IEnumerable<DiscoveredTab> GetAllTabs() =>
        ComponentManager.Ribbon.Tabs
            .Where(tab => tab.IsVisible && tab.IsEnabled)
            .Select(tab => new DiscoveredTab {
                Id = tab.Id,
                Name = tab.Title,
                Panels = tab.Panels,
                DockedPanels = tab.DockedPanelsView,
                RibbonControl = tab.RibbonControl
            })
            .ToList();

    public static IEnumerable<DiscoveredPanel> GetAllPanels() =>
        GetAllTabs()
            .SelectMany(tab => tab.Panels
                .Where(panel => panel.IsVisible && panel.IsEnabled)
                .Select(panel => new DiscoveredPanel {
                    Tab = panel.Tab,
                    Cookie = panel.Cookie,
                    Source = panel.Source,
                    RibbonControl = panel.RibbonControl
                }))
            .ToList();

    /// <summary>
    ///     Retrieves all commands from the ribbon with specialized handling for each item type.
    /// </summary>
    public static IEnumerable<DiscoveredCommand> GetAllCommands() {
        var panels = GetAllPanels();
        var commandList = new List<DiscoveredCommand>();

        foreach (var panel in panels) {
            foreach (var item in panel.Source.Items) {
                if (!item.IsVisible || !item.IsEnabled) continue;
                var command = ProcessRibbonItem(item, panel, commandList);
                if (command != null) commandList.Add(command);
            }
        }

        // Deduplicate by ID, keeping the first occurrence of each unique ID
        var uniqueCommands = commandList
            .GroupBy(c => c.Id)
            .Select(g => g.First())
            .ToList();

        return uniqueCommands;
    }

    /// <summary>
    ///     Processes individual ribbon items based on their type with specialized handling.
    /// </summary>
    private static DiscoveredCommand? ProcessRibbonItem(dynamic item,
        DiscoveredPanel panel,
        List<DiscoveredCommand> commandList
    ) {
        // Note: IsVisible and IsEnabled are checked by caller for top-level items,
        // but we still need to check for recursively processed child items
        if (!item.IsEnabled || !item.IsVisible) return null;

        // Check if this is a leaf node (no children) - either not a container type, 
        // or a container with null/empty Items collection
        var isContainer = IsContainerType(item);
        var hasItems = isContainer && item.Items != null && item.Items.Count > 0;

        if (!hasItems) {
            // Extract image from ribbon item
            ImageSource? imageSource = null;
            try {
                // TODO: the problem doesn't seem to be here, however the Command Palette is not showing images
                // for commands that are nested in a stack button or sommething (ie. has a name like "<StackButtonName>: <CommandName>" in the palette)
                imageSource = item.LargeImage;
            } catch {
                // Ignore errors accessing Image property
            }

            return new DiscoveredCommand {
                Id = item.Id?.ToString() ?? "",
                Name = item.Name?.ToString() ?? "",
                Text = item.Text?.ToString() ?? "",
                ToolTip = item.ToolTip,
                Description = item.Description?.ToString() ?? "",
                ToolTipResolver = item.ToolTipResolver,
                Tab = panel.Tab.Title,
                Panel = panel.Cookie,
                ItemType = item.GetType().Name,
                Image = imageSource
            };
        }

        // Recursively process child items for container types
        // Safe to iterate now since we verified item.Items is not null above
        foreach (var childItem in item.Items) {
            var childCommand = ProcessRibbonItem(childItem, panel, commandList);
            if (childCommand != null) commandList.Add(childCommand);
        }

        return null;
    }

    /// <summary> Determines if a ribbon item type supports having child items. </summary>
    private static bool IsContainerType(dynamic item) {
        // Cast to object first to avoid dynamic dispatch issues with extension methods
        var itemType = ((object)item).GetType().Name;
        return ContainerTypes.Contains(itemType);
    }

    #region Diagnostic Logging

    /// <summary>
    ///     Logs all ribbon items on a specific tab for investigation.
    ///     Use this to discover what type "Switch Windows" is.
    /// </summary>
    /// <param name="tabNameFilter">Optional: filter to specific tab (e.g., "View"). Null = all tabs.</param>
    public static void LogAllRibbonItems(string? tabNameFilter = null) {
        Console.WriteLine("=== RIBBON DIAGNOSTIC START ===");

        foreach (var tab in ComponentManager.Ribbon.Tabs) {
            if (tabNameFilter != null && !tab.Title.Contains(tabNameFilter, StringComparison.OrdinalIgnoreCase))
                continue;

            Console.WriteLine($"\n[TAB] '{tab.Title}' (Id={tab.Id}, Visible={tab.IsVisible}, Enabled={tab.IsEnabled})");

            foreach (var panel in tab.Panels) {
                Console.WriteLine($"  [PANEL] '{panel.Source?.Title}' (Cookie={panel.Cookie}, Visible={panel.IsVisible})");

                if (panel.Source?.Items == null) continue;

                foreach (var item in panel.Source.Items) {
                    LogRibbonItemRecursive(item, indent: 4);
                }
            }
        }

        Console.WriteLine("\n=== RIBBON DIAGNOSTIC END ===");
    }

    /// <summary>
    ///     Searches for a specific ribbon item by name/text and logs detailed info about it.
    /// </summary>
    public static void LogItemByName(string searchTerm) {
        Console.WriteLine($"=== SEARCHING FOR: '{searchTerm}' ===");
        var found = false;

        foreach (var tab in ComponentManager.Ribbon.Tabs) {
            foreach (var panel in tab.Panels) {
                if (panel.Source?.Items == null) continue;

                foreach (var item in panel.Source.Items) {
                    found |= SearchAndLogItem(item, searchTerm, tab.Title, panel.Source.Title, 0);
                }
            }
        }

        if (!found) Console.WriteLine($"No items found matching '{searchTerm}'");
        Console.WriteLine("=== SEARCH END ===");
    }

    private static bool SearchAndLogItem(dynamic item, string searchTerm, string tabName, string panelName, int depth) {
        var found = false;
        var itemType = ((object)item).GetType().Name;

        string? id = null, name = null, text = null;
        try { id = item.Id?.ToString(); } catch { }
        try { name = item.Name?.ToString(); } catch { }
        try { text = item.Text?.ToString(); } catch { }

        var matchesSearch = (id?.Contains(searchTerm, StringComparison.OrdinalIgnoreCase) ?? false) ||
                            (name?.Contains(searchTerm, StringComparison.OrdinalIgnoreCase) ?? false) ||
                            (text?.Contains(searchTerm, StringComparison.OrdinalIgnoreCase) ?? false);

        if (matchesSearch) {
            found = true;
            Console.WriteLine($"\n*** FOUND MATCH ***");
            Console.WriteLine($"  Tab: {tabName}");
            Console.WriteLine($"  Panel: {panelName}");
            Console.WriteLine($"  Depth: {depth}");
            LogRibbonItemDetailed(item);
        }

        // Recurse into children
        try {
            if (item.Items != null) {
                foreach (var child in item.Items) {
                    found |= SearchAndLogItem(child, searchTerm, tabName, panelName, depth + 1);
                }
            }
        } catch { }

        return found;
    }

    private static void LogRibbonItemRecursive(dynamic item, int indent) {
        var prefix = new string(' ', indent);
        var itemType = ((object)item).GetType().Name;

        string? id = null, name = null, text = null;
        bool visible = false, enabled = false;

        try { id = item.Id?.ToString(); } catch { }
        try { name = item.Name?.ToString(); } catch { }
        try { text = item.Text?.ToString(); } catch { }
        try { visible = item.IsVisible; } catch { }
        try { enabled = item.IsEnabled; } catch { }

        var displayName = !string.IsNullOrEmpty(text) ? text : (!string.IsNullOrEmpty(name) ? name : id);
        Console.WriteLine($"{prefix}[{itemType}] '{displayName}' (Id={id}, V={visible}, E={enabled})");

        // Try to recurse into children
        try {
            if (item.Items != null && item.Items.Count > 0) {
                foreach (var child in item.Items) {
                    LogRibbonItemRecursive(child, indent + 2);
                }
            }
        } catch { }
    }

    private static void LogRibbonItemDetailed(dynamic item) {
        var itemType = ((object)item).GetType().Name;
        Console.WriteLine($"  Type: {itemType}");

        // Log all readable properties
        var props = ((object)item).GetType().GetProperties();
        foreach (var prop in props) {
            if (!prop.CanRead) continue;
            try {
                var value = prop.GetValue(item);
                var valueStr = value?.ToString() ?? "<null>";
                if (valueStr.Length > 100) valueStr = valueStr[..100] + "...";
                Console.WriteLine($"    {prop.Name}: {valueStr}");
            } catch (Exception ex) {
                Console.WriteLine($"    {prop.Name}: <error: {ex.Message}>");
            }
        }

        // Check for Items collection
        try {
            if (item.Items != null) {
                Console.WriteLine($"  Children ({item.Items.Count}):");
                foreach (var child in item.Items) {
                    var childType = ((object)child).GetType().Name;
                    string? childText = null, childId = null;
                    try { childText = child.Text?.ToString(); } catch { }
                    try { childId = child.Id?.ToString(); } catch { }
                    Console.WriteLine($"    - [{childType}] '{childText ?? childId}'");
                }
            }
        } catch { }
    }

    #endregion
}

public class DiscoveredTab {
    /// <summary> Name, what you see in UI. RibbonTab.Title, DefaultTitle, AutomationName are always same</summary>
    public required string Name { get; set; }

    /// <summary> Internal ID, not sure what it's used for</summary>
    public required string Id { get; set; }

    /// <summary> Panels contained within the tab</summary>
    public required RibbonPanelCollection Panels { get; set; }

    /// <summary> TBD: Not sure what this is, but possibly useful</summary>
    public required ICollectionView DockedPanels { get; set; }

    /// <summary> TBD: Not sure what this is, but possibly useful</summary>
    public required RibbonControl RibbonControl { get; set; }
}

public class DiscoveredPanel {
    /// <summary> The parent tab of this panel</summary>
    public required RibbonTab Tab { get; set; }

    /// <summary> Internal ID, not sure what it's used for and has a strange format</summary>
    public required string Cookie { get; set; }

    /// <summary> Can access Panel items via RibbonPanelSource.Items</summary>
    public required RibbonPanelSource Source { get; set; }

    /// <summary> TBD: Not sure what this is, but possibly useful</summary>
    public required RibbonControl RibbonControl { get; set; }
}

public class DiscoveredCommand {
    /// <summary>
    ///     ID, if postable then it will be the CommandId found in KeyboardShortcuts.xml.
    ///     i.e. either "SCREAMING_SNAKE_CASE" for internal PostableCommand's
    ///     or the "CustomCtrl_%.." format for external addin commands.
    ///     There are often near duplicates, like ID_OBJECTS_FAMSYM and ID_OBJECTS_FAMSYM_RibbonListButton
    ///     It is also often empty or not a commandId at all.
    /// </summary>
    public required string Id { get; set; }

    /// <summary>
    ///     Human-readable name of the command, often empty.
    ///     If empty, this.Text may be non-empty. Both may also be empty.
    /// </summary>
    public required string Name { get; set; }

    /// <summary>
    ///     Another type of name, always similar to Name, often empty.
    ///     RibbonItem.Text, AutomationName, and TextBinding always seem to be same.
    /// </summary>
    public required string Text { get; set; }

    /// <summary> Often empty, look into ToolTipResolver for more information. </summary>
    public object? ToolTip { get; set; }

    /// <summary> The image/icon of the command from the ribbon </summary>
    public ImageSource? Image { get; set; }

    /// <summary> A standin for tooltip? seems to be non-empty more often than Tooltip is.</summary>
    public required string Description { get; set; }

    public object? ToolTipResolver { get; set; }
    public required string Tab { get; set; }
    public required string Panel { get; set; }

    /// <summary> Type of the item, e.g. RibbonButton, RibbonToggleButton, etc. </summary>
    public required string ItemType { get; set; }
}