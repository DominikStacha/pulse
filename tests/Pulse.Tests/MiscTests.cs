using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using Pulse.Api;

namespace Pulse.Tests;

public class RetentionTests
{
    [Fact]
    public async Task Events_older_than_25_months_are_deleted_and_newer_ones_kept()
    {
        using var f = new PulseFactory();
        f.CreateClient();
        var now = f.Clock.GetUtcNow(); // 2026-11-14 12:00 UTC; cutoff = 2024-10-14 12:00 UTC
        var cutoff = now.AddMonths(-25);
        Assert.Equal(new DateTimeOffset(2024, 10, 14, 12, 0, 0, TimeSpan.Zero), cutoff);
        f.Db.Add(Ids.Stacha, cutoff.AddSeconds(-1), 1, 1, path: "/gone-1s");
        f.Db.Add(Ids.Stacha, new DateTimeOffset(2023, 1, 1, 0, 0, 0, TimeSpan.Zero), 2, 2, path: "/gone-old");
        f.Db.Add(Ids.Klettr, cutoff.AddDays(-200), 3, 3, 2, "ev", "/gone-event");
        f.Db.Add(Ids.Stacha, cutoff, 4, 4, path: "/kept-exactly-at-cutoff");
        f.Db.Add(Ids.Stacha, cutoff.AddDays(1), 5, 5, path: "/kept-1d");
        f.Db.Add(Ids.Klettr, now.AddDays(-1), 6, 6, path: "/kept-recent");

        Assert.Equal(3, Retention.Run(f.Db, now));
        Assert.Equal(["/kept-exactly-at-cutoff", "/kept-1d", "/kept-recent"], f.Db.Events().Select(e => e.Path));
        Assert.Equal(0, Retention.Run(f.Db, now)); // idempotent
        Assert.Equal(6, f.Db.Count("sites")); // only events are touched
    }

    [Fact]
    public async Task The_cutoff_moves_with_the_clock()
    {
        using var f = new PulseFactory();
        f.CreateClient();
        f.Db.Add(Ids.Stacha, new DateTimeOffset(2024, 11, 1, 0, 0, 0, TimeSpan.Zero), 1, 1);
        Assert.Equal(0, Retention.Run(f.Db, f.Clock.GetUtcNow())); // 24 months old on 2026-11-14
        Assert.Equal(1, Retention.Run(f.Db, new DateTimeOffset(2026, 12, 2, 0, 0, 0, TimeSpan.Zero))); // 25 months and a day on 2 Dec
    }

    [Fact]
    public async Task The_daily_job_is_registered_and_does_not_run_before_its_first_delay()
    {
        using var f = new PulseFactory();
        f.CreateClient();
        Assert.Contains(f.Services.GetServices<Microsoft.Extensions.Hosting.IHostedService>(), s => s is Retention);
        f.Db.Add(Ids.Stacha, new DateTimeOffset(2020, 1, 1, 0, 0, 0, TimeSpan.Zero), 1, 1);
        await Task.Delay(300);
        Assert.Equal(1, f.Db.Count("events")); // the job waits a minute after start, so a fresh process never deletes in the middle of a deploy check
    }
}

public class StatusTests
{
    [Fact]
    public async Task Status_files_are_passed_through_byte_for_byte()
    {
        using var f = new PulseFactory();
        var c = f.CreateClient();
        Directory.CreateDirectory(f.StatusDir);
        var status = "{\n  \"generatedAt\": \"2026-11-14T12:00:00Z\",\n  \"host\": \"raspberry\",\n  \"note\": \"čeština ✓\",\n  \"nested\": {\"a\": [1, 2, 3]}\n}\n";
        var history = """{"fields":["t","load1","memUsedBytes","diskUsedBytes","temperatureC"],"rows":[[1,0.5,100,200,45.1]]}""";
        await File.WriteAllTextAsync(Path.Combine(f.StatusDir, "status.json"), status, new UTF8Encoding(false));
        await File.WriteAllTextAsync(Path.Combine(f.StatusDir, "history.json"), history, new UTF8Encoding(false));

        var res = await c.GetAsync("/api/status");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal("application/json", res.Content.Headers.ContentType!.MediaType);
        Assert.Equal(Encoding.UTF8.GetBytes(status), await res.Content.ReadAsByteArrayAsync());
        Assert.Equal(history, await c.GetStringAsync("/api/status/history"));
    }

