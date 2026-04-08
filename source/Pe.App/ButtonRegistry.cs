using Autodesk.Revit.UI;
using Nice3point.Revit.Extensions.UI;
using Pe.App.Commands.Palette;
using Pe.Tools.Commands;
using Pe.Tools.Commands.AutoTag;
using Pe.Tools.Commands.FamilyFoundry;
using Pe.Tools.Commands.SettingsEditor;

namespace Pe.Tools;

/// <summary>
///     Centralized, type-safe registry for all ribbon buttons.
///     Eliminates runtime errors by ensuring compile-time validation of command types and metadata.
/// </summary>
public sealed class ButtonRegistry {
    /// <summary>
    ///     All button registrations. This is the single source of truth for button configuration.
    /// </summary>
    private static readonly List<IButtonRegistration> Registrations = new() {
        Register<CmdScheduleManager>(new ButtonRegistration<CmdScheduleManager> {
            Text = "Schedule Manager Creator",
            SmallImage = "Red_16.png",
            LargeImage = "Red_32.png",
            ToolTip = "Create individual schedules or batches from a profile.",
            Container = new ButtonContainer.Panel("Migration")
        }),
        Register<CmdScheduleManagerSerialize>(new ButtonRegistration<CmdScheduleManagerSerialize> {
            Text = "Schedule Manager Serializer",
            SmallImage = "Red_16.png",
            LargeImage = "Red_32.png",
            ToolTip = "Serialize schedules.",
            Container = new ButtonContainer.Panel("Migration")
        }),
        Register<CmdFFManager>(new ButtonRegistration<CmdFFManager> {
            Text = "FF Manager Creator",
            SmallImage = "Red_16.png",
            LargeImage = "Red_32.png",
            ToolTip = "Manage families in a variety of ways from the Family Foundry.",
            Container = new ButtonContainer.Panel("Migration")
        }),
        Register<CmdFFManagerProjectSnapshot>(new ButtonRegistration<CmdFFManagerProjectSnapshot> {
            Text = "FF Snapshot Projector",
            SmallImage = "Red_16.png",
            LargeImage = "Red_32.png",
            ToolTip =
                "Capture the current family state, project it to an FF profile, and optionally apply that projected profile to a fresh family document.",
            Container = new ButtonContainer.Panel("Migration")
        }),
        Register<CmdFFMigrator>(new ButtonRegistration<CmdFFMigrator> {
            Text = "FF Migrator",
            SmallImage = "Red_16.png",
            LargeImage = "Red_32.png",
            ToolTip = "Process families in a variety of ways from the Family Foundry.",
            Container = new ButtonContainer.Panel("Migration")
        }),
        Register<CmdFFMakeATVariants>(new ButtonRegistration<CmdFFMakeATVariants> {
            Text = "Make AT Variants",
            SmallImage = "Red_16.png",
            LargeImage = "Red_32.png",
            ToolTip =
                "Create Air Terminal variants from an air terminal family by prepopulating the PE_G___TagInstance parameter and setting an existing duct connector's connection settings properly.",
            Container = new ButtonContainer.Panel("Migration")
        }),
        Register<CmdPltCommands>(new ButtonRegistration<CmdPltCommands> {
            Text = "Command Palette",
            SmallImage = "square-terminal16.png",
            LargeImage = "square-terminal32.png",
            ToolTip =
                "Search and execute Revit commands quickly without looking through Revit's tabs, ribbons, and panels. Not all commands are guaranteed to run.",
            Container = new ButtonContainer.Panel("Tools")
        }),
        Register<CmdPltViews>(new ButtonRegistration<CmdPltViews> {
            Text = "All",
            SmallImage = "Red_16.png",
            LargeImage = "Red_32.png",
            ToolTip = "Search and open all views, schedules, and sheets in the current document.",
            Container = new ButtonContainer.Split("View Palette", "Tools")
        }),
        Register<CmdPltViewsOnly>(new ButtonRegistration<CmdPltViewsOnly> {
            Text = "Views",
            SmallImage = "Red_16.png",
            LargeImage = "Red_32.png",
            ToolTip = "Search and open views in the current document.",
            Container = new ButtonContainer.Split("View Palette", "Tools")
        }),
        Register<CmdPltSchedules>(new ButtonRegistration<CmdPltSchedules> {
            Text = "Schedules",
            SmallImage = "Red_16.png",
            LargeImage = "Red_32.png",
            ToolTip = "Search and open schedules in the current document.",
            Container = new ButtonContainer.Split("View Palette", "Tools")
        }),
        Register<CmdPltSheets>(new ButtonRegistration<CmdPltSheets> {
            Text = "Sheets",
            SmallImage = "Red_16.png",
            LargeImage = "Red_32.png",
            ToolTip = "Search and open sheets in the current document.",
            Container = new ButtonContainer.Split("View Palette", "Tools")
        }),
        Register<CmdPltMruViews>(new ButtonRegistration<CmdPltMruViews> {
            Text = "MRU Views",
            SmallImage = "Red_16.png",
            LargeImage = "Red_32.png",
            ToolTip = "Open recently visited views in MRU (Most Recently Used) order.",
            Container = new ButtonContainer.Panel("Tools")
        }),
        Register<CmdPltFamilies>(new ButtonRegistration<CmdPltFamilies> {
            Text = "Families",
            SmallImage = "Red_16.png",
            LargeImage = "Red_32.png",
            ToolTip = "Browse families in the current document.",
            Container = new ButtonContainer.Split("Family Palette", "Tools")
        }),
        Register<CmdPltFamilyTypes>(new ButtonRegistration<CmdPltFamilyTypes> {
            Text = "Types",
            SmallImage = "Red_16.png",
            LargeImage = "Red_32.png",
            ToolTip = "Browse family types in the current document.",
            Container = new ButtonContainer.Split("Family Palette", "Tools")
        }),
        Register<CmdPltFamilyInstances>(new ButtonRegistration<CmdPltFamilyInstances> {
            Text = "Instances",
            SmallImage = "Red_16.png",
            LargeImage = "Red_32.png",
            ToolTip = "Browse family instances in the current document.",
            Container = new ButtonContainer.Split("Family Palette", "Tools")
        }),
        Register<CmdPltFamilyElements>(new ButtonRegistration<CmdPltFamilyElements> {
            Text = "Family Elements",
            SmallImage = "Red_16.png",
            LargeImage = "Red_32.png",
            ToolTip = "Browse elements inside the current family document.",
            Container = new ButtonContainer.Panel("Tools")
        }),
        Register<CmdPltTasks>(new ButtonRegistration<CmdPltTasks> {
            Text = "Task Palette",
            SmallImage = "Red_16.png",
            LargeImage = "Red_32.png",
            ToolTip = "Execute custom code snippets and tasks for prototyping and testing.",
            LongDescription = """
                              Task Palette provides quick access to executable code snippets and utilities.

                              Perfect for:
                              - Rapid prototyping of new features
                              - Testing Revit API behavior
                              - Running one-off cleanup or export operations
                              - Debugging and inspection tasks

                              Tasks are organized by category and tracked by usage frequency.
                              """,
            Container = new ButtonContainer.Panel("Tools")
        }),
        Register<CmdTapMaker>(new ButtonRegistration<CmdTapMaker> {
            Text = "Tap Maker",
            SmallImage = "Red_16.png",
            LargeImage = "Red_32.png",
            ToolTip =
                "Add a (default) 6\" tap to a clicked point on a duct face. Works in all views and on both round/rectangular ducts.",
            LongDescription = """
                              Add a (default) 6" tap to a clicked point on a duct face. Works in all views and on both round/rectangular ducts.
                              Automatic click-point adjustments will prevent overlaps (with other taps) and overhangs (over face edges).
                              Automatic size adjustments will size down a duct until it fits on a duct face.

                              In the event an easy location or size adjustment is not found, no tap will be placed.
                              """,
            Container = new ButtonContainer.Panel("Tools")
        }),
        Register<CmdApsAuthPKCE>(new ButtonRegistration<CmdApsAuthPKCE> {
            Text = "OAuth PKCE",
            SmallImage = "id-card16.png",
            LargeImage = "id-card32.png",
            ToolTip =
                "Get an access token from Autodesk Platform Services. This is primarily for testing purposes, but running it will not hurt anything.",
            Container = new ButtonContainer.PullDown("General", "Manage")
        }),
        Register<CmdApsAuthNormal>(new ButtonRegistration<CmdApsAuthNormal> {
            Text = "OAuth Normal",
            SmallImage = "id-card16.png",
            LargeImage = "id-card32.png",
            ToolTip =
                "Get an access token from Autodesk Platform Services. This is primarily for testing purposes, but running it will not hurt anything.",
            Container = new ButtonContainer.PullDown("General", "Manage")
        }),
        Register<CmdCacheParametersService>(new ButtonRegistration<CmdCacheParametersService> {
            Text = "Cache Params Svc",
            SmallImage = "Red_16.png",
            LargeImage = "Red_32.png",
            ToolTip = "Cache the parameters service data for use in the Family Foundry command.",
            Container = new ButtonContainer.PullDown("General", "Manage")
        }),
        Register<CmdAutoTag>(new ButtonRegistration<CmdAutoTag> {
            Text = "AutoTag",
            SmallImage = "Red_16.png",
            LargeImage = "Red_32.png",
            ToolTip = "Manage AutoTag - automatically tag elements when placed based on configured rules.",
            LongDescription = """
                              AutoTag automatically tags elements when they are placed in the model.

                              Features:
                              - Initialize/configure AutoTag settings for the document
                              - Enable/disable automatic tagging
                              - Catch-up tag all untagged elements
                              - Edit settings via JSON with schema autocomplete
                              - View full configuration details

                              Settings are stored in the document using Extensible Storage.
                              """,
            Container = new ButtonContainer.PullDown("General", "Manage")
        }),
        Register<CmdSettingsEditor>(new ButtonRegistration<CmdSettingsEditor> {
            Text = "Settings Editor",
            SmallImage = "monitor-down16.png",
            LargeImage = "monitor-down32.png",
            ToolTip = "Manually connect or disconnect this Revit session from the external settings editor host.",
            LongDescription = """
                              The external settings editor runs out of process.

                              Use this command to:
                              - connect this Revit session to the manually launched host
                              - disconnect when you want zero bridge activity
                              - open the browser-based settings editor
                              """,
            Container = new ButtonContainer.PullDown("General", "Manage")
        })
    };

