using Pe.Revit.Extensions.FamDocument;

namespace Pe.Revit.FamilyFoundry;

/// <summary>
///     Fluent processor that batches document and type operations for optimal execution.
///     Tracks (operation, context) pairs for group context lifecycle management.
/// </summary>
public class OperationQueue {
    private readonly List<(IOperation Op, OperationContext Ctx)> _operations = new();

    /// <summary>
    ///     Gets all operations in the queue for inspection.
    /// </summary>
    public IReadOnlyList<IOperation> Operations => this._operations.Select(o => o.Op).ToList();

    public OperationQueue Add(
        IOperation operation
    ) {
        if (operation.Settings?.Enabled == false) return this;
        this._operations.Add((operation, null)); // Standalone - no context
        return this;
    }

    /// <summary>
    ///     Add an operation group to the queue with explicit settings from the profile.
    ///     Groups are unwrapped into individual operations, with names prefixed by the group name.
    /// </summary>
    public OperationQueue Add<TSettings>(
        OperationGroup<TSettings> group
    ) where TSettings : IOperationSettings {
        foreach (var operation in group.Operations) {
            operation.Name = $"{group.Name}: {operation.Name}";
            if (operation.Settings?.Enabled == false) continue;
            this._operations.Add((operation, group.GroupContext)); // Group op - has context
        }

        return this;
    }

    /// <summary>
    ///     Resets all group contexts for a new family processing cycle.
    /// </summary>
    public void ResetAllGroupContexts() =>
        this._operations
            .Select(o => o.Ctx)
            .Where(c => c != null)
            .Distinct()
            .ToList()
            .ForEach(c => c.Reset());

    /// <summary>
    ///     Get metadata about all queued operations for frontend display
    /// </summary>
    public List<(string Name, string Description, string Type, string IsMerged)> GetExecutableMetadata() {
        var ops = this.ToTypeOptimizedExecutableList();
        var result = new List<(string Name, string Description, string Type, string IsMerged)>();
        foreach (var (executable, _) in ops) {
            switch (executable) {
            case MergedTypeOperation mergedOp:
                result.AddRange(mergedOp.Operations.Select(o =>
                    (o.Op.Name, o.Op.Description, GetOperationType(o.Op), "Merged")));
                break;
            case IOperation operation:
                result.Add((operation.Name, operation.Description, GetOperationType(operation), "Single"));
                break;
            default:
                throw new InvalidOperationException($"Unknown operation type: {executable.GetType().Name}");
            }
        }

        return result;
    }

    public string GetExecutableMetadataString() {
        var op = this.GetExecutableMetadata();
        var result = "";
        foreach (var o in op) result += $"[Batch {o.IsMerged}] {o.Type}: {o.Name} - {o.Description}\n";
        return result;
    }

    private static string GetOperationType(IOperation op) {
        var opType = op.GetType();
        // Check if it's a generic type based on DocOperation<> or TypeOperation<>
        while (opType != null) {
            if (opType.IsGenericType) {
                var genericDef = opType.GetGenericTypeDefinition();
                if (genericDef.Name.StartsWith("DocOperation")) return "Doc";
                if (genericDef.Name.StartsWith("TypeOperation")) return "Type";
            }

            opType = opType.BaseType;
        }

        throw new InvalidOperationException(
            $"Operation {op.GetType().Name} does not inherit from DocOperation<T> or TypeOperation<T>");
    }


    /// <summary>
    ///     Converts the queued operations into family actions, optionally bundling them for single-transaction behavior.
    /// </summary>
    /// <param name="optimizeTypeOperations">
    ///     If true, optimizes type operations for better performance. If false, runs all
    ///     operations on a one-to-one basis.
    /// </param>
    /// <param name="singleTransaction">
    ///     If true, bundles all actions into a single action for one transaction. If false, each
    ///     action runs in its own transaction.
    /// </param>
    /// <returns>An array of family actions that return logs when executed.</returns>
    public Func<FamilyDocument, FamilyProcessingContext, List<OperationLog>>[] ToFuncs(
        bool optimizeTypeOperations = true,
        bool singleTransaction = true
    ) {
        var named = this.ToNamedFuncs(optimizeTypeOperations, singleTransaction);
        return named.Select(item => item.Callback).ToArray();
    }

    public (string Name, Func<FamilyDocument, FamilyProcessingContext, List<OperationLog>> Callback)[] ToNamedFuncs(
        bool optimizeTypeOperations = true,
        bool singleTransaction = true
    ) {
        var executableOps = optimizeTypeOperations
            ? this.ToTypeOptimizedExecutableList()
            : this.ToExecutableList();
        var namedFuncs = executableOps
            .Select(pair => (
                Name: GetExecutableName(pair.Executable),
                Callback: pair.Executable.ToFunc(pair.Ctx)))
            .ToArray();

        return singleTransaction
            ? this.BundleFuncs(namedFuncs)
            : namedFuncs;
    }

    private List<(IExecutable Executable, OperationContext Ctx)> ToExecutableList() =>
        this._operations.Select(o => ((IExecutable)o.Op, o.Ctx)).ToList();

    public List<(IExecutable Executable, OperationContext Ctx)> ToTypeOptimizedExecutableList() {
        var finalOps = new List<(IExecutable, OperationContext)>();
        var currentBatch = new List<(IOperation Op, OperationContext Ctx)>();

        foreach (var (op, ctx) in this._operations) {
            var isTypeOp = IsTypeOperation(op);

            if (isTypeOp) {
                currentBatch.Add((op, ctx));
            } else {
                if (currentBatch.Count > 0) {
                    // MergedTypeOperation stores its own contexts, pass null at execution
                    finalOps.Add((new MergedTypeOperation(currentBatch), null));
                    currentBatch = [];
                }

                finalOps.Add((op, ctx));
            }
        }

        // Flush remaining
        if (currentBatch.Count > 0)
            finalOps.Add((new MergedTypeOperation(currentBatch), null));

        return finalOps;
    }

    private static bool IsTypeOperation(IOperation op) {
        var opType = op.GetType();
        while (opType != null) {
            if (opType.IsGenericType) {
                var genericDef = opType.GetGenericTypeDefinition();
                if (genericDef.Name.StartsWith("TypeOperation")) return true;
            }

            opType = opType.BaseType;
        }

        return false;
    }

    /// <summary>
    ///     Bundles all family actions into a single action to replicate single-transaction behavior.
    ///     When ProcessFamily receives this single action, it will run all operations within one transaction.
    /// </summary>
    private static string GetExecutableName(IExecutable executable) =>
        executable switch {
            MergedTypeOperation merged => string.Join(" + ", merged.Operations.Select(operation => operation.Op.Name)),
            IOperation operation => operation.Name,
            _ => executable.GetType().Name
        };

    private (string Name, Func<FamilyDocument, FamilyProcessingContext, List<OperationLog>> Callback)[] BundleFuncs(
        (string Name, Func<FamilyDocument, FamilyProcessingContext, List<OperationLog>> Callback)[] actions
    ) {
        if (actions.Length == 0) return actions;

        // Create a single action that executes all actions sequentially and collects logs
        List<OperationLog> BundleActions(FamilyDocument famDoc, FamilyProcessingContext context) {
            var allLogs = new List<OperationLog>();
            foreach (var action in actions) allLogs.AddRange(action.Callback(famDoc, context));
            return allLogs;
        }

        return [(string.Join(" + ", actions.Select(action => action.Name)), BundleActions)];
    }
}
