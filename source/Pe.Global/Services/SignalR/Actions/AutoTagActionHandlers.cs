using Autodesk.Revit.UI;
using Pe.Global.Services.AutoTag;
using Pe.Global.Services.AutoTag.Core;

namespace Pe.Global.Services.SignalR.Actions;

/// <summary>
///     Action handler to load AutoTag settings from the active document.
/// </summary>
public class AutoTagLoadHandler : ActionHandler<AutoTagSettings> {
    public override string ActionName => "AutoTag.Load";
    public override string SettingsTypeName => "AutoTagSettings";

    public override object? Execute(UIApplication uiApp, AutoTagSettings settings) {
        return this.LoadSettings(uiApp); 
    }

    public override object? ExecuteWithoutPersist(UIApplication uiApp, AutoTagSettings settings) {
        return this.LoadSettings(uiApp);
    }

    private object LoadSettings(UIApplication uiApp) {
        var doc = uiApp.ActiveUIDocument?.Document;
        if (doc == null)
            return new { Success = false, Error = "No active document", Settings = (AutoTagSettings?)null };

        var settings = AutoTagService.Instance.GetSettingsForDocument(doc);
        return new {
            Success = true,
            Error = (string?)null,
            Settings = settings,
            HasSettings = settings != null
        };
    }
}

/// <summary>
///     Action handler to save AutoTag settings to the active document.
/// </summary>
public class AutoTagSaveHandler : ActionHandler<AutoTagSettings> {
    public override string ActionName => "AutoTag.Save";
    public override string SettingsTypeName => "AutoTagSettings";

    public override object? Execute(UIApplication uiApp, AutoTagSettings settings) {
        var doc = uiApp.ActiveUIDocument?.Document;
        if (doc == null)
            return new { Success = false, Error = "No active document" };

        if (settings == null)
            return new { Success = false, Error = "Settings cannot be null" };

        try {
            AutoTagService.Instance.SaveSettingsForDocument(doc, settings);
            return new { Success = true, Error = (string?)null };
        } catch (Exception ex) {
            return new { Success = false, Error = ex.Message };
        }
    }

    public override object? ExecuteWithoutPersist(UIApplication uiApp, AutoTagSettings settings) {
        // For "save without persist", just validate settings and return status
        var doc = uiApp.ActiveUIDocument?.Document;
        if (doc == null)
            return new { Success = false, Error = "No active document", WouldSave = false };

        if (settings == null)
            return new { Success = false, Error = "Settings cannot be null", WouldSave = false };

        // Return validation result without actually saving
        return new {
            Success = true,
            Error = (string?)null,
            WouldSave = true,
            ConfigurationCount = settings.Configurations?.Count ?? 0
        };
    }
}

/// <summary>
///     Action handler to get AutoTag status from the active document.
/// </summary>
public class AutoTagGetStatusHandler : ActionHandler<AutoTagSettings> {
    public override string ActionName => "AutoTag.GetStatus";
    public override string SettingsTypeName => "AutoTagSettings";

    public override object? Execute(UIApplication uiApp, AutoTagSettings settings) {
        return this.GetStatus(uiApp);
    }

    public override object? ExecuteWithoutPersist(UIApplication uiApp, AutoTagSettings settings) {
        return this.GetStatus(uiApp);
    }

    private object GetStatus(UIApplication uiApp) {
        var doc = uiApp.ActiveUIDocument?.Document;
        if (doc == null)
            return new { Success = false, Error = "No active document", Status = (AutoTagStatus?)null };

        var status = AutoTagService.Instance.GetStatus(doc);
        return new {
            Success = true,
            Error = (string?)null,
            Status = status
        };
    }
}
