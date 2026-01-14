using Autodesk.Windows;
using System.ComponentModel;
using System.Windows.Media;

namespace Pe.Global.Revit.Ui;

public class Ribbon {
    public static IEnumerable<DiscoveredTab> GetAllTabs() {
        var tabs = ComponentManager.Ribbon.Tabs;
        return (from tab in tabs
            where tab.IsVisible && tab.IsEnabled
            select new DiscoveredTab {
                Id = tab.Id,
                Name = tab.Title,
                Panels = tab.Panels,
                DockedPanels = tab.DockedPanelsView,
                RibbonControl = tab.RibbonControl
            }).ToList();
    }

    public static IEnumerable<DiscoveredPanel> GetAllPanels() {
        var tabs = GetAllTabs();
        var panelList = new List<DiscoveredPanel>();
        foreach (var tab in tabs) {
            panelList.AddRange(from panel in tab.Panels
                where panel.IsVisible && panel.IsEnabled
                select new DiscoveredPanel {
                    Tab = panel.Tab, Cookie = panel.Cookie, Source = panel.Source, RibbonControl = panel.RibbonControl
                });
        }

        return panelList;
    }

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
        if (!item.IsEnabled) return null;
        if (!item.IsVisible) return null;

        // Check if this is a leaf node (no children) - either not a container type, 
        // or a container with null/empty Items collection
        var hasItemsCollection = HasItemsCollection(item);
        var hasItems = hasItemsCollection && item.Items != null && item.Items.Count > 0;

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
    private static bool HasItemsCollection(dynamic item) {
        // Cast to object first to avoid dynamic dispatch issues with extension methods
        var itemType = ((object)item).GetType().Name;
        var containerTypes = new[] {
            // Do not change unless to add
            "RibbonFoldPanel", "RibbonRowPanel", "RibbonSplitButton", "RibbonChecklistButton", "RvtMenuSplitButton",
            "SplitRadioGroup", "DesignOptionCombo", "RibbonMenuItem"
        };

        return containerTypes.Contains(itemType);
    }
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