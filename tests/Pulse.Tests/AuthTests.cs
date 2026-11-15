using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Pulse.Tests;

/// <summary>Stands in for https://TEAM.cloudflareaccess.com/cdn-cgi/access/certs.</summary>
sealed class FakeJwks : HttpMessageHandler
{
    public string Json { get; set; } = """{"keys":[]}""";
    public HttpStatusCode Status { get; set; } = HttpStatusCode.OK;
    public List<string> Requests { get; } = [];

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        lock (Requests) Requests.Add(request.RequestUri!.ToString());
        return Task.FromResult(new HttpResponseMessage(Status) { Content = new StringContent(Json, Encoding.UTF8, "application/json") });
    }

    public static string Document(params (RSA Key, string Kid)[] keys) => JsonSerializer.Serialize(new
    {
        keys = keys.Select(k =>
        {
            var p = k.Key.ExportParameters(false);
            return new { kty = "RSA", kid = k.Kid, use = "sig", alg = "RS256", n = Base64UrlEncoder.Encode(p.Modulus), e = Base64UrlEncoder.Encode(p.Exponent) };
        }),
        public_cert = new { kid = "x", cert = "-----BEGIN CERTIFICATE-----\n-----END CERTIFICATE-----\n" }, // Cloudflare adds these extra members
        public_certs = Array.Empty<object>(),
    });
}

public class AuthTests : IDisposable
{
    const string Team = "acme.cloudflareaccess.com";
    const string Aud = "aud-1234";
    const string Issuer = "https://acme.cloudflareaccess.com";

    readonly RSA _key = RSA.Create(2048);
    readonly RSA _other = RSA.Create(2048);
    readonly FakeJwks _jwks = new();
    readonly List<PulseFactory> _factories = [];

    public AuthTests() => _jwks.Json = FakeJwks.Document((_key, "kid-1"));

    public void Dispose()
    {
        foreach (var f in _factories) f.Dispose();
        _key.Dispose();
        _other.Dispose();
    }

    HttpClient Client(int cooldownSeconds = 0, Dictionary<string, string>? settings = null)
    {
        var f = new PulseFactory
        {
            Settings = settings ?? new()
            {
                ["PULSE_ACCESS_TEAM_DOMAIN"] = Team,
                ["PULSE_ACCESS_AUD"] = Aud,
                ["Pulse:Access:JwksCooldownSeconds"] = cooldownSeconds.ToString(),
            },
            Configure = s => s.AddHttpClient("jwks").ConfigurePrimaryHttpMessageHandler(() => _jwks),
        };
        _factories.Add(f);
        return f.CreateClient();
    }

