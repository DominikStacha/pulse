using Pulse.Api;

namespace Pulse.Tests;

public class UaTests
{
    [Theory]
    [InlineData(Uas.Chrome, "Chrome", "Windows", "desktop")]
    [InlineData("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0", "Edge", "Windows", "desktop")]
    [InlineData("Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 EdgA/130.0.0.0", "Edge", "Android", "mobile")]
    [InlineData("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0", "Opera", "Windows", "desktop")]
    [InlineData("Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36", "Samsung Internet", "Android", "mobile")]
    [InlineData("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0", "Firefox", "Windows", "desktop")]
    [InlineData("Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0", "Firefox", "Linux", "desktop")]
    [InlineData("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15", "Safari", "macOS", "desktop")]
    [InlineData(Uas.IPhone, "Safari", "iOS", "mobile")]
    [InlineData("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1", "Chrome", "iOS", "mobile")]
    [InlineData("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15", "Firefox", "iOS", "mobile")]
    [InlineData("Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", "Safari", "iPadOS", "tablet")]
    [InlineData("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36", "Chrome", "Android", "mobile")]
    [InlineData("Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36", "Chrome", "Android", "tablet")]
    [InlineData("Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36", "Chrome", "ChromeOS", "desktop")]
    [InlineData("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36", "Chrome", "Linux", "desktop")]
    [InlineData("SomethingElse/1.0", "Other", "Other", "desktop")]
    public void Classifies_browser_os_and_device(string ua, string browser, string os, string device) =>
        Assert.Equal((browser, os, device), Ua.Parse(ua, null));

    [Theory]
    [InlineData("360x640", "mobile")] // desktop-looking UA, narrow screen
    [InlineData("767x1000", "mobile")]
    [InlineData("768x1024", "desktop")]
    [InlineData("1920x1080", "desktop")]
    [InlineData("garbage", "desktop")]
    [InlineData("x500", "desktop")]
    [InlineData(null, "desktop")]
    public void A_narrow_screen_breaks_the_tie_only_when_the_UA_says_desktop(string? screen, string device) =>
        Assert.Equal(device, Ua.Parse(Uas.Chrome, screen).Device);

    [Fact]
    public void The_screen_does_not_override_a_clear_UA()
    {
        Assert.Equal("tablet", Ua.Parse("Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Version/18.1 Mobile/15E148 Safari/604.1", "700x900").Device);
        Assert.Equal("mobile", Ua.Parse(Uas.IPhone, "1920x1080").Device);
    }

    [Theory]
    [InlineData(null, true)]
    [InlineData("", true)]
    [InlineData("  ", true)]
    [InlineData("Googlebot/2.1", true)]
    [InlineData("Mozilla/5.0 (compatible; bingbot/2.0)", true)]
    [InlineData("HeadlessChrome/120", true)]
    [InlineData("Lighthouse", true)]
    [InlineData("Java/17.0.1", true)]
    [InlineData("PYTHON-urllib/3.11", true)]
    [InlineData(Uas.Chrome, false)]
    [InlineData(Uas.IPhone, false)]
    [InlineData("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15", false)]
    [InlineData("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0", false)]
    public void Bot_filter(string? ua, bool bot) => Assert.Equal(bot, Ua.IsBot(ua));

    [Theory]
    [InlineData("/routes/12?x=1#a", "/routes/12")]
    [InlineData("/a#frag", "/a")]
    [InlineData("/a?x=http://evil.test/b", "/a")]
    [InlineData("https://klettr.com/routes/12?x=1", "/routes/12")]
    [InlineData("http://klettr.com", "/")]
    [InlineData("https://klettr.com?x=1", "/")]
    [InlineData("//klettr.com/p?q", "/p")]
    [InlineData("//klettr.com", "/")]
    [InlineData("/redirect/https://x.test/y", "/redirect/https://x.test/y")] // "://" inside a path is just a path
    [InlineData("relative/page?x", "/relative/page")]
    [InlineData("", "/")]
    [InlineData(null, "/")]
    [InlineData("?only=query", "/")]
    [InlineData("#only-hash", "/")]
    [InlineData("  /padded  ", "/padded")]
    [InlineData("/čeština/stránka", "/čeština/stránka")]
    public void Only_the_path_survives(string? url, string expected) => Assert.Equal(expected, Ingest.PathOf(url));

    [Fact]
    public void Path_is_capped_at_500_characters_even_for_a_giant_query()
    {
        Assert.Equal(500, Ingest.PathOf("/" + new string('a', 900)).Length);
        Assert.Equal("/x", Ingest.PathOf("/x?" + new string('q', 100_000)));
    }

    [Fact]
    public void Truncation_never_splits_a_surrogate_pair()
    {
        var s = new string('a', 9) + "😀😀"; // 9 + 4 UTF-16 units
        var cut = Ingest.Cut(s, 10)!;
        Assert.Equal(9, cut.Length); // the emoji would straddle the limit, so it is dropped whole
        Assert.Equal(s, Ingest.Cut(s, 100));
        Assert.Null(Ingest.Cut("", 5));
        Assert.Null(Ingest.Cut(null, 5));
    }

    [Theory]
    [InlineData("https://www.google.com/search?q=a", "klettr.com", "google.com")]
    [InlineData("https://klettr.com/x", "klettr.com", null)]
    [InlineData("https://www.klettr.com/x", "klettr.com", null)]
    [InlineData("https://klettr.com/x", "www.klettr.com", null)]
    [InlineData("https://portal.klettr.com/x", "klettr.com", "portal.klettr.com")] // another host of the same family is a real referrer
    [InlineData("ftp://example.com", "klettr.com", null)]
    [InlineData("javascript:alert(1)", "klettr.com", null)]
    [InlineData(null, "klettr.com", null)]
    public void Referrer_host(string? referrer, string pageHost, string? expected) => Assert.Equal(expected, Ingest.RefHost(referrer, pageHost));

    [Fact]
    public void Country_table_has_English_names_and_falls_back_to_the_code()
    {
        Assert.Equal("Czechia", Countries.Name("CZ"));
        Assert.Equal("United States", Countries.Name("US"));
        Assert.Equal("Slovakia", Countries.Name("SK"));
        Assert.Equal("ZZ", Countries.Name("ZZ"));
        Assert.Null(Countries.FromHeader("XX"));
        Assert.Null(Countries.FromHeader("T1"));
        Assert.Equal("CZ", Countries.FromHeader("cz"));
    }
}
