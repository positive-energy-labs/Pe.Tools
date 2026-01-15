using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Pe.Global.Services.AutoTag;
using Pe.Global.Services.Storage;
using System.IO;

namespace Pe.Tools.Commands;

/// <summary>
///     Command to manage AutoTag settings and updater.
///     Provides enable/disable, reload settings, and status reporting.
/// </summary>
[Transaction(TransactionMode.Manual)]
public class CmdAutoTag : IExternalCommand {
    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements) {
        try {
            // Show dialog with options
            var dialog = new TaskDialog("AutoTag Manager") {
                MainInstruction = "Manage AutoTag Settings",
                CommonButtons = TaskDialogCommonButtons.Close
            };

            dialog.AddCommandLink(TaskDialogCommandLinkId.CommandLink1, "Reload Settings",
                "Reload configuration from JSON file");
            dialog.AddCommandLink(TaskDialogCommandLinkId.CommandLink2, "Clear Cache",
                "Clear cached tag type lookups");
            dialog.AddCommandLink(TaskDialogCommandLinkId.CommandLink3, "View Settings File",
                "Open settings file in default editor");
            dialog.AddCommandLink(TaskDialogCommandLinkId.CommandLink4, "Show Status",
                "Display current AutoTag status");

            var result = dialog.Show();

            switch (result) {
            case TaskDialogResult.CommandLink1:
                this.ReloadSettings();
                break;
            case TaskDialogResult.CommandLink2:
                this.ClearCache();
                break;
            case TaskDialogResult.CommandLink3:
                this.OpenSettingsFile();
                break;
            case TaskDialogResult.CommandLink4:
                this.ShowStatus();
                break;
            }

            return Result.Succeeded;
        } catch (Exception ex) {
            message = ex.Message;
            return Result.Failed;
        }
    }

    private void ReloadSettings() {
        try {
            AutoTagService.Instance.ReloadSettings();
            _ = TaskDialog.Show("AutoTag", "Settings reloaded successfully.\n\nNote: You may need to restart Revit for trigger changes to take effect.");
        } catch (Exception ex) {
            _ = TaskDialog.Show("AutoTag Error", $"Failed to reload settings:\n{ex.Message}");
        }
    }

    private void ClearCache() {
        try {
            AutoTagService.Instance.ClearCache();
            _ = TaskDialog.Show("AutoTag", "Tag type cache cleared successfully.");
        } catch (Exception ex) {
            _ = TaskDialog.Show("AutoTag Error", $"Failed to clear cache:\n{ex.Message}");
        }
    }

    private void OpenSettingsFile() {
        try {
            var filePath = AutoTagService.Instance.SettingsFilePath;
            if (string.IsNullOrEmpty(filePath) || !File.Exists(filePath)) {
                _ = TaskDialog.Show("AutoTag", $"Settings file not found: {filePath}");
                return;
            }

            FileUtils.OpenInDefaultApp(filePath);
        } catch (Exception ex) {
            _ = TaskDialog.Show("AutoTag Error", $"Failed to open settings file:\n{ex.Message}");
        }
    }

    private void ShowStatus() {
        try {
            var status = AutoTagService.Instance.GetStatus();

            var statusText = new System.Text.StringBuilder();
            _ = statusText.AppendLine("AutoTag Status:");
            _ = statusText.AppendLine($"Initialized: {status.IsInitialized}");
            _ = statusText.AppendLine($"Settings File: {status.SettingsFilePath}");
            _ = statusText.AppendLine($"Global Enabled: {status.IsEnabled}");
            _ = statusText.AppendLine($"Configurations: {status.ConfigurationCount}");
            _ = statusText.AppendLine($"Enabled Configurations: {status.EnabledConfigurationCount}");
            _ = statusText.AppendLine();

            if (status.Configurations.Count > 0) {
                _ = statusText.AppendLine("Active Configurations:");
                foreach (var config in status.Configurations.Where(c => c.Enabled)) {
                    _ = statusText.AppendLine($"  • {config.CategoryName}");
                    _ = statusText.AppendLine($"    Tag: {config.TagFamilyName} - {config.TagTypeName}");
                    _ = statusText.AppendLine($"    Leader: {config.AddLeader}, Skip if tagged: {config.SkipIfAlreadyTagged}");
                }
            } else {
                _ = statusText.AppendLine("No configurations defined.");
            }

            var statusDialog = new TaskDialog("AutoTag Status") {
                MainInstruction = "AutoTag Status",
                MainContent = statusText.ToString()
            };
            _ = statusDialog.Show();
        } catch (Exception ex) {
            _ = TaskDialog.Show("AutoTag Error", $"Failed to get status:\n{ex.Message}");
        }
    }
}