    /// <summary>
    ///     Helper method to create a registration entry. Improves readability in the registry definition.
    /// </summary>
    private static IButtonRegistration Register<TCommand>(ButtonRegistration<TCommand> registration)
        where TCommand : IExternalCommand, new() => registration;

    /// <summary>
    ///     Builds the entire ribbon from the registry definitions.
    ///     Creates panels, pulldown buttons, and push buttons with all metadata.
    /// </summary>
    /// <param name="app">The UIControlledApplication to add the ribbon to.</param>
    /// <param name="tabName">The name of the ribbon tab to create.</param>
    public static void BuildRibbon(UIControlledApplication app, string tabName) {
        var panels = new Dictionary<string, RibbonPanel>();
        var pulldowns = new Dictionary<string, PulldownButton>();
        var splitButtons = new Dictionary<string, SplitButton>();

        // Extract unique panel names in order of first appearance
        var panelNames = Registrations
            .Select(r => r.Container switch {
                ButtonContainer.Panel p => p.PanelName,
                ButtonContainer.PullDown pd => pd.PanelName,
                ButtonContainer.Split s => s.PanelName,
                _ => null
            })
            .OfType<string>()
            .Distinct()
            .ToList();

        // Create all panels upfront
        foreach (var panelName in panelNames)
            panels[panelName] = app.CreatePanel(panelName, tabName);

        // Create all buttons in registration order
        foreach (var registration in Registrations)
            _ = registration.CreateButton(app, panels, pulldowns, splitButtons);
    }

