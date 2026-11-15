using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using Dapper;
using Pulse.Api;

namespace Pulse.Tests;

public class PrivacyTests
{
    sealed class SaltRow { public string Month { get; set; } = ""; public byte[] Salt { get; set; } = []; }

    static SaltRow CurrentSalt(Db db) => db.Rows<SaltRow>("SELECT month AS Month, salt AS Salt FROM salts").Single(); // Single: only one row may exist

    [Fact]
    public async Task Visitor_id_is_the_first_8_bytes_of_sha256_of_salt_site_ip_ua_as_signed_int64()
    {
        using var f = new PulseFactory();
        var c = f.CreateClient();
        await c.Send(TestExtensions.Pageview(), Uas.Chrome, ("CF-Connecting-IP", "198.51.100.23"));

        var salt = f.Db.Rows<byte[]>("SELECT salt FROM salts").Single();
        Assert.Equal(32, salt.Length);
        var hash = SHA256.HashData([.. salt, .. Encoding.UTF8.GetBytes(Ids.Stacha + "198.51.100.23" + Uas.Chrome)]);
        Assert.Equal(BinaryPrimitives.ReadInt64BigEndian(hash), f.Db.Events().Single().Visitor);
    }

    [Fact]
    public async Task Same_person_same_month_same_site_is_one_visitor_but_not_across_sites_or_with_another_ip_or_ua()
    {
        using var f = new PulseFactory();
        var c = f.CreateClient();
        await c.Send(TestExtensions.Pageview(), Uas.Chrome, ("CF-Connecting-IP", "198.51.100.1"));
        await c.Send(TestExtensions.Pageview(), Uas.Chrome, ("CF-Connecting-IP", "198.51.100.1"));
        await c.Send(TestExtensions.Pageview(Ids.Klettr, "klettr.com"), Uas.Chrome, ("CF-Connecting-IP", "198.51.100.1")); // other site
        await c.Send(TestExtensions.Pageview(), Uas.Chrome, ("CF-Connecting-IP", "198.51.100.2")); // other ip
        await c.Send(TestExtensions.Pageview(), Uas.IPhone, ("CF-Connecting-IP", "198.51.100.1")); // other ua

        var v = f.Db.Events().Select(e => e.Visitor).ToArray();
        Assert.Equal(v[0], v[1]);
        Assert.Equal(4, v.Distinct().Count());
    }

    [Fact]
    public async Task IP_source_is_CF_Connecting_IP_then_first_X_Forwarded_For_then_the_socket()
    {
        using var f = new PulseFactory();
        var c = f.CreateClient();
        await c.Send(TestExtensions.Pageview(), Uas.Chrome, ("CF-Connecting-IP", "198.51.100.7"), ("X-Forwarded-For", "203.0.113.9"));
        await c.Send(TestExtensions.Pageview(), Uas.Chrome, ("X-Forwarded-For", "198.51.100.7, 203.0.113.9")); // same ip as the CF one
        await c.Send(TestExtensions.Pageview(), Uas.Chrome, ("CF-Connecting-IP", "203.0.113.9")); // the proxy ip is a different person
        await c.Send(TestExtensions.Pageview(), Uas.Chrome); // socket (none in TestServer): yet another bucket

        var v = f.Db.Events().Select(e => e.Visitor).ToArray();
        Assert.Equal(v[0], v[1]);
        Assert.Equal(3, v.Distinct().Count());
    }

    [Fact]
    public async Task The_salt_rotates_each_UTC_month_and_old_salts_are_deleted()
    {
        using var f = new PulseFactory();
        f.Clock.Set(new DateTimeOffset(2026, 10, 31, 23, 59, 0, TimeSpan.Zero));
        var c = f.CreateClient();
        await c.Send(TestExtensions.Pageview(), Uas.Chrome, ("CF-Connecting-IP", "198.51.100.5"));
        var october = CurrentSalt(f.Db);
        Assert.Equal("2026-10", october.Month);

        f.Clock.Set(new DateTimeOffset(2026, 11, 1, 0, 0, 1, TimeSpan.Zero));
        await c.Send(TestExtensions.Pageview(), Uas.Chrome, ("CF-Connecting-IP", "198.51.100.5"));

        var november = CurrentSalt(f.Db); // QuerySingle: the October row is gone
        Assert.Equal("2026-11", november.Month);
        Assert.NotEqual(october.Salt, november.Salt);
        Assert.Equal(1, f.Db.Count("salts"));
        var v = f.Db.Events().Select(e => e.Visitor).ToArray();
        Assert.NotEqual(v[0], v[1]); // same person, new month: not linkable
    }

    [Fact]
    public void A_restart_in_the_same_month_keeps_the_salt_so_ids_stay_stable()
    {
        var dir = Directory.CreateTempSubdirectory("pulse-salt-").FullName;
        try
        {
            var clock = new FakeClock(new DateTimeOffset(2026, 11, 14, 12, 0, 0, TimeSpan.Zero));
            var db = new Db(Path.Combine(dir, "p.db"), null, clock);
            var first = new Salts(db, clock).Visitor("s", "1.1.1.1", "ua");
            var second = new Salts(db, clock).Visitor("s", "1.1.1.1", "ua"); // new instance = process restart
            Assert.Equal(first, second);
        }
        finally { Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools(); Directory.Delete(dir, true); }
    }

