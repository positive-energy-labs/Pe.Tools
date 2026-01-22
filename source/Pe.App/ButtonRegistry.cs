using Autodesk.Revit.UI;
using Pe.App.Commands.Palette;
using Pe.Tools.Commands;
using Pe.Tools.Commands.AutoTag;
using Pe.Tools.Commands.FamilyFoundry;

namespace Pe.Tools;

/// <summary>
/// Centralized, type-safe registry for all ribbon buttons.
/// Eliminates runtime errors by ensuring compile-time validation of command types and metadata.
/// </summary>
public sealed class ButtonRegistry {
    /// <summary>
    /// Container discriminated union representing where a button should be placed.
    /// </summary>
    public abstract record ButtonContainer {
        /// <summary>
        /// Button should be added directly to a ribbon panel.
        /// </summary>
        public sealed record Panel(string PanelName) : ButtonContainer;

        /// <summary>
        /// Button should be added to a pulldown button within a panel.
        /// </summary>
        public sealed record PullDown(string PullDownName, string PanelName) : ButtonContainer;
    }

    /// <summary>
    /// Non-generic interface for button registrations to allow heterogeneous collections.
    /// </summary>
    private interface IButtonRegistration {
        ButtonContainer Container { get; }
        PushButton CreateButton(UIControlledApplication app, Dictionary<string, RibbonPanel> panels, Dictionary<string, PulldownButton> pulldowns);
    }

    /// <summary>
    /// Strongly-typed button registration that includes command type, display metadata, and container.
    /// </summary>
    private sealed record ButtonRegistration<TCommand> : IButtonRegistration where TCommand : IExternalCommand, new() {
        public required string Text { get; init; }
        public required string SmallImage { get; init; }
        public required string LargeImage { get; init; }
        public required string ToolTip { get; init; }
        public string? LongDescription { get; init; }
        public required ButtonContainer Container { get; init; }

        public PushButton CreateButton(
            UIControlledApplication app,
            Dictionary<string, RibbonPanel> panels,
            Dictionary<string, PulldownButton> pulldowns) {
            var button = this.Container switch {
                ButtonContainer.Panel panel => this.CreatePanelButton(panels, panel),
                ButtonContainer.PullDown pullDown => this.CreatePullDownButton(panels, pulldowns, pullDown),
                _ => throw new InvalidOperationException($"Unknown container type: {this.Container.GetType().Name}")
            };

            this.HydrateButtonMetadata(button);
            return button;
        }

        private PushButton CreatePanelButton(
            Dictionary<string, RibbonPanel> panels,
            ButtonContainer.Panel panelContainer) {
            if (!panels.TryGetValue(panelContainer.PanelName, out var panel))
                throw new InvalidOperationException($"Panel '{panelContainer.PanelName}' not found. Ensure panels are created before buttons.");

            return panel.AddPushButton<TCommand>(this.Text);
        }

