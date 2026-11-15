using System.Buffers.Binary;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Dapper;
using Microsoft.Data.Sqlite;

namespace Pulse.Api;

public sealed record SiteSeed(string Id, string Name, string Domain);

/// <summary>SQLite file: schema on start, WAL, first-start site seeding. Connections are pooled by Microsoft.Data.Sqlite.</summary>
public sealed class Db
{
    const string Schema = """
        CREATE TABLE IF NOT EXISTS sites (id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS salts (month TEXT PRIMARY KEY, salt BLOB NOT NULL);
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY, site_id TEXT NOT NULL, ts INTEGER NOT NULL, visitor INTEGER NOT NULL, visit INTEGER NOT NULL,
            kind INTEGER NOT NULL, name TEXT, path TEXT, title TEXT, referrer TEXT, country TEXT, browser TEXT, os TEXT,
            device TEXT, screen TEXT, language TEXT, data TEXT);
        CREATE INDEX IF NOT EXISTS events_site_ts ON events(site_id, ts);
        CREATE INDEX IF NOT EXISTS events_site_visitor_ts ON events(site_id, visitor, ts);
        """;

    static readonly SiteSeed[] BuiltInSites =
    [
        new("ac198dbf-3b47-41c5-ac40-8b92f6143b8d", "stacha.tech", "stacha.tech"),
        new("171ace70-dd73-4c05-a1d4-0c72761da28a", "spanelstinadokapsy.cz", "spanelstinadokapsy.cz"),
        new("a48051f3-1dbf-4f3b-98ed-81f1df584e5e", "new.spanelstinadokapsy.cz", "new.spanelstinadokapsy.cz"),
        new("4d7d4cb1-3ab9-4688-aa98-43c45d8e4067", "portal.spanelstinadokapsy.cz", "portal.spanelstinadokapsy.cz"),
        new("9f32713b-d1b8-4632-9793-bcbc561a97dd", "klettr.com", "klettr.com"),
        new("15945b97-945d-4fc8-b287-dc092cfbac3f", "saliny.stacha.tech", "saliny.stacha.tech"),
    ];

    readonly string _connectionString;

    public Db(string path, string? seedSitesJson, TimeProvider clock)
    {
        if (Path.GetDirectoryName(Path.GetFullPath(path)) is { } dir) Directory.CreateDirectory(dir);
        _connectionString = new SqliteConnectionStringBuilder { DataSource = path, Mode = SqliteOpenMode.ReadWriteCreate }.ToString();

        using var c = Open();
        c.Execute("PRAGMA journal_mode=WAL");
        c.Execute(Schema);
        if (c.ExecuteScalar<long>("SELECT COUNT(*) FROM sites") == 0)
        {
            // Invalid JSON throws here on purpose: a typo in PULSE_SEED_SITES must not silently seed nothing.
            var sites = string.IsNullOrWhiteSpace(seedSitesJson)
                ? BuiltInSites
                : JsonSerializer.Deserialize<SiteSeed[]>(seedSitesJson, JsonSerializerOptions.Web) ?? [];
            var now = clock.GetUtcNow().ToUnixTimeMilliseconds();
            foreach (var s in sites)
                c.Execute("INSERT OR IGNORE INTO sites(id, name, domain, created_at) VALUES (@Id, @Name, @domain, @now)",
                    new { s.Id, s.Name, domain = s.Domain.Trim().ToLowerInvariant(), now });
        }
    }

    public SqliteConnection Open()
    {
        var c = new SqliteConnection(_connectionString);
        c.Open();
        c.Execute("PRAGMA synchronous=NORMAL"); // safe with WAL, avoids an fsync per hit
        return c;
    }
}

/// <summary>Monthly salt (UTC month) and the visitor hash. Salts of earlier months are deleted at rotation.</summary>
public sealed class Salts(Db db, TimeProvider clock)
{
    sealed record Current(string Month, byte[] Salt);
    readonly Lock _gate = new();
    volatile Current? _current;

    byte[] ForNow()
    {
        var month = clock.GetUtcNow().ToString("yyyy-MM", CultureInfo.InvariantCulture);
        if (_current is { } c && c.Month == month) return c.Salt;
        lock (_gate)
        {
            if (_current is { } c2 && c2.Month == month) return c2.Salt;
            using var conn = db.Open();
            conn.Execute("INSERT OR IGNORE INTO salts(month, salt) VALUES (@month, @salt)", new { month, salt = RandomNumberGenerator.GetBytes(32) });
            conn.Execute("DELETE FROM salts WHERE month <> @month", new { month });
            var salt = conn.ExecuteScalar<byte[]>("SELECT salt FROM salts WHERE month = @month", new { month })!;
            _current = new Current(month, salt);
            return salt;
        }
    }

    /// <summary>First 8 bytes of SHA-256(monthSalt ‖ siteId ‖ ip ‖ userAgent) as a signed int64.</summary>
    public long Visitor(string siteId, string ip, string userAgent)
    {
        byte[] hash = SHA256.HashData([.. ForNow(), .. Encoding.UTF8.GetBytes(siteId + ip + userAgent)]);
        return BinaryPrimitives.ReadInt64BigEndian(hash);
    }
}

/// <summary>Daily job: deletes events older than 25 months.</summary>
public sealed class Retention(Db db, TimeProvider clock, ILogger<Retention> log) : BackgroundService
{
    public const int Months = 25;

    public static int Run(Db db, DateTimeOffset now)
    {
        using var c = db.Open();
        return c.Execute("DELETE FROM events WHERE ts < @cutoff", new { cutoff = now.AddMonths(-Months).ToUnixTimeMilliseconds() });
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        try
        {
            await Task.Delay(TimeSpan.FromMinutes(1), clock, ct);
            while (true)
            {
                try { log.LogInformation("Retention removed {Count} events", Run(db, clock.GetUtcNow())); }
                catch (SqliteException e) { log.LogError("Retention failed: {Code}", e.SqliteErrorCode); }
                await Task.Delay(TimeSpan.FromHours(24), clock, ct);
            }
        }
        catch (OperationCanceledException) { }
    }
}
