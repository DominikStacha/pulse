using System.Net;
using System.Text.Json;
using Pulse.Api;

namespace Pulse.Tests;

public class PeriodTests
{
    static readonly TimeZoneInfo Prague = TimeZoneInfo.FindSystemTimeZoneById("Europe/Prague");

    static DateTimeOffset Utc(int y, int mo, int d, int h = 0, int mi = 0, int s = 0) => new(y, mo, d, h, mi, s, TimeSpan.Zero);

    static Window Resolve(string period, DateTimeOffset now, TimeZoneInfo? tz = null) => Periods.Resolve(period, tz ?? Prague, now)!;

    static string[] Labels(Window w, long[]? starts = null) => [.. (starts ?? w.Starts).Select(s => Iso.Local(s, w.Tz))];

    static TimeSpan Length(long[] starts, int i) => TimeSpan.FromMilliseconds(starts[i + 1] - starts[i]);

    [Theory]
    [InlineData("today")]
    [InlineData("24h")]
    [InlineData("7d")]
    [InlineData("30d")]
    [InlineData("90d")]
    [InlineData("12m")]
    public void Every_period_has_an_equally_long_previous_window_right_before(string period)
    {
        var w = Resolve(period, Utc(2026, 11, 14, 12, 20));
        Assert.Equal(w.Starts.Length, w.PrevStarts.Length);
        Assert.Equal(w.From, w.PrevStarts[^1]); // previous ends where current begins
        Assert.Equal(w.From, w.PrevTo);
        Assert.Equal(w.PrevStarts[0], w.PrevFrom);
        Assert.Equal(Utc(2026, 11, 14, 12, 20).ToUnixTimeMilliseconds() + 1, w.To);
        Assert.Equal(w.Starts.OrderBy(x => x), w.Starts);
        Assert.Equal(w.PrevStarts.OrderBy(x => x), w.PrevStarts);
        Assert.True(w.Starts[^1] > w.NowMs, "the last bucket contains now");
        Assert.True(w.Starts[^2] <= w.NowMs);
    }

    [Theory]
    [InlineData("24h", 24, Bucket.Hour)]
    [InlineData("7d", 7, Bucket.Day)]
    [InlineData("30d", 30, Bucket.Day)]
    [InlineData("90d", 90, Bucket.Day)]
    [InlineData("12m", 12, Bucket.Month)]
    public void Bucket_counts_and_kinds(string period, int count, Bucket bucket)
    {
        var w = Resolve(period, Utc(2026, 11, 14, 12, 20));
        Assert.Equal(count, w.Starts.Length - 1);
        Assert.Equal(bucket, w.Bucket);
    }

    [Theory]
    [InlineData("")]
    [InlineData("1d")]
    [InlineData("TODAY")]
    [InlineData("7D")]
    [InlineData("14d")]
    [InlineData("1y")]
    public void Unknown_periods_are_null(string period) => Assert.Null(Periods.Resolve(period, Prague, Utc(2026, 11, 14)));

    [Fact]
    public void Seven_days_across_the_spring_DST_switch_has_a_23_hour_day()
    {
        var w = Resolve("7d", Utc(2026, 3, 30, 10)); // 12:00 CEST on Monday 30 March
        Assert.Equal(
            ["2026-03-24T00:00:00+01:00", "2026-03-25T00:00:00+01:00", "2026-03-26T00:00:00+01:00", "2026-03-27T00:00:00+01:00", "2026-03-28T00:00:00+01:00",
             "2026-03-29T00:00:00+01:00", "2026-03-30T00:00:00+02:00", "2026-03-31T00:00:00+02:00"], Labels(w));
        Assert.Equal(TimeSpan.FromHours(24), Length(w.Starts, 4)); // 28 March
        Assert.Equal(TimeSpan.FromHours(23), Length(w.Starts, 5)); // Sunday 29 March: clocks jump 02:00 -> 03:00
        Assert.Equal(TimeSpan.FromHours(24), Length(w.Starts, 6));
    }