    /// <summary>
    ///     Container discriminated union representing where a button should be placed.
    /// </summary>
    public abstract record ButtonContainer {
        /// <summary>
        ///     Button should be added directly to a ribbon panel.
        /// </summary>
        public sealed record Panel(string PanelName) : ButtonContainer;

        /// <summary>
        ///     Button should be added to a pulldown button within a panel.
        /// </summary>
        public sealed record PullDown(string PullDownName, string PanelName) : ButtonContainer;

        /// <summary>
        ///     Button should be added to a split button within a panel.
        /// </summary>
        public sealed record Split(string SplitName, string PanelName) : ButtonContainer;
    }

    /// <summary>
    ///     Non-generic interface for button registrations to allow heterogeneous collections.
    /// </summary>
    private interface IButtonRegistration {
        ButtonContainer Container { get; }

        PushButton CreateButton(UIControlledApplication app,
            Dictionary<string, RibbonPanel> panels,
            Dictionary<string, PulldownButton> pulldowns,
            Dictionary<string, SplitButton> splitButtons);
    }

    /// <summary>
    ///     Strongly-typed button registration that includes command type, display metadata, and container.
    /// </summary>
    private sealed record ButtonRegistration<TCommand> : IButtonRegistration where TCommand : IExternalCommand, new() {
        public string Text { get; init; } = string.Empty;
        public string SmallImage { get; init; } = string.Empty;
        public string LargeImage { get; init; } = string.Empty;
        public string ToolTip { get; init; } = string.Empty;
        public string? LongDescription { get; init; }
        public ButtonContainer Container { get; init; } = new ButtonContainer.Panel(string.Empty);

