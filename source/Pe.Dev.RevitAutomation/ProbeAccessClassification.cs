namespace Pe.Dev.RevitAutomation;

public enum ProbeAccessClassification {
    Success,
    ManagementTokenFailed,
    UserTokenFailed,
    WorkItemSubmissionUnauthorized,
    WorkItemSubmissionFailed,
    CloudModelUnauthorized,
    CloudModelNotFound,
    CloudModelOpenFailed,
    TimedOut
}
