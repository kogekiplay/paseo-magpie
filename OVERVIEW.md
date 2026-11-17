Magpie displays gateway account quotas and balances in Paseo's native Usage entry, and the current session's actual model routing beside the composer. Providers with multiple accounts also get a total card. Comparable percentage windows are averaged within one plan; reported amounts and limits are added. Individual accounts remain available, while summary windows are preferred for the sidebar.

The plugin runs on the Paseo daemon and reads Magpie's `/v1/magpie/quotas` and `/v1/magpie/route` endpoints. It uses `http://127.0.0.1:3425` by default. Magpie must be running on that host, or you can configure a different gateway address in the daemon machine's `~/.config/paseo-magpie/config.json`. A remote gateway may require an API key with permission to read quotas and session routes.

Requires Paseo 0.16.0 or later on both the daemon and the app. The plugin supplies account-wide quotas to global Usage. A routing group can use several accounts, so these quotas are not attached to individual agent sessions.

Session routing supports Codex and Claude Code when their requests go through Magpie. It resolves the native provider session through Paseo's SDK and sends that ID only to the configured gateway. The composer button shows the actual attempted model; its details include the requested and response models, reasoning effort, service tier, fallback attempts and reported latency. Auxiliary requests are labeled. Missing telemetry stays unknown. A visible composer and its open details share one cancellable subscription; failures clear old results and retry.

Routing requires a Magpie version with the session route endpoint. It reports the session's latest retained request, which may predate the current turn. Older requests can disappear from the gateway's limited trace. The endpoint does not identify the account used, and sessions without a retained request show a waiting state.

Read times remain visible, including when Magpie returns an older reading with an error. Refresh follows Magpie's own provider cache. The plugin reads information and does not modify gateway configuration or account credentials. Configuration and credentials stay on the daemon machine. Native session IDs are not logged or persisted by this plugin, and raw upstream error messages are withheld from the client.

Total cards show how many accounts contribute. Failed readings and expired fallback windows are excluded. Reset times on totals indicate the earliest contributing account's renewal. Pins from older versions remain selected until you change them in Usage.
