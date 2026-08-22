# Security policy

## Reporting

Do not open a public issue for vulnerabilities that could expose AnkiConnect,
vault content, media, API keys, or remote-bridge credentials. Use
**Security → Report a vulnerability** in this GitHub repository so the report
stays private until a coordinated disclosure is ready.

## Current boundary

The current release is desktop-only and expects AnkiConnect on loopback. If an
API key is configured, it is stored in Obsidian's plugin data. Do not expose
AnkiConnect directly to an untrusted network.

The future remote bridge is not implemented yet. It must not reuse the local
trust model; it requires authenticated HTTPS and server-side authorization.