    [Fact]
    public void Seven_days_across_the_autumn_DST_switch_has_a_25_hour_day()
    {
        var w = Resolve("7d", Utc(2026, 10, 26, 10)); // 11:00 CET on Monday 26 October
        Assert.Equal("2026-10-25T00:00:00+02:00", Labels(w)[5]);
        Assert.Equal("2026-10-26T00:00:00+01:00", Labels(w)[6]);
        Assert.Equal(TimeSpan.FromHours(25), Length(w.Starts, 5)); // Sunday 25 October: 02:00 happens twice
        Assert.Equal(TimeSpan.FromHours(24), Length(w.Starts, 4));
    }

    [Fact]
    public void Previous_window_of_a_day_period_is_on_the_local_calendar_across_DST()
    {
        var w = Resolve("7d", Utc(2026, 3, 30, 10));
        Assert.Equal("2026-03-17T00:00:00+01:00", Labels(w, w.PrevStarts)[0]);
        Assert.Equal("2026-03-24T00:00:00+01:00", Labels(w, w.PrevStarts)[7]);
        Assert.Equal(TimeSpan.FromHours(24), Length(w.PrevStarts, 0));

        var back = Resolve("7d", Utc(2026, 11, 1, 10)); // previous reaches back over the 25-hour day of 25 October
        Assert.Equal("2026-10-19T00:00:00+02:00", Labels(back, back.PrevStarts)[0]);
        Assert.Equal(TimeSpan.FromHours(25), Length(back.PrevStarts, 6));
    }

    [Fact]
    public void Today_on_the_spring_switch_day_skips_the_missing_hour()
    {
        var w = Resolve("today", Utc(2026, 3, 29, 10, 30)); // 12:30 CEST
        Assert.Equal(Bucket.Hour, w.Bucket);
        var labels = Labels(w);
        Assert.Equal(13, labels.Length); // 12 buckets: 00, 01, 03, 04 ... 12
        Assert.Equal(["2026-03-29T00:00:00+01:00", "2026-03-29T01:00:00+01:00", "2026-03-29T03:00:00+02:00", "2026-03-29T04:00:00+02:00"], labels[..4]);
        Assert.Equal("2026-03-29T12:00:00+02:00", labels[11]);
        Assert.Equal("2026-03-29T13:00:00+02:00", labels[12]);
        Assert.All(Enumerable.Range(0, 12), i => Assert.Equal(TimeSpan.FromHours(1), Length(w.Starts, i)));
    }

    [Fact]
    public void Today_on_the_autumn_switch_day_has_the_02_hour_twice()
    {
        var w = Resolve("today", Utc(2026, 10, 25, 11, 20)); // 12:20 CET
        var labels = Labels(w);
        Assert.Equal(15, labels.Length); // 14 buckets
        Assert.Equal("2026-10-25T01:00:00+02:00", labels[1]);
        Assert.Equal("2026-10-25T02:00:00+02:00", labels[2]);
        Assert.Equal("2026-10-25T02:00:00+01:00", labels[3]);
        Assert.Equal("2026-10-25T03:00:00+01:00", labels[4]);
        Assert.Equal("2026-10-25T12:00:00+01:00", labels[13]);
    }

    [Fact]
    public void Today_just_after_midnight_is_one_bucket()
    {
        var w = Resolve("today", Utc(2026, 11, 13, 23, 5)); // 00:05 CET on the 14th
        Assert.Single(w.Starts.Take(w.Starts.Length - 1));
        Assert.Equal("2026-11-14T00:00:00+01:00", Labels(w)[0]);
    }

