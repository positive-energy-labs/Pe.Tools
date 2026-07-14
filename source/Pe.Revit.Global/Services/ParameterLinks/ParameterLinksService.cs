using Pe.Revit.DocumentData.ParameterLinks;
using Pe.Revit.Global.Services.Document;
using Pe.Revit.Loader.Documents;
using Pe.Revit.Tasks;
using Pe.Shared.RevitData;
using Serilog;
using Autodesk.Revit.DB.Electrical;
using RevitDocument = Autodesk.Revit.DB.Document;

namespace Pe.Revit.Global.Services.ParameterLinks;

public sealed class ParameterLinksService {
    private readonly ParameterLinksProfileStorage _storage = new();
    private IDocumentTracker? _documents;
    private ParameterLinksUpdater? _updater;

    public static ParameterLinksService Instance { get; } = new();

    private ParameterLinksService() { }

    public void Initialize(AddInId addInId, IDocumentTracker documents) {
        if (this._updater != null)
            return;

        this._documents = documents;
        this._updater = new ParameterLinksUpdater(
            addInId,
            document => this._storage.Read(document).Profile);
        UpdaterRegistry.RegisterUpdater(this._updater, true);
        documents.Opened += this.OnDocumentOpened;
        documents.Changed += this.OnDocumentChanged;
        Log.Information("Parameter Links: service initialized");
    }

    public void Shutdown() {
        if (this._documents != null) {
            this._documents.Opened -= this.OnDocumentOpened;
            this._documents.Changed -= this.OnDocumentChanged;
        }
        this._documents = null;

        if (this._updater != null) {
            try {
                if (UpdaterRegistry.IsUpdaterRegistered(this._updater.GetUpdaterId()))
                    UpdaterRegistry.UnregisterUpdater(this._updater.GetUpdaterId());
            } catch (Exception ex) {
                Log.Warning(ex, "Parameter Links: updater unregister failed");
            }
            this._updater = null;
        }
    }

    public ParameterLinksData Detail(RevitDocument document, bool includeEvaluation = true) {
        var state = this.ResolveState(document);
        var evaluation = includeEvaluation && state.Profile != null
            ? ParameterLinksEngine.Evaluate(document, state.Profile)
            : null;
        if (state.ReadError != null)
            evaluation = AddStorageIssue(evaluation, state.ReadError);

        return new ParameterLinksData(
            state.Profile,
            evaluation,
            this.BuildStatus(state),
            false,
            0);
    }

    public ParameterLinksData Apply(RevitDocument document, ParameterLinksApplyRequest request) {
        var state = this.ResolveState(document);
        var profile = request.Profile ?? state.Profile;
        if (profile == null) {
            var missingProfileEvaluation = AddStorageIssue(
                null,
                state.ReadError ?? "No parameter-links profile is stored.");
            return new ParameterLinksData(null, missingProfileEvaluation, this.BuildStatus(state), false, 0);
        }

        var preview = ParameterLinksEngine.Evaluate(document, profile);
        if (request.PreviewOnly || preview.Issues.Any(issue => issue.Severity == ParameterLinkIssueSeverity.Error)) {
            return new ParameterLinksData(profile, preview, this.BuildStatus(state, profile), false, 0);
        }

        var profileChanged = false;
        var applied = 0;
        ParameterLinkEvaluation evaluation = preview;
        var committed = false;
        using (var sandbox = DocumentSandbox.BeginCommit(document, "Pe Apply Parameter Links")) {
            if (request.Profile != null)
                profileChanged = this._storage.Write(document, profile);
            if (request.Reconcile)
                (evaluation, applied) = ParameterLinksEngine.Reconcile(document, profile);
            if ((profileChanged || applied > 0) &&
                !evaluation.Issues.Any(issue => issue.Severity == ParameterLinkIssueSeverity.Error)) {
                sandbox.Complete();
                committed = true;
            }
        }

        if ((profileChanged || applied > 0) && !committed) {
            profileChanged = false;
            applied = 0;
        }

        var persisted = this._storage.Read(document);
        this.UpdateState(state, persisted);
        this.RegisterTriggers(document, persisted.Profile);

        return new ParameterLinksData(
            committed || request.Profile == null ? persisted.Profile : profile,
            evaluation,
            this.BuildStatus(state),
            profileChanged,
            applied);
    }

    private void OnDocumentOpened(TrackedDocument tracked) {
        try {
            var document = tracked.Resolve();
            if (document.IsFamilyDocument)
                return;
            var read = this._storage.Read(document);
            var state = tracked.State(_ => new DocumentState());
            this.UpdateState(state, read);
            this.RegisterTriggers(document, read.Profile);
        } catch (Exception ex) {
            Log.Error(ex, "Parameter Links: failed to initialize document state");
        }
    }