    [Fact]
    public async Task Status_is_503_with_an_error_body_when_the_files_or_the_directory_are_missing()
    {
        using var f = new PulseFactory();
        var c = f.CreateClient();
        foreach (var url in new[] { "/api/status", "/api/status/history" })
        {
            var res = await c.GetAsync(url); // directory does not exist
            Assert.Equal(HttpStatusCode.ServiceUnavailable, res.StatusCode);
            Assert.True((await res.Content.ReadFromJsonAsync<JsonElement>()).TryGetProperty("error", out _));
        }

        Directory.CreateDirectory(f.StatusDir);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await c.GetAsync("/api/status")).StatusCode); // directory exists, file does not
        await File.WriteAllTextAsync(Path.Combine(f.StatusDir, "status.json"), "{}");
        Assert.Equal(HttpStatusCode.OK, (await c.GetAsync("/api/status")).StatusCode);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, (await c.GetAsync("/api/status/history")).StatusCode);
    }

    [Fact]
    public async Task Status_follows_file_updates_without_caching()
    {
        using var f = new PulseFactory();
        var c = f.CreateClient();
        Directory.CreateDirectory(f.StatusDir);
        var path = Path.Combine(f.StatusDir, "status.json");
        await File.WriteAllTextAsync(path, """{"n":1}""");
        Assert.Equal("""{"n":1}""", await c.GetStringAsync("/api/status"));
        await File.WriteAllTextAsync(path, """{"n":2}""");
        Assert.Equal("""{"n":2}""", await c.GetStringAsync("/api/status"));
    }
}