    [Fact]
    public void Twenty_four_hours_are_hour_aligned_ending_with_the_current_hour()
    {
        var w = Resolve("24h", Utc(2026, 11, 14, 12, 20)); // 13:20 CET
        var labels = Labels(w);
        Assert.Equal("2026-11-13T14:00:00+01:00", labels[0]);
        Assert.Equal("2026-11-14T13:00:00+01:00", labels[23]);
        Assert.Equal("2026-11-14T14:00:00+01:00", labels[24]);
        Assert.Equal("2026-11-12T14:00:00+01:00", Labels(w, w.PrevStarts)[0]);
    }

    [Fact]
    public void Twelve_months_are_calendar_months_including_the_current_one()
    {
        var w = Resolve("12m", Utc(2026, 11, 14, 12));
        var labels = Labels(w);
        Assert.Equal(13, labels.Length);
        Assert.Equal("2025-12-01T00:00:00+01:00", labels[0]);
        Assert.Equal("2026-03-01T00:00:00+01:00", labels[3]);
        Assert.Equal("2026-04-01T00:00:00+02:00", labels[4]); // offset follows DST
        Assert.Equal("2026-11-01T00:00:00+01:00", labels[11]);
        Assert.Equal("2026-12-01T00:00:00+01:00", labels[12]);
        Assert.Equal("2024-12-01T00:00:00+01:00", Labels(w, w.PrevStarts)[0]);
        Assert.Equal(TimeSpan.FromHours(31 * 24 - 1), Length(w.Starts, 3)); // March 2026 lost an hour
        Assert.Equal(TimeSpan.FromHours(31 * 24 + 1), Length(w.Starts, 10)); // October 2026 gained one
    }

    [Fact]
    public void Twelve_months_on_the_31st_still_start_on_the_first()
    {
        var w = Resolve("12m", Utc(2026, 3, 31, 10));
        Assert.Equal("2025-04-01T00:00:00+02:00", Labels(w)[0]);
        Assert.Equal("2026-03-01T00:00:00+01:00", Labels(w)[11]);
    }

    [Fact]
    public void Ninety_days_start_where_the_calendar_says()
    {
        var w = Resolve("90d", Utc(2026, 11, 14, 12));
        Assert.Equal(91, w.Starts.Length);
        Assert.Equal("2026-08-17T00:00:00+02:00", Labels(w)[0]);
        Assert.Equal("2026-11-14T00:00:00+01:00", Labels(w)[89]);
    }

    [Fact]
    public void Other_time_zones_work_too()
    {
        Assert.Equal("2026-11-14T00:00:00+00:00", Labels(Resolve("7d", Utc(2026, 11, 14, 12), TimeZoneInfo.Utc))[6]);

        var ny = TimeZoneInfo.FindSystemTimeZoneById("America/New_York");
        var w = Resolve("7d", Utc(2026, 3, 10, 12), ny); // after the US switch on 8 March
        Assert.Equal("2026-03-08T00:00:00-05:00", Labels(w)[4]);
        Assert.Equal("2026-03-09T00:00:00-04:00", Labels(w)[5]);
        Assert.Equal(TimeSpan.FromHours(23), Length(w.Starts, 4));

        var kolkata = TimeZoneInfo.FindSystemTimeZoneById("Asia/Kolkata"); // half-hour offset: buckets still start on the local hour
        Assert.Equal("2026-11-13T18:00:00+05:30", Labels(Resolve("24h", Utc(2026, 11, 14, 12, 20), kolkata))[0]);
    }

    // ---- the same math through the HTTP API ----

    sealed class Series { public string T { get; set; } = ""; public long Visitors { get; set; } public long Visits { get; set; } public long Pageviews { get; set; } }

    static async Task<(string[] Labels, long[] Pageviews, long[] PrevPageviews, JsonElement Json)> Timeseries(HttpClient c, string query)
    {
        var json = await c.Json("/api/stats/timeseries?" + query);
        var points = json.GetProperty("points").EnumerateArray().ToArray();
        return ([.. points.Select(p => p.GetProperty("t").GetString()!)],
            [.. points.Select(p => p.GetProperty("pageviews").GetInt64())],
            [.. json.GetProperty("previous").EnumerateArray().Select(p => p.GetProperty("pageviews").GetInt64())], json);
    }