    private void OnDocumentChanged(TrackedDocument tracked, Autodesk.Revit.DB.Events.DocumentChangedEventArgs e) {
        try {
            var document = tracked.Resolve();
            if (document.IsFamilyDocument ||
                !e.GetModifiedElementIds().Contains(document.ProjectInformation.Id))
                return;

            var read = this._storage.Read(document);
            this.UpdateState(tracked.State(_ => new DocumentState()), read);
            this.RegisterTriggers(document, read.Profile);
        } catch (Exception ex) {
            Log.Warning(ex, "Parameter Links: failed to refresh profile after a document change");
        }
    }

    private DocumentState ResolveState(RevitDocument document) {
        var tracked = this._documents?.Find(document);
        if (tracked != null) {
            var state = tracked.State(_ => new DocumentState());
            var read = this._storage.Read(document);
            this.UpdateState(state, read);
            this.RegisterTriggers(document, read.Profile);
            return state;
        }

        var direct = this._storage.Read(document);
        return new DocumentState {
            Profile = direct.Profile,
            HasStoredProfile = direct.HasStoredProfile,
            ReadError = direct.Error
        };
    }

    private void RegisterTriggers(RevitDocument document, ParameterLinkProfile? profile) {
        if (this._updater == null)
            return;

        var updaterId = this._updater.GetUpdaterId();
        try {
            UpdaterRegistry.RemoveDocumentTriggers(updaterId, document);
        } catch {
        }

        if (profile == null)
            return;

        if (ParameterLinksEngine.Validate(profile)
            .Any(issue => issue.Severity == ParameterLinkIssueSeverity.Error))
            return;

        var definitions = profile.Definitions.ToDictionary(definition => definition.Id, StringComparer.OrdinalIgnoreCase);
        var activeDefinitions = profile.Assignments
                     .Where(assignment => assignment.Enabled)
                     .Select(assignment => definitions.GetValueOrDefault(assignment.DefinitionId))
                     .Where(definition => definition != null)
                     .Cast<ParameterLinkDefinition>()
                     .ToList();
        foreach (var sourceCategoryId in activeDefinitions
                     .Select(definition => definition!.SourceCategoryId)
                     .Distinct()) {
            try {
                UpdaterRegistry.AddTrigger(
                    updaterId,
                    document,
                    new ElementCategoryFilter(((long)sourceCategoryId).ToElementId()),
                    Element.GetChangeTypeAny());
            } catch (Exception ex) {
                Log.Warning(ex, "Parameter Links: failed to register category {CategoryId}", sourceCategoryId);
            }
        }

        if (activeDefinitions.Any(definition =>
                definition.Relationship == ParameterLinkRelationship.ElectricalEquipmentCircuits)) {
            try {
                UpdaterRegistry.AddTrigger(
                    updaterId,
                    document,
                    new ElementClassFilter(typeof(ElectricalSystem)),
                    Element.GetChangeTypeAny());
            } catch (Exception ex) {
                Log.Warning(ex, "Parameter Links: failed to register electrical-circuit trigger");
            }
        }
    }

    private void UpdateState(DocumentState state, ProfileReadResult read) {
        state.Profile = read.Profile;
        state.HasStoredProfile = read.HasStoredProfile;
        state.ReadError = read.Error;
    }

    private ParameterLinksRuntimeStatus BuildStatus(DocumentState state, ParameterLinkProfile? overrideProfile = null) {
        var profile = overrideProfile ?? state.Profile;
        var enabledAssignments = profile?.Assignments.Count(assignment => assignment.Enabled) ?? 0;
        var enabledDefinitionIds = profile?.Assignments
            .Where(assignment => assignment.Enabled)
            .Select(assignment => assignment.DefinitionId)
            .ToHashSet(StringComparer.OrdinalIgnoreCase) ?? [];
        return new ParameterLinksRuntimeStatus(
            state.HasStoredProfile,
            this._updater != null,
            profile?.Definitions.Count(definition => enabledDefinitionIds.Contains(definition.Id)) ?? 0,
            enabledAssignments);
    }

    private static ParameterLinkEvaluation AddStorageIssue(ParameterLinkEvaluation? evaluation, string message) {
        evaluation ??= new ParameterLinkEvaluation();
        return evaluation with {
            Issues = [..evaluation.Issues, new ParameterLinkIssue {
                Code = "ProfileStorageInvalid",
                Severity = ParameterLinkIssueSeverity.Error,
                Message = message
            }]
        };
    }

    private sealed class DocumentState {
        public ParameterLinkProfile? Profile;
        public bool HasStoredProfile;
        public string? ReadError;
    }

}
