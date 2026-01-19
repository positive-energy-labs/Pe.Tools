using Pe.Extensions.FamDocument;
using Pe.Extensions.FamManager;
using Pe.Extensions.FamParameter;
using Pe.FamilyFoundry.OperationSettings;

namespace Pe.FamilyFoundry.Operations;

/// <summary>
///     Creates missing family parameters from AddAndSetParamsSettings and sets tooltips.
///     Uses the PropertiesGroup/DataType/IsInstance from ParamSettingModel.
///     Sets tooltips for family parameters (skips shared/built-in parameters).
///     Only used when CreateIfMissing=true in the settings.
/// </summary>
public class AddFamilyParams(AddAndSetParamsSettings settings)
    : DocOperation<AddAndSetParamsSettings>(settings) {
    public override string Description =>
        "Create missing family parameters and set tooltips from AddAndSetParams settings.";

    public override OperationLog Execute(FamilyDocument doc,
        FamilyProcessingContext processingContext,
        OperationContext groupContext) {
        var logs = new List<LogEntry>();
        var fm = doc.FamilyManager;

        // Process each parameter setting
        foreach (var p in this.Settings.Parameters) {
            var existingParam = fm.FindParameter(p.Name);

            try {
                // Create parameter if it doesn't exist
                FamilyParameter param;
                if (existingParam is null) {
                    param = doc.AddFamilyParameter(p.Name, p.PropertiesGroup, p.DataType, p.IsInstance);
                    if (!string.IsNullOrWhiteSpace(p.Tooltip) && !param.IsShared && !param.IsBuiltInParameter()) {
                        logs.Add(new LogEntry(p.Name).Success("Created as family parameter"));
                        continue;
                    }

                    var tooltipSuccess = false;
                    try {
                        doc.FamilyManager.SetDescription(param, p.Tooltip);
                        tooltipSuccess = true;
                    } catch { }

                    logs.Add(new LogEntry(p.Name).Success(tooltipSuccess
                        ? "Created as family parameter w/ tooltip"
                        : "Created as family parameter but unable to set tooltip"));
                } else {
                    param = existingParam;
                    if (!string.IsNullOrWhiteSpace(p.Tooltip) && !param.IsShared && !param.IsBuiltInParameter()) {
                        logs.Add(new LogEntry(p.Name).Skip("Found existing parameter"));
                        continue;
                    }

                    var tooltipSuccess = false;
                    try {
                        doc.FamilyManager.SetDescription(param, p.Tooltip);
                        tooltipSuccess = true;
                    } catch { }

                    logs.Add(new LogEntry(p.Name).Success(tooltipSuccess
                        ? "Found existing and set tooltip"
                        : "Found existing but unable to set tooltip"));
                }
            } catch (Exception ex) {
                logs.Add(new LogEntry(p.Name).Error(ex));
            }
        }

        return new OperationLog(this.Name, logs);
    }
}