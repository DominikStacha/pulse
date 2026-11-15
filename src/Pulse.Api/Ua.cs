using System.Text.RegularExpressions;

namespace Pulse.Api;

/// <summary>Small in-house user-agent parser and bot filter. The UA is never stored or logged, only classified.</summary>
public static partial class Ua
{
    [GeneratedRegex(
        "bot|crawl|spider|slurp|headless|lighthouse|pingdom|uptime|monitor|preview|python|curl|wget|httpclient|go-http|java/|okhttp|facebookexternalhit"
        + "|scrapy|axios|node-fetch|undici|libwww|postman|phantomjs|selenium|puppeteer|playwright|gtmetrix|pagespeed|feedfetcher|mediapartners|ia_archiver|zgrab|restsharp|aiohttp",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex Bots();

    public static bool IsBot(string? ua) => string.IsNullOrWhiteSpace(ua) || Bots().IsMatch(ua);

    static bool Has(string ua, params string[] tokens) => tokens.Any(ua.Contains);

    public static (string Browser, string Os, string Device) Parse(string ua, string? screen)
    {
        var browser =
            Has(ua, "Edg/", "EdgA/", "EdgiOS/", "Edge/") ? "Edge"
            : Has(ua, "OPR/", "Opera", "OPiOS/", "OPT/") ? "Opera"
            : ua.Contains("SamsungBrowser/") ? "Samsung Internet"
            : Has(ua, "Firefox/", "FxiOS/") ? "Firefox"
            : Has(ua, "Chrome/", "CriOS/", "Chromium/") ? "Chrome"
            : ua.Contains("Safari/") ? "Safari"
            : "Other";

        var os =
            Has(ua, "iPhone", "iPod") ? "iOS"
            : ua.Contains("iPad") ? "iPadOS"
            : ua.Contains("Android") ? "Android"
            : ua.Contains("CrOS") ? "ChromeOS"
            : ua.Contains("Windows") ? "Windows"
            : Has(ua, "Macintosh", "Mac OS X") ? "macOS"
            : Has(ua, "Linux", "X11") ? "Linux"
            : "Other";

        var device =
            Has(ua, "iPad", "Tablet", "Kindle", "Silk/") || (ua.Contains("Android") && !ua.Contains("Mobi")) ? "tablet"
            : Has(ua, "Mobi", "iPhone", "iPod", "Windows Phone") ? "mobile"
            : "desktop";

        // Tie-breaker: the UA gave no hint, a narrow screen means phone.
        if (device == "desktop" && ScreenWidth(screen) is > 0 and < 768) device = "mobile";

        return (browser, os, device);
    }

    static int ScreenWidth(string? screen) =>
        screen?.IndexOf('x') is > 0 and var i && int.TryParse(screen.AsSpan(0, i), out var w) ? w : 0;
}
