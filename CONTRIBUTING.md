# Contributing

This project is currently an early development preview. Please discuss syntax,
registry-schema, or destructive-sync changes before implementing them.

## Development

```bash
npm install
npm run check
```

Integration tests must use a disposable Anki profile/container on a port other
than `8765`:

```bash
OAB_ANKI_TEST_URL=http://127.0.0.1:18765 npm run test:anki
```

The repository's integration script refuses the default production port.

## Safety invariants

- Never write generated IDs or metadata into Markdown.
- Never delete Anki notes automatically; deletion requires an explicit,
  target-specific confirmation and post-delete verification.
- Never overwrite scheduling or review data.
- Never guess ambiguous file/card identity.
- Never make a sync failure invisible.
- Preserve compatibility with already-written legacy syntax by ignoring it.

Schema and marker changes require a migration design and regression tests.