    [Fact]
    public async Task Daily_buckets_put_events_on_the_right_local_day_around_the_spring_switch()
    {
        using var f = new PulseFactory();
        f.Clock.Set(Utc(2026, 3, 30, 10));
        var c = f.CreateClient();
        long v = 1;
        void Add(DateTimeOffset at) => f.Db.Add(Ids.Stacha, at, v, v++);
        Add(Utc(2026, 3, 23, 22, 59, 59)); // 23:59:59 CET on the 23rd: previous window
        Add(Utc(2026, 3, 23, 23, 0, 0)); // exactly local midnight of the 24th: first current bucket
        Add(Utc(2026, 3, 28, 22, 30)); // 23:30 CET, 28th
        Add(Utc(2026, 3, 28, 23, 30)); // 00:30 CET, 29th
        Add(Utc(2026, 3, 29, 21, 30)); // 23:30 CEST, 29th (a naive +01:00 day would call this the 30th)
        Add(Utc(2026, 3, 29, 22, 30)); // 00:30 CEST, 30th
        Add(Utc(2026, 3, 30, 9, 59)); // 11:59 CEST, 30th
        Add(Utc(2026, 3, 30, 11, 0)); // after "now": not counted

        var (labels, pv, prev, json) = await Timeseries(c, "period=7d");
        Assert.Equal("day", json.GetProperty("bucket").GetString());
        Assert.Equal(7, labels.Length);
        Assert.Equal("2026-03-29T00:00:00+01:00", labels[5]);
        Assert.Equal("2026-03-30T00:00:00+02:00", labels[6]);
        Assert.Equal([1, 0, 0, 0, 1, 2, 2], pv);
        Assert.Equal([0, 0, 0, 0, 0, 0, 1], prev);
    }

    [Fact]
    public async Task Daily_buckets_around_the_autumn_switch()
    {
        using var f = new PulseFactory();
        f.Clock.Set(Utc(2026, 10, 26, 10));
        var c = f.CreateClient();
        long v = 1;
        void Add(DateTimeOffset at) => f.Db.Add(Ids.Stacha, at, v, v++);
        Add(Utc(2026, 10, 24, 21, 59)); // 23:59 CEST on the 24th
        Add(Utc(2026, 10, 24, 22, 0)); // 00:00 CEST on the 25th (start of the 25-hour day)
        Add(Utc(2026, 10, 25, 22, 59)); // 23:59 CET on the 25th: still the 25th
        Add(Utc(2026, 10, 25, 23, 0)); // 00:00 CET on the 26th

        var (labels, pv, _, _) = await Timeseries(c, "period=7d");
        Assert.Equal("2026-10-25T00:00:00+02:00", labels[5]);
        Assert.Equal("2026-10-26T00:00:00+01:00", labels[6]);
        Assert.Equal([0, 0, 0, 0, 1, 2, 1], pv);
    }

    [Fact]
    public async Task Today_hourly_buckets_on_the_switch_day()
    {
        using var f = new PulseFactory();
        f.Clock.Set(Utc(2026, 3, 29, 10, 30)); // 12:30 CEST
        var c = f.CreateClient();
        long v = 1;
        void Add(DateTimeOffset at) => f.Db.Add(Ids.Stacha, at, v, v++);
        Add(Utc(2026, 3, 28, 22, 59)); // 23:59 CET yesterday: previous
        Add(Utc(2026, 3, 29, 0, 30)); // 01:30 CET
        Add(Utc(2026, 3, 29, 1, 10)); // 03:10 CEST (02:xx does not exist)
        Add(Utc(2026, 3, 29, 10, 10)); // 12:10 CEST

        var (labels, pv, prev, json) = await Timeseries(c, "period=today");
        Assert.Equal("hour", json.GetProperty("bucket").GetString());
        Assert.Equal(12, labels.Length);
        Assert.Equal(12, prev.Length);
        Assert.Equal(["2026-03-29T00:00:00+01:00", "2026-03-29T01:00:00+01:00", "2026-03-29T03:00:00+02:00"], labels[..3]);
        Assert.Equal([0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1], pv);
        Assert.Equal(1, prev[^1]);
    }

