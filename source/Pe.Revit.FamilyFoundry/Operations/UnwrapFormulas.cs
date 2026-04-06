// using PeExtensions.FamDocument;
// TODO: delete? 
// namespace Pe.FamilyFoundry.Operations;
//
// /// <summary>
// ///     Unwraps parameter formulas that are either:
// ///     - Constant formulas (e.g., "= 20", "= 60 Hz") - converts to direct value
// ///     - Single parameter reference chains (e.g., PE_G___Model.Formula = Model) - resolves chain,
// ///     sets value from ultimate source, backlinks built-ins, and cleans up intermediates.
// ///     This operation should run AFTER all mapping and connector operations are complete.
// /// </summary>
// public class UnwrapFormulas : DocOperation<DefaultOperationSettings> {
//     private readonly HashSet<string> _targetParamNames;
//
//     public UnwrapFormulas(IEnumerable<string> targetParamNames)
//         : base(new DefaultOperationSettings()) =>
//         this._targetParamNames = targetParamNames.ToHashSet();
//
//     public override string Description =>
//         "Unwrap constant formulas and resolve single-parameter reference chains";
//
//     public override OperationLog Execute(FamilyDocument doc,
//         FamilyProcessingContext processingContext,
//         OperationContext groupContext) {
//         var logs = new List<LogEntry>();
//
//         var paramsWithFormulas = doc.FamilyManager.Parameters
//             .OfType<FamilyParameter>()
//             .Where(p => this._targetParamNames.Contains(p.Definition.Name))
//             .Where(p => !string.IsNullOrWhiteSpace(p.Formula));
//
//         foreach (var param in paramsWithFormulas) {
//             var paramName = param.Definition.Name;
//             try {
//                 var result = doc.TryUnwrapFormula(param);
//                 if (!result.WasUnwrapped) continue;
//
//                 var sourceName = result.UltimateSource?.Definition.Name ?? paramName;
//                 var logMsg = sourceName == paramName
//                     ? "Unwrapped constant formula"
//                     : $"Resolved from {sourceName}";
//
//                 logs.Add(new LogEntry(paramName).Success(logMsg));
//             } catch (Exception ex) {
//                 logs.Add(new LogEntry(paramName).Error(ex));
//             }
//         }
//
//         return new OperationLog(this.Name, logs);
//     }
// }