    string Token(RSA? key = null, string kid = "kid-1", string issuer = Issuer, object? audience = null, TimeSpan? expiresIn = null, TimeSpan? notBeforeIn = null, string alg = SecurityAlgorithms.RsaSha256)
    {
        var now = DateTime.UtcNow;
        var exp = now + (expiresIn ?? TimeSpan.FromHours(1));
        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = issuer,
            Expires = exp,
            NotBefore = notBeforeIn is { } nb ? now + nb : exp - TimeSpan.FromHours(2),
            IssuedAt = now,
            SigningCredentials = new SigningCredentials(new RsaSecurityKey(key ?? _key) { KeyId = kid }, alg),
            Claims = new Dictionary<string, object> { ["aud"] = audience ?? new[] { Aud }, ["email"] = "owner@example.com", ["sub"] = "user-1" },
        };
        return new JsonWebTokenHandler().CreateToken(descriptor);
    }

    static async Task<HttpStatusCode> Get(HttpClient c, string? token, string url = "/api/sites")
    {
        var req = new HttpRequestMessage(HttpMethod.Get, url);
        if (token is not null) req.Headers.TryAddWithoutValidation("Cf-Access-Jwt-Assertion", token);
        return (await c.SendAsync(req)).StatusCode;
    }

    [Fact]
    public async Task A_valid_token_is_accepted_on_every_dashboard_endpoint()
    {
        var c = Client();
        var token = Token();
        foreach (var url in new[] { "/api/sites", "/api/stats/summary", "/api/stats/timeseries", "/api/stats/breakdown?dim=pages", "/api/live" })
            Assert.Equal(HttpStatusCode.OK, await Get(c, token, url));
        Assert.Equal(HttpStatusCode.ServiceUnavailable, await Get(c, token, "/api/status")); // authorised, the file just is not there
        Assert.Single(_jwks.Requests); // keys fetched once, then cached
        Assert.Equal("https://acme.cloudflareaccess.com/cdn-cgi/access/certs", _jwks.Requests[0]);
    }

    [Fact]
    public async Task Missing_or_empty_header_is_401_with_no_data()
    {
        var c = Client();
        Assert.Equal(HttpStatusCode.Unauthorized, await Get(c, null));
        Assert.Equal(HttpStatusCode.Unauthorized, await Get(c, ""));
        Assert.Equal(HttpStatusCode.Unauthorized, await Get(c, "   "));
        var res = await c.GetAsync("/api/sites");
        Assert.Equal("""{"error":"unauthorized"}""", await res.Content.ReadAsStringAsync());
        Assert.Empty(_jwks.Requests); // nothing to look up without a token
    }

    [Fact]
    public async Task The_other_dashboard_paths_are_protected_too_including_unknown_ones_and_case_variants()
    {
        var c = Client();
        foreach (var url in new[] { "/api/stats/summary", "/api/live/stream", "/api/status/history", "/api/nope", "/API/sites", "/api", "/api/", "/api/send/", "/api/send/../sites", "/api/%73ites" })
            Assert.Equal(HttpStatusCode.Unauthorized, await Get(c, null, url));
        Assert.Equal(HttpStatusCode.Unauthorized, (await c.PostAsync("/api/sites", new StringContent("{}", Encoding.UTF8, "application/json"))).StatusCode);
    }

    [Fact]
    public async Task Wrong_audience_is_401()
    {
        var c = Client();
        Assert.Equal(HttpStatusCode.Unauthorized, await Get(c, Token(audience: new[] { "someone-else" })));
        Assert.Equal(HttpStatusCode.Unauthorized, await Get(c, Token(audience: "someone-else")));
    }

    [Fact]
    public async Task An_audience_list_that_contains_ours_is_accepted()
    {
        var c = Client();
        Assert.Equal(HttpStatusCode.OK, await Get(c, Token(audience: new[] { "other", Aud })));
        Assert.Equal(HttpStatusCode.OK, await Get(c, Token(audience: Aud))); // a plain string works as well
    }

    [Fact]
    public async Task Wrong_issuer_is_401()
    {
        var c = Client();
        Assert.Equal(HttpStatusCode.Unauthorized, await Get(c, Token(issuer: "https://evil.cloudflareaccess.com")));
        Assert.Equal(HttpStatusCode.Unauthorized, await Get(c, Token(issuer: Issuer + "/")));
        Assert.Equal(HttpStatusCode.Unauthorized, await Get(c, Token(issuer: "http://acme.cloudflareaccess.com")));
    }

    [Fact]
    public async Task Expired_and_not_yet_valid_tokens_are_401()
    {
        var c = Client();
        Assert.Equal(HttpStatusCode.Unauthorized, await Get(c, Token(expiresIn: TimeSpan.FromMinutes(-10))));
        Assert.Equal(HttpStatusCode.Unauthorized, await Get(c, Token(notBeforeIn: TimeSpan.FromMinutes(10))));
        Assert.Equal(HttpStatusCode.OK, await Get(c, Token(expiresIn: TimeSpan.FromSeconds(-10)))); // inside the 60 s clock-skew allowance
    }

    [Fact]
    public async Task A_token_without_exp_is_401()
    {
        var c = Client();
        var handler = new JsonWebTokenHandler();
        var token = handler.CreateToken($$"""{"iss":"{{Issuer}}","aud":["{{Aud}}"]}""", new SigningCredentials(new RsaSecurityKey(_key) { KeyId = "kid-1" }, SecurityAlgorithms.RsaSha256));
        Assert.Equal(HttpStatusCode.Unauthorized, await Get(c, token));
    }

    [Fact]
    public async Task Unknown_kid_is_401_after_one_refresh_attempt()
    {
        var c = Client();
        Assert.Equal(HttpStatusCode.Unauthorized, await Get(c, Token(kid: "kid-unknown")));
        Assert.Single(_jwks.Requests);
    }

    [Fact]
    public async Task A_token_without_kid_is_401()
    {
        var c = Client();
        var token = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = Issuer, Audience = Aud, Expires = DateTime.UtcNow.AddHours(1),
            SigningCredentials = new SigningCredentials(new RsaSecurityKey(_key), SecurityAlgorithms.RsaSha256), // no KeyId
        });
        Assert.Equal(HttpStatusCode.Unauthorized, await Get(c, token));
    }

    [Fact]
    public async Task A_known_kid_with_a_signature_from_another_key_is_401()
    {
        var c = Client();
        Assert.Equal(HttpStatusCode.Unauthorized, await Get(c, Token(key: _other, kid: "kid-1")));
    }

    [Fact]
    public async Task Tampered_tokens_are_401()
    {
        var c = Client();
        var parts = Token().Split('.');
        var claims = Encoding.UTF8.GetString(Base64UrlEncoder.DecodeBytes(parts[1]));
        var forged = Base64UrlEncoder.Encode(claims.Replace("user-1", "admin"));
        Assert.Equal(HttpStatusCode.Unauthorized, await Get(c, $"{parts[0]}.{forged}.{parts[2]}"));
        Assert.Equal(HttpStatusCode.Unauthorized, await Get(c, $"{parts[0]}.{parts[1]}."));
        Assert.Equal(HttpStatusCode.Unauthorized, await Get(c, $"{parts[0]}.{parts[1]}"));
    }

    [Fact]
    public async Task Garbage_none_and_HS256_confusion_tokens_are_401()
    {
        var c = Client();
        Assert.Equal(HttpStatusCode.Unauthorized, await Get(c, "not-a-jwt"));
        Assert.Equal(HttpStatusCode.Unauthorized, await Get(c, "a.b.c"));
        Assert.Equal(HttpStatusCode.Unauthorized, await Get(c, new string('x', 5000)));

        // alg=none, claims otherwise perfect
        var header = Base64UrlEncoder.Encode("""{"alg":"none","typ":"JWT","kid":"kid-1"}""");
        var exp = DateTimeOffset.UtcNow.AddHours(1).ToUnixTimeSeconds();
        var body = Base64UrlEncoder.Encode($$"""{"iss":"{{Issuer}}","aud":["{{Aud}}"],"exp":{{exp}}}""");
        Assert.Equal(HttpStatusCode.Unauthorized, await Get(c, $"{header}.{body}."));

        // HS256 signed with the public key as the HMAC secret (classic algorithm confusion)
        var hmacKey = new SymmetricSecurityKey(_key.ExportSubjectPublicKeyInfo()) { KeyId = "kid-1" };
        var hs = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = Issuer, Audience = Aud, Expires = DateTime.UtcNow.AddHours(1),
            SigningCredentials = new SigningCredentials(hmacKey, SecurityAlgorithms.HmacSha256),
        });
        Assert.Equal(HttpStatusCode.Unauthorized, await Get(c, hs));
    }

    [Fact]
    public async Task Keys_are_refreshed_for_an_unknown_kid_so_rotation_works()
    {
        var c = Client(cooldownSeconds: 0);
        Assert.Equal(HttpStatusCode.OK, await Get(c, Token()));
        Assert.Single(_jwks.Requests);

        var rotated = RSA.Create(2048);
        using var _ = rotated;
        _jwks.Json = FakeJwks.Document((_key, "kid-1"), (rotated, "kid-2"));
        Assert.Equal(HttpStatusCode.OK, await Get(c, Token(key: rotated, kid: "kid-2")));
        Assert.Equal(2, _jwks.Requests.Count);
        Assert.Equal(HttpStatusCode.OK, await Get(c, Token(key: rotated, kid: "kid-2"))); // now cached
        Assert.Equal(HttpStatusCode.OK, await Get(c, Token())); // the old key still works
        Assert.Equal(2, _jwks.Requests.Count);
    }

    [Fact]
    public async Task Unknown_kids_cannot_make_the_server_hammer_Cloudflare()
    {
        var c = Client(cooldownSeconds: 30);
        for (var i = 0; i < 10; i++) Assert.Equal(HttpStatusCode.Unauthorized, await Get(c, Token(kid: "random-" + i)));
        Assert.Single(_jwks.Requests); // one fetch, the rest hit the cooldown
        Assert.Equal(HttpStatusCode.OK, await Get(c, Token())); // known keys keep working
    }

    [Fact]
    public async Task When_the_key_endpoint_is_down_nothing_gets_in()
    {
        _jwks.Status = HttpStatusCode.InternalServerError;
        _jwks.Json = "oops";
        var c = Client();
        Assert.Equal(HttpStatusCode.Unauthorized, await Get(c, Token()));
        _jwks.Status = HttpStatusCode.OK;
        _jwks.Json = "{ not json";
        Assert.Equal(HttpStatusCode.Unauthorized, await Get(c, Token()));
        _jwks.Json = FakeJwks.Document((_key, "kid-1"));
        Assert.Equal(HttpStatusCode.OK, await Get(c, Token())); // recovers by itself
    }

    [Fact]
    public async Task Keys_that_stay_cached_keep_working_when_the_endpoint_goes_down()
    {
        var c = Client();
        Assert.Equal(HttpStatusCode.OK, await Get(c, Token()));
        _jwks.Status = HttpStatusCode.ServiceUnavailable;
        Assert.Equal(HttpStatusCode.OK, await Get(c, Token()));
    }

    [Theory]
    [InlineData("acme")]
    [InlineData("acme.cloudflareaccess.com")]
    [InlineData("https://acme.cloudflareaccess.com")]
    [InlineData("https://acme.cloudflareaccess.com/")]
    [InlineData("ACME.cloudflareaccess.com")]
    public async Task The_team_domain_can_be_given_in_several_spellings(string team)
    {
        var c = Client(settings: new() { ["PULSE_ACCESS_TEAM_DOMAIN"] = team, ["PULSE_ACCESS_AUD"] = Aud, ["Pulse:Access:JwksCooldownSeconds"] = "0" });
        Assert.Equal(HttpStatusCode.OK, await Get(c, Token()));
        Assert.Equal("https://acme.cloudflareaccess.com/cdn-cgi/access/certs", _jwks.Requests[0]);
    }

    [Fact]
    public async Task Config_can_also_come_from_the_Pulse_Access_section()
    {
        var c = Client(settings: new() { ["Pulse:Access:TeamDomain"] = Team, ["Pulse:Access:Aud"] = Aud, ["Pulse:Access:JwksCooldownSeconds"] = "0" });
        Assert.Equal(HttpStatusCode.OK, await Get(c, Token()));
    }

    [Fact]
    public async Task Public_endpoints_need_no_token()
    {
        var c = Client();
        var health = await c.GetAsync("/healthz");
        Assert.Equal(HttpStatusCode.OK, health.StatusCode);
        Assert.Equal("ok", await health.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.OK, (await c.GetAsync("/script.js")).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await c.SendAsync(new HttpRequestMessage(HttpMethod.Options, "/api/send"))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await c.Send(TestExtensions.Pageview())).StatusCode);
        // Routing is case-insensitive, so the exemption must be too: reaches the handler (400 for the empty body), not the Access check.
        Assert.Equal(HttpStatusCode.BadRequest, (await c.SendAsync(new HttpRequestMessage(HttpMethod.Post, "/API/Send") { Content = new StringContent("{}") })).StatusCode);
    }

    [Fact]
    public async Task The_dashboard_API_responses_are_not_cacheable()
    {
        var c = Client();
        var req = new HttpRequestMessage(HttpMethod.Get, "/api/sites");
        req.Headers.TryAddWithoutValidation("Cf-Access-Jwt-Assertion", Token());
        var res = await c.SendAsync(req);
        Assert.Contains("no-store", res.Headers.CacheControl!.ToString());
    }

    // ---- startup rules ----

    [Fact]
    public void In_Production_missing_Access_config_refuses_to_start_even_with_Auth_Disabled()
    {
        foreach (var settings in new Dictionary<string, string>[]
                 {
                     new() { ["Pulse:Auth:Disabled"] = "true" },
                     new(),
                     new() { ["PULSE_ACCESS_TEAM_DOMAIN"] = Team }, // aud missing
                     new() { ["PULSE_ACCESS_AUD"] = Aud }, // team missing
                     new() { ["PULSE_ACCESS_TEAM_DOMAIN"] = "", ["PULSE_ACCESS_AUD"] = "", ["Pulse:Auth:Disabled"] = "true" },
                 })
        {
            using var f = new PulseFactory { Environment = "Production", Settings = settings };
            var e = Assert.ThrowsAny<Exception>(() => f.CreateClient());
            Assert.Contains("refusing to start", e.ToString());
        }
    }

    [Fact]
    public async Task Auth_Disabled_is_ignored_in_Production_when_Access_is_configured()
    {
        using var f = new PulseFactory
        {
            Environment = "Production",
            Settings = new() { ["Pulse:Auth:Disabled"] = "true", ["PULSE_ACCESS_TEAM_DOMAIN"] = Team, ["PULSE_ACCESS_AUD"] = Aud },
            Configure = s => s.AddHttpClient("jwks").ConfigurePrimaryHttpMessageHandler(() => _jwks),
        };
        var c = f.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, await Get(c, null));
        Assert.Equal(HttpStatusCode.Unauthorized, await Get(c, Token(audience: "wrong")));
        Assert.Equal(HttpStatusCode.OK, await Get(c, Token()));
    }

    [Fact]
    public async Task Auth_Disabled_works_in_Development_only()
    {
        using var open = new PulseFactory(); // default: Development + Disabled
        Assert.Equal(HttpStatusCode.OK, await Get(open.CreateClient(), null));

        using var staging = new PulseFactory { Environment = "Staging", Settings = new() { ["Pulse:Auth:Disabled"] = "true" } };
        Assert.ThrowsAny<Exception>(() => staging.CreateClient()); // not Development: needs real Access config
    }

    [Fact]
    public async Task Development_without_Disabled_and_without_config_is_closed_not_open()
    {
        using var f = new PulseFactory { Settings = new() };
        var c = f.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, await Get(c, null));
        Assert.Equal(HttpStatusCode.Unauthorized, await Get(c, Token()));
        Assert.Equal(HttpStatusCode.OK, (await c.GetAsync("/healthz")).StatusCode);
    }

    [Fact]
    public async Task The_Authorization_header_alone_does_not_grant_access()
    {
        var c = Client();
        var req = new HttpRequestMessage(HttpMethod.Get, "/api/sites");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token());
        Assert.Equal(HttpStatusCode.Unauthorized, (await c.SendAsync(req)).StatusCode);
    }
}
