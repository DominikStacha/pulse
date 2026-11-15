using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Pulse.Api;

/// <summary>
/// Validates the Cloudflare Access JWT (header Cf-Access-Jwt-Assertion): RS256, signed by a key of
/// https://TEAM.cloudflareaccess.com/cdn-cgi/access/certs (cached, refreshed on an unknown kid, at most once per cooldown),
/// iss = https://TEAM.cloudflareaccess.com, aud contains PULSE_ACCESS_AUD. Anything else, including any error: invalid.
/// </summary>
public sealed class Access
{
    readonly IHttpClientFactory _http;
    readonly TimeProvider _clock;
    readonly ILogger<Access> _log;
    readonly JsonWebTokenHandler _handler = new();
    readonly SemaphoreSlim _refreshGate = new(1, 1);
    readonly long _cooldownMs;
    volatile JsonWebKey[] _keys = [];
    long _fetchedAt; // unix ms of the last fetch attempt, 0 = never

    public string? Host { get; }
    public string? Audience { get; }
    public bool Configured => Host is not null && !string.IsNullOrEmpty(Audience);
    string Issuer => $"https://{Host}";

    public Access(IConfiguration cfg, IHttpClientFactory http, TimeProvider clock, ILogger<Access> log)
    {
        _http = http;
        _clock = clock;
        _log = log;
        // Team domain: "myteam" or "myteam.cloudflareaccess.com" (a scheme or slash is tolerated).
        var team = (cfg["PULSE_ACCESS_TEAM_DOMAIN"] ?? cfg["Pulse:Access:TeamDomain"])?.Trim().Replace("https://", "", StringComparison.OrdinalIgnoreCase).TrimEnd('/');
        Host = string.IsNullOrEmpty(team) ? null : team.Contains('.') ? team.ToLowerInvariant() : $"{team.ToLowerInvariant()}.cloudflareaccess.com";
        Audience = (cfg["PULSE_ACCESS_AUD"] ?? cfg["Pulse:Access:Aud"])?.Trim();
        _cooldownMs = (long.TryParse(cfg["Pulse:Access:JwksCooldownSeconds"], out var s) ? s : 30) * 1000;
    }

    public async Task<bool> IsValid(string? token, CancellationToken ct)
    {
        if (!Configured || string.IsNullOrWhiteSpace(token)) return false;
        try
        {
            var jwt = _handler.ReadJsonWebToken(token);
            if (jwt.Alg != SecurityAlgorithms.RsaSha256 || await FindKey(jwt.Kid, ct) is not { } key) return false;
            var result = await _handler.ValidateTokenAsync(token, new TokenValidationParameters
            {
                ValidateIssuer = true, ValidIssuer = Issuer,
                ValidateAudience = true, ValidAudience = Audience,
                ValidateLifetime = true, RequireExpirationTime = true, ClockSkew = TimeSpan.FromSeconds(60),
                RequireSignedTokens = true, ValidateIssuerSigningKey = true, IssuerSigningKey = key,
                ValidAlgorithms = [SecurityAlgorithms.RsaSha256],
            });
            return result.IsValid;
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            return false; // malformed token etc.
        }
    }

    async Task<JsonWebKey?> FindKey(string? kid, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(kid)) return null;
        if (_keys.FirstOrDefault(k => k.Kid == kid) is { } known) return known;
        await RefreshKeys(ct);
        return _keys.FirstOrDefault(k => k.Kid == kid);
    }

    async Task RefreshKeys(CancellationToken ct)
    {
        await _refreshGate.WaitAsync(ct);
        try
        {
            var now = _clock.GetUtcNow().ToUnixTimeMilliseconds();
            if (_fetchedAt != 0 && now - _fetchedAt < _cooldownMs) return; // stops unauthenticated requests from hammering Cloudflare
            _fetchedAt = now;
            using var http = _http.CreateClient("jwks");
            var json = await http.GetStringAsync($"https://{Host}/cdn-cgi/access/certs", ct);
            _keys = [.. new JsonWebKeySet(json).Keys.Where(k => k.Kty == "RSA")];
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            _log.LogWarning("Fetching the Cloudflare Access keys failed: {Type}", e.GetType().Name); // keeps the old keys; fails closed
        }
        finally { _refreshGate.Release(); }
    }
}