public class HostingTests
{
    static string RepoFile(params string[] parts)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "Pulse.slnx"))) dir = dir.Parent;
        return Path.Combine([dir!.FullName, .. parts]);
    }

    [Fact]
    public async Task Script_is_the_tracker_file_with_the_right_headers()
    {
        using var f = new PulseFactory();
        var res = await f.CreateClient().GetAsync("/script.js");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal("text/javascript", res.Content.Headers.ContentType!.MediaType);
        Assert.Equal("public, max-age=3600", res.Headers.CacheControl!.ToString());
        Assert.Equal(await File.ReadAllTextAsync(RepoFile("tracker", "script.js")), await res.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Healthz_is_200_ok()
    {
        using var f = new PulseFactory();
        var res = await f.CreateClient().GetAsync("/healthz");
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal("ok", await res.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task The_SPA_is_served_from_wwwroot_with_a_fallback_to_index_html_but_never_for_api_paths()
    {
        var root = Directory.CreateTempSubdirectory("pulse-www-").FullName;
        try
        {
            Directory.CreateDirectory(Path.Combine(root, "assets"));
            await File.WriteAllTextAsync(Path.Combine(root, "index.html"), "<!doctype html><title>SPA-MARKER</title>");
            await File.WriteAllTextAsync(Path.Combine(root, "assets", "app.abc123.js"), "console.log('app');");
            using var f = new PulseFactory { WebRoot = root };
            var c = f.CreateClient();

            foreach (var url in new[] { "/", "/index.html", "/live", "/status", "/sites", "/deep/link/with/segments", "/sites?site=x&period=7d" })
            {
                var res = await c.GetAsync(url);
                Assert.True(res.StatusCode == HttpStatusCode.OK, $"{url} -> {res.StatusCode}");
                Assert.Contains("SPA-MARKER", await res.Content.ReadAsStringAsync());
                Assert.Equal("text/html", res.Content.Headers.ContentType!.MediaType);
                Assert.Contains("no-cache", res.Headers.CacheControl!.ToString()); // a new deploy must be picked up at once
            }

            var js = await c.GetAsync("/assets/app.abc123.js");
            Assert.Equal("console.log('app');", await js.Content.ReadAsStringAsync());
            Assert.Contains("javascript", js.Content.Headers.ContentType!.MediaType);

            Assert.Equal(HttpStatusCode.NotFound, (await c.GetAsync("/assets/missing.js")).StatusCode); // a missing file is a 404, not index.html

            foreach (var url in new[] { "/api/nope", "/api", "/api/stats/nothing", "/API/nope" })
            {
                var res = await c.GetAsync(url);
                Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
                Assert.DoesNotContain("SPA-MARKER", await res.Content.ReadAsStringAsync());
            }

            Assert.Equal("ok", await c.GetStringAsync("/healthz")); // real endpoints win over the fallback
            Assert.Contains("umami", await c.GetStringAsync("/script.js"));
            Assert.Equal(HttpStatusCode.OK, (await c.GetAsync("/api/sites")).StatusCode);
        }
        finally { Directory.Delete(root, true); }
    }

    [Fact]
    public async Task Without_a_built_dashboard_the_root_is_just_404()
    {
        var root = Directory.CreateTempSubdirectory("pulse-www-empty-").FullName;
        try
        {
            using var f = new PulseFactory { WebRoot = root };
            Assert.Equal(HttpStatusCode.NotFound, (await f.CreateClient().GetAsync("/")).StatusCode);
        }
        finally { Directory.Delete(root, true); }
    }
}

public class DbTests
{
    [Fact]
    public async Task The_database_is_created_with_WAL_and_the_two_indexes_in_a_new_directory()
    {
        using var f = new PulseFactory();
        f.CreateClient();
        Assert.Equal("wal", f.Db.Rows<string>("PRAGMA journal_mode")[0]);
        Assert.Equal(["events_site_ts", "events_site_visitor_ts"], f.Db.Rows<string>("SELECT name FROM pragma_index_list('events') WHERE origin = 'c' ORDER BY name"));
        Assert.Equal(["id", "ts"], f.Db.Rows<string>("SELECT name FROM pragma_table_info('events') WHERE name IN ('id', 'ts') ORDER BY name"));

        var dir = Directory.CreateTempSubdirectory("pulse-nested-").FullName;
        try
        {
            var nested = Path.Combine(dir, "a", "b", "pulse.db");
            _ = new Db(nested, null, TimeProvider.System);
            Assert.True(File.Exists(nested));
        }
        finally { Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools(); Directory.Delete(dir, true); }
    }
}

public class DemoTests
{
    [Fact]
    public async Task Seeding_creates_consistent_synthetic_history_for_the_known_sites()
    {
        using var f = new PulseFactory();
        f.CreateClient();
        Demo.Seed(f.Db, f.Clock, 30, reset: false);

        var events = f.Db.Events();
        Assert.InRange(events.Count, 1500, 100_000);
        var now = f.Clock.GetUtcNow().ToUnixTimeMilliseconds();
        Assert.All(events, e => Assert.InRange(e.Ts, now - 31L * 24 * 3600 * 1000, now));
        Assert.Equal(6, events.Select(e => e.SiteId).Distinct().Count());
        Assert.Contains(events, e => e.Kind == 2 && e.Name is not null);
        Assert.All(events.Where(e => e.Kind == 2), e => Assert.NotNull(e.Name));
        Assert.All(events.Where(e => e.Kind == 1), e => Assert.Null(e.Name));
        Assert.All(events.Where(e => e.Data is not null), e => JsonDocument.Parse(e.Data!).Dispose());
        Assert.True(events.Select(e => e.Country).Where(c => c is not null).Distinct().Count() >= 5);
        Assert.Equal(["desktop", "mobile", "tablet"], events.Select(e => e.Device).Distinct().Order());
        Assert.All(events, e => Assert.StartsWith("/", e.Path));

        // The same rules as the real ingest path: events of one visitor less than 30 min apart share a visit, further apart they do not.
        foreach (var byVisitor in events.GroupBy(e => e.Visitor))
        {
            var ordered = byVisitor.OrderBy(e => e.Ts).ToArray();
            for (var i = 1; i < ordered.Length; i++)
            {
                var gap = ordered[i].Ts - ordered[i - 1].Ts;
                Assert.Equal(gap < Events.VisitGapMs, ordered[i].Visit == ordered[i - 1].Visit);
            }
        }
        // And in insertion order = time order, which the "recent" list relies on.
        Assert.Equal(events.OrderBy(e => e.Ts).Select(e => e.Ts), events.Select(e => e.Ts));
    }

    [Fact]
    public async Task Seeding_is_repeatable_and_refuses_to_overwrite_unless_asked()
    {
        using var f = new PulseFactory();
        f.CreateClient();
        Demo.Seed(f.Db, f.Clock, 10, reset: false);
        var first = f.Db.Count("events");
        Assert.Throws<InvalidOperationException>(() => Demo.Seed(f.Db, f.Clock, 10, reset: false));
        Assert.Equal(first, f.Db.Count("events"));
        Demo.Seed(f.Db, f.Clock, 10, reset: true);
        Assert.Equal(first, f.Db.Count("events")); // fixed random seed: the same data again
    }

    [Fact]
    public async Task Demo_data_shows_up_in_the_dashboard_endpoints()
    {
        using var f = new PulseFactory();
        var c = f.CreateClient();
        Demo.Seed(f.Db, f.Clock, 120, reset: false);
        var summary = await c.Json("/api/stats/summary?period=90d");
        Assert.True(summary.GetProperty("current").GetProperty("visitors").GetInt64() > 100);
        Assert.True(summary.GetProperty("previous").GetProperty("visitors").GetInt64() > 100);
        var series = await c.Json("/api/stats/timeseries?period=12m");
        Assert.Equal(12, series.GetProperty("points").GetArrayLength());
        foreach (var dim in new[] { "pages", "entries", "exits", "referrers", "countries", "browsers", "os", "devices", "languages", "screens", "events", "sites" })
            Assert.True((await c.Json($"/api/stats/breakdown?dim={dim}&period=30d")).GetProperty("rows").GetArrayLength() > 0, dim);
    }

    [Fact]
    public async Task The_live_trickle_stores_hits_through_the_ingest_path_and_broadcasts_them()
    {
        using var f = new PulseFactory { Configure = s => s.AddHostedService<Demo.Live>() };
        f.CreateClient();
        var ch = f.Services.GetRequiredService<LiveHub>().Subscribe();
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        var hit = await ch.Reader.ReadAsync(cts.Token); // the trickle waits 1.5-5 s per hit

        Assert.Contains(f.Db.Rows<string>("SELECT id FROM sites"), id => id == hit.SiteId);
        Assert.StartsWith("/", hit.Path);
        var stored = f.Db.Events();
        Assert.NotEmpty(stored);
        Assert.Equal(hit.Path, stored[0].Path);
        Assert.Equal(f.Clock.GetUtcNow().ToUnixTimeMilliseconds(), stored[0].Ts);
        // Synthetic visitors only: nothing but the hash of an RFC 5737 documentation address was ever involved.
        Assert.DoesNotContain(f.Logs.Lines, l => l.Contains("203.0.113."));
    }

    [Fact]
    public async Task Ingestion_has_a_global_rate_limit()
    {
        using var f = new PulseFactory { Settings = new() { ["Pulse:Auth:Disabled"] = "true", ["Pulse:IngestPerSecond"] = "3" } };
        var c = f.CreateClient();
        var codes = new List<int>();
        for (var i = 0; i < 6; i++) codes.Add((int)(await c.PostAsync("/api/send", new StringContent(
            """{"type":"event","payload":{"website":"WEBSITE","hostname":"stacha.tech","url":"/"}}""".Replace("WEBSITE", Ids.Stacha), System.Text.Encoding.UTF8, "application/json"))).StatusCode);
        Assert.Contains(429, codes);
        Assert.True(f.Db.Count("events") <= 3);
    }

    [Theory]
    [InlineData("/")]
    [InlineData("/api/sites")]
    public async Task Responses_carry_security_headers(string path)
    {
        using var f = new PulseFactory();
        var r = await f.CreateClient().GetAsync(path);
        var csp = string.Join(' ', r.Headers.GetValues("Content-Security-Policy"));
        Assert.Contains("script-src 'self';", csp);
        Assert.Contains("frame-ancestors 'none'", csp);
        Assert.Equal("nosniff", string.Join(' ', r.Headers.GetValues("X-Content-Type-Options")));
        Assert.Equal("no-referrer", string.Join(' ', r.Headers.GetValues("Referrer-Policy")));
    }
}
