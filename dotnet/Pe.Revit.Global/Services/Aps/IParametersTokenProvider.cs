namespace Pe.Revit.Global.Services.Aps;

public interface IParametersTokenProvider {
    string GetAccountId();
    string GetGroupId();
    string GetCollectionId();
}
