# Security policy

## Reporting

Do not open a public issue for vulnerabilities that could expose AnkiConnect,
vault content, media, API keys, or remote-bridge credentials. Use
**Security → Report a vulnerability** in this GitHub repository so the report
stays private until a coordinated disclosure is ready.

## Current boundary

Desktop synchronization expects AnkiConnect on loopback by default. If an API
key is configured, it is stored in Obsidian's plugin data. Do not expose
AnkiConnect directly to an untrusted network. The plugin contains no telemetry,
ads, hosted service, or AnkiWeb credentials.

On mobile, the plugin never contacts AnkiConnect. It writes schema-validated,
device-separated events to the current vault. Desktop revalidates ownership and
missing state before applying them through local AnkiConnect. Rich media is
read only from the current vault and transferred to Anki by that local API.
