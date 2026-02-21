namespace Beowulf.Cedar;

public class BeowulfApiException : Exception
{
    public int? StatusCode { get; }
    public string? ResponseBody { get; }

    public BeowulfApiException(string message, int? statusCode = null, string? responseBody = null, Exception? innerException = null)
        : base(message, innerException)
    {
        StatusCode = statusCode;
        ResponseBody = responseBody;
    }
}
