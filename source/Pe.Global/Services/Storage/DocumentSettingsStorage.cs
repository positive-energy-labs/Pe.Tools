using Autodesk.Revit.DB.ExtensibleStorage;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Pe.Global.Services.Storage.Core.Json.ContractResolvers;
using Serilog;

namespace Pe.Global.Services.Storage;

/// <summary>
///     Generic service for storing settings in a Revit document using Extensible Storage.
///     Settings are stored as JSON in a DataStorage element, providing a stable schema
///     that never needs to change while allowing settings evolution via JSON migrations.
/// </summary>
/// <typeparam name="T">Settings type to store</typeparam>
public class DocumentSettingsStorage<T> where T : class, new() {
    private static readonly JsonSerializerSettings JsonSettings;

    static DocumentSettingsStorage() {
        JsonSettings = new JsonSerializerSettings {
            Formatting = Formatting.Indented,
            ContractResolver = new RevitTypeContractResolver(),
            NullValueHandling = NullValueHandling.Ignore
        };
        JsonSettings.Converters.Add(new StringEnumConverter());
    }

    private readonly Guid _schemaGuid;
    private readonly string _schemaName;
    private readonly string _storageElementName;
    private readonly string _vendorId;

    /// <summary>
    ///     Creates a new document settings storage for the specified type.
    /// </summary>
    /// <param name="schemaGuid">Unique GUID for this settings schema (generate once, never change)</param>
    /// <param name="schemaName">Human-readable schema name</param>
    /// <param name="vendorId">Vendor ID for access control (must match .addin file VendorId)</param>
    public DocumentSettingsStorage(Guid schemaGuid, string schemaName, string vendorId = "Development") {
        this._schemaGuid = schemaGuid;
        this._schemaName = schemaName;
        this._vendorId = vendorId;
        this._storageElementName = $"PE_Settings_{typeof(T).Name}";
    }

    /// <summary>
    ///     Reads settings from the document. Returns null if not found.
    /// </summary>
    public T? Read(Autodesk.Revit.DB.Document doc) {
        try {
            var dataStorage = this.FindDataStorage(doc);
            if (dataStorage == null) {
                Log.Debug("DocumentSettings: No storage element found for {Type}", typeof(T).Name);
                return null;
            }

            var schema = this.GetOrCreateSchema();
            var entity = dataStorage.GetEntity(schema);

            if (!entity.IsValid()) {
                Log.Warning("DocumentSettings: Invalid entity for {Type}", typeof(T).Name);
                return null;
            }

            var jsonData = entity.Get<string>("JsonData");
            if (string.IsNullOrWhiteSpace(jsonData)) {
                Log.Warning("DocumentSettings: Empty JSON data for {Type}", typeof(T).Name);
                return null;
            }

            var settings = JsonConvert.DeserializeObject<T>(jsonData, JsonSettings);
            Log.Debug("DocumentSettings: Successfully read {Type}", typeof(T).Name);
            return settings;
        } catch (Exception ex) {
            Log.Error(ex, "DocumentSettings: Failed to read {Type}", typeof(T).Name);
            return null;
        }
    }

    /// <summary>
    ///     Writes settings to the document, creating the DataStorage element if needed.
    /// </summary>
    public void Write(Autodesk.Revit.DB.Document doc, T settings) {
        if (settings == null) throw new ArgumentNullException(nameof(settings));

        using var transaction = new Transaction(doc, "Save AutoTag Settings");
        _ = transaction.Start();

        try {
            var dataStorage = this.FindDataStorage(doc) ?? this.CreateDataStorage(doc);
            var schema = this.GetOrCreateSchema();

            // Check write access before attempting to write
            if (!schema.WriteAccessGranted()) {
                throw new InvalidOperationException(
                    $"Write access denied for schema '{this._schemaName}'. " +
                    "This typically occurs when the schema was created by a different add-in context. " +
                    "Try closing Revit completely and reopening, or use a fresh document.");
            }

            var jsonData = JsonConvert.SerializeObject(settings, JsonSettings);

            var entity = new Entity(schema);
            entity.Set("Version", 1); // For future migration hints
            entity.Set("JsonData", jsonData);

            dataStorage.SetEntity(entity);

            _ = transaction.Commit();
            Log.Information("DocumentSettings: Successfully wrote {Type} to document", typeof(T).Name);
        } catch (Exception ex) {
            _ = transaction.RollBack();
            Log.Error(ex, "DocumentSettings: Failed to write {Type}", typeof(T).Name);
            throw;
        }
    }

    /// <summary>
    ///     Checks if settings exist in the document.
    /// </summary>
    public bool Exists(Autodesk.Revit.DB.Document doc) => this.FindDataStorage(doc) != null;

    /// <summary>
    ///     Deletes settings from the document.
    /// </summary>
    public void Delete(Autodesk.Revit.DB.Document doc) {
        var dataStorage = this.FindDataStorage(doc);
        if (dataStorage == null) return;

        using var transaction = new Transaction(doc, "Delete AutoTag Settings");
        _ = transaction.Start();

        try {
            _ = doc.Delete(dataStorage.Id);
            _ = transaction.Commit();
            Log.Information("DocumentSettings: Successfully deleted {Type} from document", typeof(T).Name);
        } catch (Exception ex) {
            _ = transaction.RollBack();
            Log.Error(ex, "DocumentSettings: Failed to delete {Type}", typeof(T).Name);
            throw;
        }
    }

    /// <summary>
    ///     Finds the DataStorage element for this settings type.
    /// </summary>
    private DataStorage? FindDataStorage(Autodesk.Revit.DB.Document doc) => new FilteredElementCollector(doc)
        .OfClass(typeof(DataStorage))
        .Cast<DataStorage>()
        .FirstOrDefault(ds => ds.Name == this._storageElementName);

    /// <summary>
    ///     Creates a new DataStorage element for this settings type.
    /// </summary>
    private DataStorage CreateDataStorage(Autodesk.Revit.DB.Document doc) {
        var dataStorage = DataStorage.Create(doc);
        dataStorage.Name = this._storageElementName;
        Log.Debug("DocumentSettings: Created DataStorage element '{Name}'", this._storageElementName);
        return dataStorage;
    }

    /// <summary>
    ///     Gets or creates the Extensible Storage schema.
    /// </summary>
    private Schema GetOrCreateSchema() {
        // Check if schema already exists in memory
        var schema = Schema.Lookup(this._schemaGuid);
        if (schema != null) return schema;

        // Create new schema
        var builder = new SchemaBuilder(this._schemaGuid);
        _ = builder.SetSchemaName(this._schemaName);
        _ = builder.SetVendorId(this._vendorId);
        _ = builder.SetReadAccessLevel(AccessLevel.Public); // All can read
        // Use Vendor access level - more forgiving than Application level which requires
        // exact GUID match and fails if schema was created in a different context
        _ = builder.SetWriteAccessLevel(AccessLevel.Vendor);

        // Add fields
        _ = builder.AddSimpleField("Version", typeof(int));
        _ = builder.AddSimpleField("JsonData", typeof(string));

        schema = builder.Finish();
        Log.Debug("DocumentSettings: Created schema '{Name}'", this._schemaName);
        return schema;
    }
}