        public PushButton CreateButton(
            UIControlledApplication app,
            Dictionary<string, RibbonPanel> panels,
            Dictionary<string, PulldownButton> pulldowns,
            Dictionary<string, SplitButton> splitButtons) {
            var button = this.Container switch {
                ButtonContainer.Panel panel => this.CreatePanelButton(panels, panel),
                ButtonContainer.PullDown pullDown => this.CreatePullDownButton(panels, pulldowns, pullDown),
                ButtonContainer.Split split => this.CreateSplitButton(panels, splitButtons, split),
                _ => throw new InvalidOperationException($"Unknown container type: {this.Container.GetType().Name}")
            };

            this.HydrateButtonMetadata(button);
            return button;
        }

        private PushButton CreatePanelButton(
            Dictionary<string, RibbonPanel> panels,
            ButtonContainer.Panel panelContainer) {
            if (!panels.TryGetValue(panelContainer.PanelName, out var panel))
                throw new InvalidOperationException(
                    $"Panel '{panelContainer.PanelName}' not found. Ensure panels are created before buttons.");

            return panel.AddPushButton<TCommand>(this.Text);
        }

        private PushButton CreatePullDownButton(
            Dictionary<string, RibbonPanel> panels,
            Dictionary<string, PulldownButton> pulldowns,
            ButtonContainer.PullDown pullDownContainer) {
            var key = $"{pullDownContainer.PanelName}.{pullDownContainer.PullDownName}";

            if (!pulldowns.TryGetValue(key, out var pulldown)) {
                if (!panels.TryGetValue(pullDownContainer.PanelName, out var panel))
                    throw new InvalidOperationException(
                        $"Panel '{pullDownContainer.PanelName}' not found for pulldown '{pullDownContainer.PullDownName}'.");

                pulldown = panel.AddPullDownButton(pullDownContainer.PullDownName);
                pulldowns[key] = pulldown;
            }

            return pulldown.AddPushButton<TCommand>(this.Text);
        }

        private PushButton CreateSplitButton(
            Dictionary<string, RibbonPanel> panels,
            Dictionary<string, SplitButton> splitButtons,
            ButtonContainer.Split splitContainer) {
            var key = $"{splitContainer.PanelName}.{splitContainer.SplitName}";

            if (!splitButtons.TryGetValue(key, out var splitButton)) {
                if (!panels.TryGetValue(splitContainer.PanelName, out var panel))
                    throw new InvalidOperationException(
                        $"Panel '{splitContainer.PanelName}' not found for split button '{splitContainer.SplitName}'.");

                splitButton = panel.AddSplitButton(splitContainer.SplitName);
                splitButtons[key] = splitButton;
            }

            return splitButton.AddPushButton<TCommand>(this.Text);
        }

        private void HydrateButtonMetadata(PushButton button) {
            _ = button.SetImage(ValidateImageUri(this.SmallImage))
                .SetLargeImage(ValidateImageUri(this.LargeImage))
                .SetToolTip(this.ToolTip);

            if (!string.IsNullOrEmpty(this.LongDescription))
                _ = button.SetLongDescription(this.LongDescription);
        }

        private static string ValidateImageUri(string fileName) =>
            new Uri($"pack://application:,,,/Pe.App;component/resources/{fileName.ToLowerInvariant()}",
                UriKind.Absolute).ToString();
    }
}