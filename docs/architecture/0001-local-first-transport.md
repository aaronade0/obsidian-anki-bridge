# ADR 0001: Local-first transport with a bridge-compatible boundary

## Status

Accepted and extended with the serverless mobile outbox in 0.4.

## Decision

The Anki transport talks to a local AnkiConnect endpoint on desktop. Mobile
devices journal source changes into the synchronized plugin directory instead
of contacting Anki. Desktop Obsidian later parses the synchronized source and
applies it through the same local transport.

## Consequences

- Windows desktop can be tested quickly with Anki running locally.
- Mobile creation and editing require no server or mobile Anki API.
- Desktop Obsidian and Anki must run before queued mobile changes reach Anki.
- The official Anki sync server is not treated as a card CRUD API.
- No AnkiWeb credentials are stored in the Obsidian plugin.
