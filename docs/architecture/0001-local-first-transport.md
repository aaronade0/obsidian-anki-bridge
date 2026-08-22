# ADR 0001: Local-first transport with a bridge-compatible boundary

## Status

Accepted for the 0.1 development preview.

## Decision

The first transport talks to a local AnkiConnect endpoint. Parsing,
registration, rendering, and reconciliation do not depend on AnkiConnect.
They emit transport-neutral desired notes. A later HTTPS bridge can implement
the same interface and forward those notes to a headless Anki client.

## Consequences

- Windows desktop can be tested quickly with Anki running locally.
- Mobile support remains a later transport addition.
- The official Anki sync server is not treated as a card CRUD API.
- No AnkiWeb credentials are stored in the Obsidian plugin.
