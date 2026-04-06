namespace Pe.Global.Services.Aps.Models;

public class TokenProviders {
    /// <summary>Interface for providing APS authentication credentials to the OAuth class</summary>
    public interface IAuth {
        string GetClientId();
        string GetClientSecret();
    }


    public interface IParameters {
        string GetAccountId();
        string GetGroupId();
        string GetCollectionId();
    }
}