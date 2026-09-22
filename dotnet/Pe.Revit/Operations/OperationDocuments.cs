using Autodesk.Revit.DB;

namespace Pe.Revit.Operations;

public readonly record struct RevitDocument(Document Value);
public readonly record struct ProjectDocument(Document Value);
public readonly record struct FamilyDocument(Document Value);
