# Architecture

Obsidian Anki Bridge is split into deterministic core modules and an I/O shell.
The split keeps a later remote transport from changing card syntax, identity,
or reconciliation rules.

## Data flow

```text
Markdown note
  -> deterministic parser
  -> external identity registry (data.json)
  -> safe Markdown and visual-media renderer
  -> desired Anki notes
  -> local AnkiConnect transport
  -> Anki models, decks, and notes
```

The editor decoration layer reads the same parser output. It does not maintain
a second interpretation of the note.

## Ownership

- **Obsidian owns:** prompts, answers, list items, dump content, source media,
  headings, and the note path.
- **Anki owns:** review history, scheduling, user-added non-bridge tags, native
  Image Occlusion masks, and the Image Occlusion `Back Extra` and `Comments`
  fields.
- **The bridge owns:** stable mappings, schema versions, last-known paths,
  generated note models/templates, and conflict state.

The bridge never updates Anki scheduling fields. Image-marker cards use Anki's
built-in `Image Occlusion` model. The bridge owns only `Image` and `Header`
after creation; it seeds a temporary full-image occlusion once and does not
subsequently write the mask or Anki-owned annotation fields. A per-card
ownership tag replaces the `CardKey` field that the native model does not have.

## Rich-media rendering

All card formats use one media pipeline. Markdown is rendered with raw HTML
disabled. Bridge-generated media fragments are held behind opaque placeholders
and inserted only after Markdown rendering, so generated `<img>`, `<audio>`,
and `<video>` elements remain functional without enabling arbitrary source
HTML.

Binary images, audio, and video are copied directly to Anki media using
content-addressed filenames. PDFs receive a first-page PNG preview and retain
the original file as a link. Canvas JSON is converted to portable SVG.
Allow-listed plugin visuals such as Excalidraw, Function Plot, and Charts View
are rendered in an isolated off-screen Obsidian Markdown container. Rendered
SVG and Canvas nodes are extracted directly, with a full-container screenshot
only as a fallback, and then stored as ordinary Anki media. Arbitrary code
blocks are never executed by this capture path.

Generated previews link back to the embedded source file through an
`obsidian://open` URI. Visual code blocks link to the precise source-card URI.
The native Image Occlusion review script supports the same linked descendant
image, so this behavior also applies to occlusion cards.

## Collision-resistant syntax

Visible symbols alone are not card delimiters. Every delimiter includes a
versioned Obsidian comment, for example:

```markdown
Question ⇢%%oab:basic:v1%% Answer
```

The editor hides `%%oab:basic:v1%%` and shows the arrow with the active Obsidian
accent colour. The namespaced, versioned token is extremely unlikely to exist
by accident or collide with another flashcard syntax.

## Stable identity without IDs in Markdown

`data.json` stores random file/card/item keys. Reconciliation uses:

1. exact normalized-content fingerprints;
2. card type plus nearest relative position for edits inside one known file;
3. exact file-content hashes for files moved outside Obsidian.

Ambiguous moves are reported and never guessed. Removed cards and list items
are quarantined in the registry. Their Anki notes are deleted only after an
individual confirmation in Obsidian; the bridge rechecks ownership immediately
before deletion and verifies the result before removing the registry entry.

Obsidian's public `FileManager.trashFile` operation is wrapped while the plugin
is loaded so the subsequent Vault deletion event can be attributed to an
explicit in-app deletion. Every top-level card in that note then enters the
same confirmed-deletion flow. A deletion event without that short-lived intent
is classified as an unknown external disappearance and creates only a
non-destructive missing-or-moved conflict. The file registry persists this
classification across restarts. Recreating or restoring a registered path
immediately reconciles the note and cancels pending deletions.

## Deck mapping

The mapping is exact and contains no path tags:

```text
Obsidian Flashcards
  :: <vault>
  :: <folder 1> :: ... :: <folder n>
  :: <note name>
```

Renames trigger immediate reconciliation. A periodic audit covers moves that
arrive through filesystem or sync tools without an Obsidian rename event.

## Sync and failure behaviour

- File changes are debounced and processed asynchronously.
- Full-vault sync yields between notes so Obsidian remains responsive.
- Every failed sync creates or refreshes a durable conflict.
- The status bar turns into a visible error indicator.
- Automatic failures are rate-limited as popups, but never hidden from the
  status bar or conflict report.
- Retry happens on the next change/manual sync; success resolves the transient
  connection conflict.

## Remote transport roadmap

The official Anki sync protocol is not a general card CRUD API. A future mobile
version should therefore add an authenticated HTTPS bridge that exposes the
same desired-note operations and runs next to a headless Anki instance (for
example as a TrueNAS app/container). It should use a narrow API, per-vault keys,
TLS, replay protection, a durable queue, and explicit conflict responses.

AnkiWeb credentials should not be collected by the Obsidian plugin. The local
transport remains available for Windows even after a remote bridge is added.
