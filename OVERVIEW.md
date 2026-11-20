Magpie brings gateway quotas, request history, and actual model routing into Paseo. In native Usage, see account quotas and balances alongside combined quota windows for providers with multiple accounts.

Open **Magpie Usage** in the sidebar to browse gateway requests across agents. Each row shows the requested and served models, provider and account, tokens, cost, first-token latency, total time, TPS, and HTTP status. A matched source session uses its Paseo title and opens from the request row.

The **Compare** tab starts with the last seven days. Choose a served model to see request counts, first-token latency at P50 and P90, and median measured TPS by provider. The sample counts show how many completed requests supplied each measurement. Select a provider to open its request records. The comparison examines up to the 50,000 most recent gateway records in the selected period.

The trend chart switches between first-token P90 and median TPS. Today uses hourly buckets and longer ranges use daily buckets in the Paseo host's time zone. On phones, choose one provider at a time. Select a point to see sample counts and open requests for that interval.

In a Codex or Claude Code session routed through Magpie, the composer shows the provider, response bytes when available, and model while a request is active. Open the provider to inspect service tiers, fallback attempts, and time since the last content. A completed reply can also show its route if it can be matched to the gateway. Codex reply routing uses Magpie Paseo Bridge. With Bridge `v0.1.2` or newer, a completed Codex turn can show each recorded request. The setup guide is in the plugin settings.

Requires Paseo 0.16.0 or newer on the daemon and client. The plugin reads the configured Magpie gateway from the daemon. It defaults to `http://127.0.0.1:3425`. For a different gateway, configure `~/.config/paseo-magpie/config.json` on the daemon host. Remote access may require a gateway key with usage, quota, and route permissions. Credentials stay on the daemon. Request bodies, raw upstream errors, and raw trace records stay out of the client.
