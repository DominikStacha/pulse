using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Dapper;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Pulse.Api;

namespace Pulse.Tests;

public static class Ids
{
    public const string Stacha = "ac198dbf-3b47-41c5-ac40-8b92f6143b8d";
    public const string Spanel = "171ace70-dd73-4c05-a1d4-0c72761da28a";
    public const string Klettr = "9f32713b-d1b8-4632-9793-bcbc561a97dd";
}

public static class Uas
{
    public const string Chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
    public const string IPhone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
}

/// <summary>A clock the tests move by hand. (Timers still run on real time; only "now" is fake.)</summary>
public sealed class FakeClock(DateTimeOffset now) : TimeProvider
{
    DateTimeOffset _now = now;
    public override DateTimeOffset GetUtcNow() => _now;
    public void Set(DateTimeOffset now) => _now = now;
    public void Advance(TimeSpan by) => _now += by;
}

public sealed class LogCollector : ILoggerProvider
{
    public List<string> Lines { get; } = [];
    public ILogger CreateLogger(string categoryName) => new Sink(this, categoryName);
    public void Dispose() { }

    sealed class Sink(LogCollector owner, string category) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            lock (owner.Lines) owner.Lines.Add($"{category} {logLevel}: {formatter(state, exception)} {exception}");
        }
    }
}

/// <summary>The real app on a TestServer with a temp SQLite file, a fake clock and Auth disabled unless a test says otherwise.</summary>
public sealed class PulseFactory : WebApplicationFactory<Program>
{
    public string Dir { get; } = Directory.CreateTempSubdirectory("pulse-test-").FullName;
    public FakeClock Clock { get; } = new(new DateTimeOffset(2026, 11, 14, 12, 0, 0, TimeSpan.Zero));
    public LogCollector Logs { get; } = new();
    public string Environment { get; init; } = "Development";
    public Dictionary<string, string> Settings { get; init; } = new() { ["Pulse:Auth:Disabled"] = "true" };
    public Action<IServiceCollection>? Configure { get; init; }
    public string? WebRoot { get; init; }

    public string StatusDir => Path.Combine(Dir, "status");
    public string DbPath => Path.Combine(Dir, "pulse.db");
    public Db Db => Services.GetRequiredService<Db>();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment(Environment);
        builder.UseSetting("Pulse:DbPath", DbPath);
        builder.UseSetting("Pulse:StatusDir", StatusDir);
        foreach (var (k, v) in Settings) builder.UseSetting(k, v);
        if (WebRoot is not null) builder.UseWebRoot(WebRoot);
        builder.ConfigureLogging(l => l.AddProvider(Logs));
        builder.ConfigureServices(s =>
        {
            s.RemoveAll<TimeProvider>();
            s.AddSingleton<TimeProvider>(Clock);
            Configure?.Invoke(s);
        });
    }

    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        SqliteConnection.ClearAllPools(); // release the temp file
        try { Directory.Delete(Dir, true); } catch (IOException) { }
    }
}

public sealed class Ev
{
    public string SiteId { get; set; } = "";
    public long Ts { get; set; }
    public long Visitor { get; set; }
    public long Visit { get; set; }
    public long Kind { get; set; }
    public string? Name { get; set; }
    public string Path { get; set; } = "";
    public string? Title { get; set; }
    public string? Referrer { get; set; }
    public string? Country { get; set; }
    public string Browser { get; set; } = "";
    public string Os { get; set; } = "";
    public string Device { get; set; } = "";
    public string? Screen { get; set; }
    public string? Language { get; set; }
    public string? Data { get; set; }
}

public static class TestExtensions
{
    public static List<Ev> Events(this Db db) => db.Rows<Ev>(
        "SELECT site_id AS SiteId, ts AS Ts, visitor AS Visitor, visit AS Visit, kind AS Kind, name AS Name, path AS Path, title AS Title, referrer AS Referrer, " +
        "country AS Country, browser AS Browser, os AS Os, device AS Device, screen AS Screen, language AS Language, data AS Data FROM events ORDER BY id");

    public static void Add(this Db db, string site, DateTimeOffset at, long visitor, long visit, int kind = 1, string? name = null, string path = "/",
        string? referrer = null, string? country = null, string browser = "Chrome", string os = "Windows", string device = "desktop",
        string? screen = null, string? language = null, string? data = null)
    {
        using var c = db.Open();
        c.Execute("""
            INSERT INTO events(site_id, ts, visitor, visit, kind, name, path, title, referrer, country, browser, os, device, screen, language, data)
            VALUES (@site, @ts, @visitor, @visit, @kind, @name, @path, NULL, @referrer, @country, @browser, @os, @device, @screen, @language, @data)
            """, new { site, ts = at.ToUnixTimeMilliseconds(), visitor, visit, kind, name, path, referrer, country, browser, os, device, screen, language, data });
    }

    public static List<T> Rows<T>(this Db db, string sql, object? param = null)
    {
        using var c = db.Open();
        return c.Query<T>(sql, param).ToList();
    }

    public static long Count(this Db db, string table) => db.Rows<long>($"SELECT COUNT(*) FROM {table}")[0];

    /// <summary>POSTs an Umami-style event. Returns the response; the User-Agent defaults to a normal Chrome.</summary>
    public static async Task<HttpResponseMessage> Send(this HttpClient client, object body, string? ua = Uas.Chrome, params (string Name, string Value)[] headers)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/send") { Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json") };
        if (ua is not null) req.Headers.TryAddWithoutValidation("User-Agent", ua);
        foreach (var (name, value) in headers) req.Headers.TryAddWithoutValidation(name, value);
        return await client.SendAsync(req);
    }

    public static async Task<HttpResponseMessage> SendRaw(this HttpClient client, string json, string ua = Uas.Chrome)
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/send") { Content = new StringContent(json, Encoding.UTF8, "application/json") };
        req.Headers.TryAddWithoutValidation("User-Agent", ua);
        return await client.SendAsync(req);
    }

    public static object Pageview(string site = Ids.Stacha, string hostname = "stacha.tech", string url = "/", object? extra = null)
    {
        var payload = new Dictionary<string, object?> { ["website"] = site, ["hostname"] = hostname, ["url"] = url };
        if (extra is not null) foreach (var p in extra.GetType().GetProperties()) payload[p.Name] = p.GetValue(extra);
        return new { type = "event", payload };
    }

    public static async Task<JsonElement> Json(this HttpClient client, string url)
    {
        var res = await client.GetAsync(url);
        res.EnsureSuccessStatusCode();
        return await res.Content.ReadFromJsonAsync<JsonElement>();
    }
}