    [Fact]
    public async Task Visits_split_after_30_minutes_without_an_event()
    {
        using var f = new PulseFactory();
        var c = f.CreateClient();
        async Task Hit() => await c.Send(TestExtensions.Pageview(), Uas.Chrome, ("CF-Connecting-IP", "198.51.100.9"));

        await Hit(); // 12:00:00
        f.Clock.Advance(TimeSpan.FromMinutes(29) + TimeSpan.FromSeconds(59));
        await Hit(); // 29:59 after the last event: same visit
        f.Clock.Advance(TimeSpan.FromMinutes(29) + TimeSpan.FromSeconds(59));
        await Hit(); // the gap counts from the LAST event, not the first: still the same visit
        f.Clock.Advance(TimeSpan.FromMinutes(30));
        await Hit(); // exactly 30:00 after the last event: new visit
        f.Clock.Advance(TimeSpan.FromHours(5));
        await Hit(); // new visit

        var e = f.Db.Events();
        Assert.Single(e.Select(x => x.Visitor).Distinct());
        Assert.Equal(e[0].Visit, e[1].Visit);
        Assert.Equal(e[0].Visit, e[2].Visit);
        Assert.NotEqual(e[2].Visit, e[3].Visit);
        Assert.NotEqual(e[3].Visit, e[4].Visit);
        Assert.Equal(3, e.Select(x => x.Visit).Distinct().Count());
    }

    [Fact]
    public async Task Hits_that_arrive_at_the_same_moment_from_one_visitor_share_one_visit()
    {
        using var f = new PulseFactory();
        var c = f.CreateClient();
        await c.GetAsync("/healthz");
        // A page that fires a pageview, a custom event and an SPA pageview in the same millisecond.
        var sends = Enumerable.Range(0, 30).Select(i => Task.Run(() =>
            c.Send(TestExtensions.Pageview(url: "/p" + i), Uas.Chrome, ("CF-Connecting-IP", "198.51.100.77"))));
        await Task.WhenAll(sends);

        var e = f.Db.Events();
        Assert.Equal(30, e.Count);
        Assert.Single(e.Select(x => x.Visitor).Distinct());
        Assert.Single(e.Select(x => x.Visit).Distinct());
    }

    [Fact]
    public async Task Visits_are_per_visitor_and_per_site()
    {
        using var f = new PulseFactory();
        var c = f.CreateClient();
        await c.Send(TestExtensions.Pageview(), Uas.Chrome, ("CF-Connecting-IP", "198.51.100.1"));
        await c.Send(TestExtensions.Pageview(), Uas.Chrome, ("CF-Connecting-IP", "198.51.100.2"));
        await c.Send(TestExtensions.Pageview(Ids.Klettr, "klettr.com"), Uas.Chrome, ("CF-Connecting-IP", "198.51.100.1"));
        Assert.Equal(3, f.Db.Events().Select(e => e.Visit).Distinct().Count());
    }

    [Fact]
    public async Task Event_after_a_pageview_of_the_same_visitor_shares_the_visit()
    {
        using var f = new PulseFactory();
        var c = f.CreateClient();
        await c.Send(TestExtensions.Pageview(), Uas.Chrome, ("CF-Connecting-IP", "198.51.100.1"));
        f.Clock.Advance(TimeSpan.FromSeconds(20));
        await c.Send(TestExtensions.Pageview(extra: new { name = "cv_download" }), Uas.Chrome, ("CF-Connecting-IP", "198.51.100.1"));
        var e = f.Db.Events();
        Assert.Equal(e[0].Visit, e[1].Visit);
        Assert.Equal([1L, 2L], e.Select(x => x.Kind));
    }

    [Fact]
    public async Task Neither_the_database_nor_the_logs_ever_contain_the_IP_or_the_user_agent()
    {
        using var f = new PulseFactory();
        var c = f.CreateClient();
        const string ip = "198.51.100.201";
        const string uaMarker = "UniqueUaMarker-7f3a";
        var ua = Uas.Chrome + " " + uaMarker;
        await c.Send(TestExtensions.Pageview(url: "/p?secret=q#h", extra: new { referrer = "https://www.google.com/?q=secret" }), ua, ("CF-Connecting-IP", ip), ("X-Forwarded-For", ip), ("CF-IPCountry", "CZ"));
        await c.Send(TestExtensions.Pageview(), "curl/8 " + uaMarker, ("CF-Connecting-IP", ip)); // dropped as a bot
        await c.SendRaw("{oops", ua); // 400
        await c.GetAsync("/api/sites");
        await c.GetAsync("/api/live");

        // Schema: no column that could hold an address or a user agent.
        var columns = f.Db.Rows<string>("SELECT name FROM pragma_table_info('events')");
        Assert.DoesNotContain(columns, n => n is "ip" or "ip_address" or "ua" or "user_agent" || n.Contains("agent", StringComparison.OrdinalIgnoreCase));

        // Content: every text/blob value of every table.
        using var conn = f.Db.Open();
        foreach (var table in new[] { "events", "sites", "salts" })
            foreach (var row in conn.Query($"SELECT * FROM {table}"))
                foreach (var value in ((IDictionary<string, object>)row).Values)
                {
                    var text = value is byte[] b ? Convert.ToHexString(b) + Encoding.UTF8.GetString(b) : value?.ToString() ?? "";
                    Assert.DoesNotContain(ip, text);
                    Assert.DoesNotContain(uaMarker, text);
                    Assert.DoesNotContain("secret", text);
                }

        // Raw database file (also catches WAL leftovers and freed pages).
        conn.Execute("PRAGMA wal_checkpoint(TRUNCATE)");
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        var raw = Encoding.Latin1.GetString(File.ReadAllBytes(f.DbPath));
        Assert.DoesNotContain(ip, raw);
        Assert.DoesNotContain(uaMarker, raw);

        // Logs: no request logging for /api/send, no IP, no UA anywhere.
        var logs = string.Join('\n', f.Logs.Lines);
        Assert.DoesNotContain(ip, logs);
        Assert.DoesNotContain(uaMarker, logs);
        Assert.DoesNotContain("/api/send", logs);
    }
}
