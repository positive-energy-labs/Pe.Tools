namespace Pe.Aps.Auth;

public interface IApsCredentialProvider {
    string GetClientId();
    string GetClientSecret();
}
