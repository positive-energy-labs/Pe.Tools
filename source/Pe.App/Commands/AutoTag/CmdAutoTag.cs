using Autodesk.Revit.Attributes;
using Autodesk.Revit.UI;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Global.Services.AutoTag;
using Pe.Global.Services.AutoTag.Core;
using Pe.Global.Services.Storage;
using Pe.Global.Services.Storage.Core.Json;
using Serilog;
using System.IO;
using System.Text;
using Document = Autodesk.Revit.DB.Document;

namespace Pe.Tools.Commands.AutoTag;

/// <summary>
///     Unified AutoTag command providing initialization, configuration, catch-up tagging,
///     and settings import/export in a single dialog.
/// </summary>
[Transaction(TransactionMode.Manual)]
public class CmdAutoTag : IExternalCommand {
    private static readonly JsonSerializerSettings JsonSettings = new() {
        Formatting = Formatting.Indented,
        NullValueHandling = NullValueHandling.Ignore,
        Converters = { new StringEnumConverter() }
    };

    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements) {
        var uiDoc = commandData.Application.ActiveUIDocument;
        var doc = uiDoc.Document;

        try {
            var status = AutoTagService.Instance.GetStatus(doc);
            var hasSettings = status.HasDocumentSettings;

            var dialog = new TaskDialog("AutoTag Manager") {
                MainInstruction = hasSettings
                    ? $"AutoTag: {(status.IsEnabled ? "Enabled" : "Disabled")}"
                    : "AutoTag: Not Configured",
                MainContent = hasSettings
                    ? BuildStatusSummary(status)
                    : "AutoTag automatically tags elements when they are placed.\n\n" +
                      "Initialize to get started.",
                CommonButtons = TaskDialogCommonButtons.Close,
                FooterText = "Settings are stored in the Revit document."
            };

            // Add command links based on current state
            if (hasSettings) {
                dialog.AddCommandLink(TaskDialogCommandLinkId.CommandLink1,
                    status.IsEnabled ? "Disable AutoTag" : "Enable AutoTag",
                    status.IsEnabled ? "Turn off automatic tagging" : "Turn on automatic tagging");

                dialog.AddCommandLink(TaskDialogCommandLinkId.CommandLink2,
                    "Catch-Up Tag All",
                    $"Tag all untagged elements ({status.EnabledConfigurationCount} active configurations)");

                dialog.AddCommandLink(TaskDialogCommandLinkId.CommandLink3,
                    "Edit Settings (JSON)",
                    "Export settings to JSON file for editing with autocomplete");

                dialog.AddCommandLink(TaskDialogCommandLinkId.CommandLink4,
                    "View Full Configuration",
                    "Display detailed settings information");
            } else {
                dialog.AddCommandLink(TaskDialogCommandLinkId.CommandLink1,
                    "Initialize with Defaults",
                    "Create default AutoTag configuration (enabled)");

                dialog.AddCommandLink(TaskDialogCommandLinkId.CommandLink2,
                    "Initialize Disabled",
                    "Create configuration but keep AutoTag disabled");

                dialog.AddCommandLink(TaskDialogCommandLinkId.CommandLink3,
                    "Import from File",
                    "Import settings from an existing JSON file");
            }

            var result = dialog.Show();

            if (hasSettings) {
                switch (result) {
                case TaskDialogResult.CommandLink1:
                    this.ToggleEnabled(doc);
                    break;
                case TaskDialogResult.CommandLink2:
                    return this.ExecuteCatchUp(doc, uiDoc);
                case TaskDialogResult.CommandLink3:
                    this.EditSettingsJson(doc);
                    break;
                case TaskDialogResult.CommandLink4:
                    this.ShowFullSettings(doc);
                    break;
                }
            } else {
                switch (result) {
                case TaskDialogResult.CommandLink1:
                    this.InitializeDefault(doc, true);
                    break;
                case TaskDialogResult.CommandLink2:
                    this.InitializeDefault(doc, false);
                    break;
                case TaskDialogResult.CommandLink3:
                    this.ImportFromFile(doc);
                    break;
                }
            }

            return Result.Succeeded;
        } catch (Exception ex) {
            message = ex.Message;
            Log.Error(ex, "AutoTag command failed");
            return Result.Failed;
        }
    }

    #region Status & Display

    private static string BuildStatusSummary(AutoTagStatus status) {
        var sb = new StringBuilder();
        _ = sb.AppendLine($"Configurations: {status.ConfigurationCount} total, {status.EnabledConfigurationCount} active");

        if (status.Configurations.Count > 0) {
            _ = sb.AppendLine();
            _ = sb.AppendLine("Active categories:");
            foreach (var config in status.Configurations.Where(c => c.Enabled).Take(5))
                _ = sb.AppendLine($"  • {config.CategoryName}");

            if (status.EnabledConfigurationCount > 5)
                _ = sb.AppendLine($"  ... and {status.EnabledConfigurationCount - 5} more");
        }

        return sb.ToString();
    }

    private void ShowFullSettings(Document doc) {
        var settings = AutoTagService.Instance.GetSettingsForDocument(doc);
        if (settings == null) return;

        var sb = new StringBuilder();
        _ = sb.AppendLine($"Enabled: {settings.Enabled}");
        _ = sb.AppendLine($"Configurations: {settings.Configurations.Count}");
        _ = sb.AppendLine();

        foreach (var config in settings.Configurations) {
            _ = sb.AppendLine($"Category: {config.CategoryName}");
            _ = sb.AppendLine($"  Enabled: {config.Enabled}");
            _ = sb.AppendLine($"  Tag: {config.TagFamilyName} - {config.TagTypeName}");
            _ = sb.AppendLine($"  Leader: {config.AddLeader}");
            _ = sb.AppendLine($"  Orientation: {config.TagOrientation}");
            _ = sb.AppendLine($"  Offset: {config.OffsetDistance} ft @ {config.OffsetAngle}°");
            _ = sb.AppendLine($"  Skip if tagged: {config.SkipIfAlreadyTagged}");
            if (config.ViewTypeFilter.Count > 0)
                _ = sb.AppendLine($"  View filters: {string.Join(", ", config.ViewTypeFilter)}");
            _ = sb.AppendLine();
        }

        var dialog = new TaskDialog("AutoTag Configuration") {
            MainInstruction = "Full Configuration Details",
            MainContent = sb.ToString(),
            CommonButtons = TaskDialogCommonButtons.Close
        };
        _ = dialog.Show();
    }

    #endregion

    #region Initialize & Toggle

    private void InitializeDefault(Document doc, bool enabled) {
        try {
            var defaultSettings = new AutoTagSettings {
                Enabled = enabled,
                Configurations = [
                    new AutoTagConfiguration {
                        CategoryName = "Mechanical Equipment",
                        TagFamilyName = "M_Mechanical Equipment Tag",
                        TagTypeName = "Standard",
                        Enabled = true,
                        AddLeader = true,
                        TagOrientation = TagOrientationMode.Horizontal,
                        OffsetDistance = 2.0,
                        OffsetAngle = 0.0,
                        SkipIfAlreadyTagged = true,
                        ViewTypeFilter = []
                    }
                ]
            };

            AutoTagService.Instance.SaveSettingsForDocument(doc, defaultSettings);

            var statusMsg = enabled
                ? "AutoTag initialized and enabled.\n\n" +
                  "Default configuration created for Mechanical Equipment.\n" +
                  "Use 'Edit Settings (JSON)' to customize."
                : "AutoTag initialized but disabled.\n\n" +
                  "Run this command again to enable or edit settings.";

            _ = TaskDialog.Show("AutoTag", statusMsg);
        } catch (Exception ex) {
            _ = TaskDialog.Show("AutoTag Error", $"Failed to initialize:\n{ex.Message}");
        }
    }

    private void ToggleEnabled(Document doc) {
        try {
            var settings = AutoTagService.Instance.GetSettingsForDocument(doc);
            if (settings == null) return;

            settings.Enabled = !settings.Enabled;
            AutoTagService.Instance.SaveSettingsForDocument(doc, settings);

            var status = settings.Enabled ? "enabled" : "disabled";
            _ = TaskDialog.Show("AutoTag", $"AutoTag has been {status}.");
        } catch (Exception ex) {
            _ = TaskDialog.Show("AutoTag Error", $"Failed to toggle:\n{ex.Message}");
        }
    }

    #endregion

    #region Catch-Up Tagging

    private Result ExecuteCatchUp(Document doc, UIDocument uiDoc) {
        var settings = AutoTagService.Instance.GetSettingsForDocument(doc);
        if (settings == null || !settings.Enabled) {
            _ = TaskDialog.Show("AutoTag", "AutoTag is not enabled for this document.");
            return Result.Cancelled;
        }

        var activeConfigs = settings.Configurations.Where(c => c.Enabled).ToList();
        if (activeConfigs.Count == 0) {
            _ = TaskDialog.Show("AutoTag", "No active tag configurations found.");
            return Result.Cancelled;
        }

        // Confirm before proceeding
        var confirmDialog = new TaskDialog("AutoTag Catch-Up") {
            MainInstruction = "Tag all untagged elements?",
            MainContent = $"This will tag elements for {activeConfigs.Count} active configuration(s):\n\n" +
                          string.Join("\n", activeConfigs.Select(c => $"  • {c.CategoryName}")),
            CommonButtons = TaskDialogCommonButtons.Yes | TaskDialogCommonButtons.No
        };

        if (confirmDialog.Show() != TaskDialogResult.Yes)
            return Result.Cancelled;

        var totalTagged = 0;

        using var tx = new Transaction(doc, "AutoTag Catch-Up");
        _ = tx.Start();

        try {
            foreach (var config in activeConfigs) {
                var tagged = CatchUpTagCategory(doc, uiDoc, config);
                totalTagged += tagged;
                Log.Information("AutoTag Catch-Up: Tagged {Count} {Category} elements", tagged, config.CategoryName);
            }

            _ = tx.Commit();

            _ = TaskDialog.Show("AutoTag Catch-Up Complete",
                $"Successfully tagged {totalTagged} element(s) across {activeConfigs.Count} category(ies).");

            return Result.Succeeded;
        } catch (Exception ex) {
            _ = tx.RollBack();
            _ = TaskDialog.Show("AutoTag Error", $"Catch-up failed:\n{ex.Message}");
            return Result.Failed;
        }
    }

    private static int CatchUpTagCategory(Document doc, UIDocument uiDoc, AutoTagConfiguration config) {
        var builtInCategory = CategoryTagMapping.GetBuiltInCategoryFromName(doc, config.CategoryName);
        if (builtInCategory == BuiltInCategory.INVALID) return 0;

        // Get all elements of this category
        var elements = new FilteredElementCollector(doc)
            .OfCategory(builtInCategory)
            .WhereElementIsNotElementType()
            .ToElements();

        // Get tag category for this element category
        var tagCategory = CategoryTagMapping.GetTagCategory(builtInCategory);
        if (tagCategory == BuiltInCategory.INVALID) return 0;

        // Find tag family symbol
        var tagSymbol = new FilteredElementCollector(doc)
            .OfClass(typeof(FamilySymbol))
            .OfCategory(tagCategory)
            .Cast<FamilySymbol>()
            .FirstOrDefault(fs =>
                fs.FamilyName == config.TagFamilyName &&
                fs.Name == config.TagTypeName);

        // Fallback: try multi-category tags
        tagSymbol ??= new FilteredElementCollector(doc)
            .OfClass(typeof(FamilySymbol))
            .OfCategory(BuiltInCategory.OST_MultiCategoryTags)
            .Cast<FamilySymbol>()
            .FirstOrDefault(fs =>
                fs.FamilyName == config.TagFamilyName &&
                fs.Name == config.TagTypeName);

        if (tagSymbol == null) {
            Log.Warning("AutoTag: Tag family '{Family}:{Type}' not found for {Category}",
                config.TagFamilyName, config.TagTypeName, config.CategoryName);
            return 0;
        }

        var activeView = uiDoc.ActiveView;
        var taggedCount = 0;

        foreach (var element in elements) {
            try {
                // Skip if already tagged (when configured)
                if (config.SkipIfAlreadyTagged && IsElementTagged(doc, element, activeView))
                    continue;

                // Check view type filter
                if (config.ViewTypeFilter.Count > 0 && !IsViewTypeAllowed(activeView, config.ViewTypeFilter))
                    continue;

                // Get element location
                var location = GetElementLocation(element);
                if (location == null) continue;

                // Calculate tag position with offset
                var tagPosition = CalculateTagPosition(location, config.OffsetDistance, config.OffsetAngle);

                // Create tag
                var tag = IndependentTag.Create(
                    doc,
                    tagSymbol.Id,
                    activeView.Id,
                    new Reference(element),
                    config.AddLeader,
                    config.TagOrientation == TagOrientationMode.Horizontal
                        ? TagOrientation.Horizontal
                        : TagOrientation.Vertical,
                    tagPosition
                );

                if (tag != null) taggedCount++;
            } catch (Exception ex) {
                Log.Debug(ex, "AutoTag: Failed to tag element {ElementId}", element.Id);
            }
        }

        return taggedCount;
    }

    private static bool IsElementTagged(Document doc, Element element, View view) {
        var tags = new FilteredElementCollector(doc, view.Id)
            .OfClass(typeof(IndependentTag))
            .Cast<IndependentTag>()
            .Where(t => t.GetTaggedLocalElementIds().Contains(element.Id));

        return tags.Any();
    }

    private static bool IsViewTypeAllowed(View view, List<ViewTypeFilter> filters) {
        ViewTypeFilter? viewTypeFilter = view.ViewType switch {
            ViewType.FloorPlan => ViewTypeFilter.FloorPlan,
            ViewType.CeilingPlan => ViewTypeFilter.CeilingPlan,
            ViewType.Elevation => ViewTypeFilter.Elevation,
            ViewType.Section => ViewTypeFilter.Section,
            ViewType.ThreeD => ViewTypeFilter.ThreeD,
            ViewType.DraftingView => ViewTypeFilter.DraftingView,
            ViewType.EngineeringPlan => ViewTypeFilter.EngineeringPlan,
            _ => null
        };

        return viewTypeFilter.HasValue && filters.Contains(viewTypeFilter.Value);
    }

    private static XYZ? GetElementLocation(Element element) {
        if (element.Location is LocationPoint lp)
            return lp.Point;
        if (element.Location is LocationCurve lc)
            return lc.Curve.Evaluate(0.5, true);

        var bb = element.get_BoundingBox(null);
        if (bb != null)
            return (bb.Min + bb.Max) / 2;

        return null;
    }

    private static XYZ CalculateTagPosition(XYZ elementLocation, double distance, double angleDegrees) {
        var angleRadians = angleDegrees * Math.PI / 180;
        var offset = new XYZ(
            distance * Math.Cos(angleRadians),
            distance * Math.Sin(angleRadians),
            0
        );
        return elementLocation + offset;
    }

    #endregion

    #region JSON Settings Export/Import

    private void EditSettingsJson(Document doc) {
        var settingsDir = GetSettingsDirectory();
        var settingsFilePath = Path.Combine(settingsDir, "autotag-settings.json");
        var schemaFilePath = Path.Combine(settingsDir, "schema.json");

        var existingSettings = AutoTagService.Instance.GetSettingsForDocument(doc);
        var fileExists = File.Exists(settingsFilePath);

        if (fileExists) {
            var dialog = new TaskDialog("AutoTag Settings File") {
                MainInstruction = "Settings file exists",
                MainContent = $"Location:\n{settingsFilePath}",
                CommonButtons = TaskDialogCommonButtons.Close
            };

            dialog.AddCommandLink(TaskDialogCommandLinkId.CommandLink1, "Import from File",
                "Load settings from file into document");
            dialog.AddCommandLink(TaskDialogCommandLinkId.CommandLink2, "Export & Open",
                "Overwrite with current settings and open");
            dialog.AddCommandLink(TaskDialogCommandLinkId.CommandLink3, "Open Existing",
                "Open file without overwriting");

            var result = dialog.Show();

            switch (result) {
            case TaskDialogResult.CommandLink1:
                this.ImportSettingsFromPath(doc, settingsFilePath);
                break;
            case TaskDialogResult.CommandLink2:
                if (existingSettings != null)
                    this.ExportAndOpen(settingsFilePath, schemaFilePath, existingSettings);
                break;
            case TaskDialogResult.CommandLink3:
                FileUtils.OpenInDefaultApp(settingsFilePath);
                break;
            }
        } else if (existingSettings != null) {
            this.ExportAndOpen(settingsFilePath, schemaFilePath, existingSettings);
            _ = TaskDialog.Show("AutoTag",
                $"Settings exported to:\n{settingsFilePath}\n\n" +
                "Edit with JSON autocomplete support.\n" +
                "Run this command again to import.");
        }
    }

    private void ImportFromFile(Document doc) {
        var settingsDir = GetSettingsDirectory();
        var settingsFilePath = Path.Combine(settingsDir, "autotag-settings.json");

        if (!File.Exists(settingsFilePath)) {
            _ = TaskDialog.Show("AutoTag", $"No settings file found at:\n{settingsFilePath}");
            return;
        }

        this.ImportSettingsFromPath(doc, settingsFilePath);
    }

    private void ExportAndOpen(string settingsFilePath, string schemaFilePath, AutoTagSettings settings) {
        var dir = Path.GetDirectoryName(settingsFilePath);
        if (dir != null && !Directory.Exists(dir))
            _ = Directory.CreateDirectory(dir);

        // Generate schema with examples
        var schema = JsonSchemaFactory.CreateSchema<AutoTagSettings>(out var examplesProcessor);
        examplesProcessor.Finalize(schema);
        File.WriteAllText(schemaFilePath, schema.ToJson());

        // Serialize with $schema reference
        var json = JsonConvert.SerializeObject(settings, JsonSettings);
        var relativeSchemaPath = Path.GetFileName(schemaFilePath);
        var jsonWithSchema = json.Insert(1, $"\n  \"$schema\": \"{relativeSchemaPath}\",");
        File.WriteAllText(settingsFilePath, jsonWithSchema);

        FileUtils.OpenInDefaultApp(settingsFilePath);
    }

    private void ImportSettingsFromPath(Document doc, string filePath) {
        try {
            var json = File.ReadAllText(filePath);
            var settings = JsonConvert.DeserializeObject<AutoTagSettings>(json, JsonSettings);

            if (settings == null) {
                _ = TaskDialog.Show("Import Error", "Failed to parse settings file.");
                return;
            }

            AutoTagService.Instance.SaveSettingsForDocument(doc, settings);

            _ = TaskDialog.Show("AutoTag",
                $"Settings imported!\n\n" +
                $"Status: {(settings.Enabled ? "Enabled" : "Disabled")}\n" +
                $"Configurations: {settings.Configurations.Count}");
        } catch (Exception ex) {
            _ = TaskDialog.Show("Import Error", $"Failed to import:\n{ex.Message}");
        }
    }

    private static string GetSettingsDirectory() {
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        return Path.Combine(appData, "PE_Tools", "AutoTag");
    }

    #endregion
}