    [Fact]
    public async Task Monthly_buckets_follow_local_month_boundaries()
    {
        using var f = new PulseFactory();
        var c = f.CreateClient();
        long v = 1;
        void Add(DateTimeOffset at) => f.Db.Add(Ids.Stacha, at, v, v++);
        Add(Utc(2026, 3, 31, 21, 30)); // 23:30 CEST: March
        Add(Utc(2026, 3, 31, 22, 30)); // 00:30 CEST on 1 April
        Add(Utc(2026, 10, 31, 22, 30)); // 23:30 CET: October
        Add(Utc(2026, 10, 31, 23, 30)); // 00:30 CET on 1 November
        Add(Utc(2026, 11, 14, 11, 59)); // November

        var (labels, pv, _, json) = await Timeseries(c, "period=12m");
        Assert.Equal("month", json.GetProperty("bucket").GetString());
        Assert.Equal(12, labels.Length);
        Assert.Equal("2025-12-01T00:00:00+01:00", labels[0]);
        Assert.Equal("2026-11-01T00:00:00+01:00", labels[11]);
        Assert.Equal(1, pv[3]); // March
        Assert.Equal(1, pv[4]); // April
        Assert.Equal(1, pv[10]); // October
        Assert.Equal(2, pv[11]); // November: the one after the local boundary plus the one on the 14th
    }

    [Fact]
    public async Task The_tz_parameter_changes_the_bucketing_and_bad_values_are_400()
    {
        using var f = new PulseFactory();
        var c = f.CreateClient();
        f.Db.Add(Ids.Stacha, Utc(2026, 11, 14, 0, 30), 1, 1); // 01:30 Prague, 00:30 UTC, 19:30 the day before in New York
        Assert.Equal(1, (await Timeseries(c, "period=7d&tz=Europe/Prague")).Pageviews[6]);
        Assert.Equal(1, (await Timeseries(c, "period=7d&tz=UTC")).Pageviews[6]);
        var ny = await Timeseries(c, "period=7d&tz=America/New_York");
        Assert.Equal(1, ny.Pageviews[5]);
        Assert.Equal("America/New_York", (await c.Json("/api/stats/summary?period=7d&tz=America/New_York")).GetProperty("range").GetProperty("tz").GetString());

        foreach (var bad in new[] { "Mars/Olympus", "../../etc/passwd", "Europe/../Prague", "x y", "Europe%2FPrague%00", new string('a', 100) })
            Assert.Equal(HttpStatusCode.BadRequest, (await c.GetAsync("/api/stats/summary?tz=" + Uri.EscapeDataString(bad))).StatusCode);
    }

    [Fact]
    public async Task Bad_period_dim_or_site_are_rejected()
    {
        using var f = new PulseFactory();
        var c = f.CreateClient();
        Assert.Equal(HttpStatusCode.BadRequest, (await c.GetAsync("/api/stats/summary?period=1y")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await c.GetAsync("/api/stats/timeseries?period=")).StatusCode); // empty = the default, 7d
        Assert.Equal(HttpStatusCode.BadRequest, (await c.GetAsync("/api/stats/breakdown?dim=nope")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await c.GetAsync("/api/stats/breakdown")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await c.GetAsync("/api/stats/summary?site=00000000-0000-0000-0000-000000000000")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await c.GetAsync("/api/stats/summary?site=all")).StatusCode);
    }
}
