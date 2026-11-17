Magpie Usage displays account quotas and balances from your Magpie gateway in Paseo's native Usage entry. Providers with multiple accounts also get a total card. Comparable percentage windows are averaged within one plan; reported amounts and limits are added. Individual accounts remain available, while summary windows are preferred for the sidebar.

The plugin runs on the Paseo daemon and reads Magpie's `/v1/magpie/quotas` endpoint. It uses `http://127.0.0.1:3425` by default. Magpie must be running on that host, or you can configure a different gateway address in the daemon machine's `~/.config/paseo-magpie/config.json`. A remote gateway may require an API key with permission to read quotas.

Requires Paseo 0.16.0 or later on both the daemon and the app. The plugin supplies account-wide quotas to global Usage. A routing group can use several accounts, so these quotas are not attached to individual agent sessions.

Read times remain visible, including when Magpie returns an older reading with an error. Refresh follows Magpie's own provider cache. The plugin reads quota information and does not modify gateway configuration or account credentials. Configuration and credentials stay on the daemon machine.

Total cards show how many accounts contribute. Failed readings and expired fallback windows are excluded. Reset times on totals indicate the earliest contributing account's renewal. Pins from older versions remain selected until you change them in Usage.