        private PushButton CreatePullDownButton(
            Dictionary<string, RibbonPanel> panels,
            Dictionary<string, PulldownButton> pulldowns,
            ButtonContainer.PullDown pullDownContainer) {
            var key = $"{pullDownContainer.PanelName}.{pullDownContainer.PullDownName}";

            if (!pulldowns.TryGetValue(key, out var pulldown)) {
                if (!panels.TryGetValue(pullDownContainer.PanelName, out var panel))
                    throw new InvalidOperationException($"Panel '{pullDownContainer.PanelName}' not found for pulldown '{pullDownContainer.PullDownName}'.");

                pulldown = panel.AddPullDownButton(pullDownContainer.PullDownName);
                pulldowns[key] = pulldown;
            }

            return pulldown.AddPushButton<TCommand>(this.Text);
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

    /// <summary>
    /// Helper method to create a registration entry. Improves readability in the registry definition.
    /// </summary>
    private static IButtonRegistration Register<TCommand>(ButtonRegistration<TCommand> registration)
        where TCommand : IExternalCommand, new() => registration;

    /// <summary>
    /// All button registrations. This is the single source of truth for button configuration.
    /// </summary>
    private static readonly List<IButtonRegistration> Registrations = new() {
        Register<CmdScheduleManager>(new() {
            Text = "Schedule Manager Creator",
            SmallImage = "Red_16.png",
            LargeImage = "Red_32.png",
            ToolTip = "Create individual schedules or batches from a profile.",
            Container = new ButtonContainer.Panel("Migration")
        }),
        Register<CmdScheduleManagerSerialize>(new() {
            Text = "Schedule Manager Serializer",
            SmallImage = "Red_16.png",
            LargeImage = "Red_32.png",
            ToolTip = "Serialize schedules.",
            Container = new ButtonContainer.Panel("Migration")
        }),
        Register<CmdFFManager>(new() {
            Text = "FF Manager Creator",
            SmallImage = "Red_16.png",
            LargeImage = "Red_32.png",
            ToolTip = "Manage families in a variety of ways from the Family Foundry.",
            Container = new ButtonContainer.Panel("Migration")
        }),
        Register<CmdFFManagerSnapshot>(new() {
            Text = "FF Manager Serializer",
            SmallImage = "Red_16.png",
            LargeImage = "Red_32.png",
            ToolTip = "Running this will output a JSON file with a config the represents the reference planes, dimensions, and family parameters of the currently open family",
            Container = new ButtonContainer.Panel("Migration")
        }),
        Register<CmdFFMigrator>(new() {
            Text = "FF Migrator",
            SmallImage = "Red_16.png",
            LargeImage = "Red_32.png",
            ToolTip = "Process families in a variety of ways from the Family Foundry.",
            Container = new ButtonContainer.Panel("Migration")
        }),
        Register<CmdFFMakeATVariants>(new() {
            Text = "Make AT Variants",
            SmallImage = "Red_16.png",
            LargeImage = "Red_32.png",
            ToolTip = "Create Air Terminal variants from an air terminal family by prepopulating the PE_G___TagInstance parameter and setting an existing duct connector's connection settings properly.",
            Container = new ButtonContainer.Panel("Migration")
        }),
        Register<CmdFFParamAggregator>(new() {
            Text = "FF Param Aggregator",
            SmallImage = "Red_16.png",
            LargeImage = "Red_32.png",
            ToolTip = "Aggregate parameter metadata across families in a category and output to CSV.",
            Container = new ButtonContainer.Panel("Migration")
        }),
        Register<CmdPltCommands>(new() {
            Text = "Command Palette",
            SmallImage = "square-terminal16.png",
            LargeImage = "square-terminal32.png",
            ToolTip = "Search and execute Revit commands quickly without looking through Revit's tabs, ribbons, and panels. Not all commands are guaranteed to run.",
            Container = new ButtonContainer.Panel("Tools")
        }),
        Register<CmdPltViews>(new() {
            Text = "View Palette",
            SmallImage = "Red_16.png",
            LargeImage = "Red_32.png",
            ToolTip = "Search and open views in the current document.",
            Container = new ButtonContainer.Panel("Tools")
        }),
        Register<CmdPltMruViews>(new() {
            Text = "MRU Views",
            SmallImage = "Red_16.png",
            LargeImage = "Red_32.png",
            ToolTip = "Open recently visited views in MRU (Most Recently Used) order.",
            Container = new ButtonContainer.Panel("Tools")
        }),
        Register<CmdPltFamilies>(new() {
            Text = "Family Palette",
            SmallImage = "Red_16.png",
            LargeImage = "Red_32.png",
            ToolTip = "Search families in the document. Click to edit family, Ctrl+Click to select all instances.",
            Container = new ButtonContainer.Panel("Tools")
        }),
        Register<CmdPltFamilyElements>(new() {
            Text = "Family Elements",
            SmallImage = "Red_16.png",
            LargeImage = "Red_32.png",
            ToolTip = "Browse all family elements (parameters, connectors, dimensions, reference planes, nested families). Highlights selected elements. Only works in family documents.",
            Container = new ButtonContainer.Panel("Tools")
        }),
        Register<CmdTapMaker>(new() {
            Text = "Tap Maker",
            SmallImage = "Red_16.png",
            LargeImage = "Red_32.png",
            ToolTip = "Add a (default) 6\" tap to a clicked point on a duct face. Works in all views and on both round/rectangular ducts.",
            LongDescription = """
                Add a (default) 6" tap to a clicked point on a duct face. Works in all views and on both round/rectangular ducts.
                Automatic click-point adjustments will prevent overlaps (with other taps) and overhangs (over face edges).
                Automatic size adjustments will size down a duct until it fits on a duct face.

                In the event an easy location or size adjustment is not found, no tap will be placed.
                """,
            Container = new ButtonContainer.Panel("Tools")
        }),
        Register<CmdApsAuthPKCE>(new() {
            Text = "OAuth PKCE",
            SmallImage = "id-card16.png",
            LargeImage = "id-card32.png",
            ToolTip = "Get an access token from Autodesk Platform Services. This is primarily for testing purposes, but running it will not hurt anything.",
            Container = new ButtonContainer.PullDown("General", "Manage")
        }),
        Register<CmdApsAuthNormal>(new() {
            Text = "OAuth Normal",
            SmallImage = "id-card16.png",
            LargeImage = "id-card32.png",
            ToolTip = "Get an access token from Autodesk Platform Services. This is primarily for testing purposes, but running it will not hurt anything.",
            Container = new ButtonContainer.PullDown("General", "Manage")
        }),
        Register<CmdCacheParametersService>(new() {
            Text = "Cache Params Svc",
            SmallImage = "Red_16.png",
            LargeImage = "Red_32.png",
            ToolTip = "Cache the parameters service data for use in the Family Foundry command.",
            Container = new ButtonContainer.PullDown("General", "Manage")
        }),
        Register<CmdAutoTag>(new() {
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
        })
    };

    /// <summary>
    /// Builds the entire ribbon from the registry definitions.
    /// Creates panels, pulldown buttons, and push buttons with all metadata.
    /// </summary>
    /// <param name="app">The UIControlledApplication to add the ribbon to.</param>
    /// <param name="tabName">The name of the ribbon tab to create.</param>
    public static void BuildRibbon(UIControlledApplication app, string tabName) {
        var panels = new Dictionary<string, RibbonPanel>();
        var pulldowns = new Dictionary<string, PulldownButton>();

        // Extract unique panel names in order of first appearance
        var panelNames = Registrations
            .Select(r => r.Container switch {
                ButtonContainer.Panel p => p.PanelName,
                ButtonContainer.PullDown pd => pd.PanelName,
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
            _ = registration.CreateButton(app, panels, pulldowns);
    }
}
