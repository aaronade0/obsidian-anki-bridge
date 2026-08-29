# Changelog

## 1.2.2 - Safe Markdown code examples

- Ignored every canonical card marker inside Markdown inline code, matching the
  existing behavior for fenced code blocks, so documentation and AI prompts do
  not create accidental cards.
- Excluded inline and fenced code from fast marker detection and structured-
  block validation, preventing false `INVALID_BLOCK` conflicts and missing-
  media warnings from documented examples.
- Preserved inline code that appears in the front or back of a real card whose
  marker is outside the code span.

## 1.1.0 - Direct shortcuts and reliable nested Cloze editing

- Added direct `Tab` shortcuts for every card format: `>>` for Basic, `><` for
  Reversible, `>[` for List, `>{` for Dump, `>!` for Image Occlusion, and `[`
  for Cloze.
- Consumed Obsidian's automatically inserted `]` and `}` whether the cursor is
  inside or just after the pair, preventing duplicate closing characters.
- Made complete visible-plus-hidden card markers atomic CodeMirror ranges so
  arrow-key navigation cannot stop inside a hidden marker and make subsequent
  text appear in reverse order.
- Fixed nested Cloze numbering on indented continuation lines inside List
  cards, where trimmed indentation could previously produce invalid `c0`
  deletions instead of `c1`.
- Added parser and full Obsidian/Anki regression coverage for Cloze cards both
  directly on List items and on indented continuation lines.

## 1.0.1 - Community directory review fixes

- Replaced direct capture-element style assignments with Obsidian's
  `setCssStyles` helper.
- Scoped the help renderer to a short-lived component instead of the main
  plugin lifecycle.
- Bundled the PDF.js worker into `main.js` so Community Plugin installations
  do not depend on unsupported extra release assets.
- Added GitHub build-provenance attestations for the Community Plugin runtime
  assets.

## 1.0.0 - Nested cards, durable card moves, and Community directory readiness

- Added independently scheduled Basic, Reversible, Cloze, and Image Occlusion
  cards inside List items without exposing their answers on the outer List card.
- Added list-ancestor context for cards nested below indented Markdown list
  items, alongside the existing path, note, and heading context in Anki.
- Made every visible card marker clickable so it opens the corresponding Anki
  note; List markers open all of their active child notes. Removed the former
  cursor-based command.
- Preserved bridge keys, Anki note/card IDs, scheduling, and review history when
  an unchanged uniquely identifiable card is cut between existing notes. A copy
  still creates a new identity, and ambiguous moves are never guessed.
- Serialized per-file synchronization so simultaneous source/target editor
  events cannot race while a card is being moved.
- Renamed the plugin ID from `obsidian-anki-bridge` to the Community-directory-
  compatible `anki-bridge`, with migration of the old local settings/outbox and
  continued use of the existing vault-global registry.
- Added explicit network/data-access documentation, updated security guidance,
  and release assets/tags compatible with the Community Plugins directory.

## 0.4.4 - Explicit resolution for externally missing notes

- Added **Delete all from Anki…** for a source note that disappeared through a
  file sync client or file manager, with a second confirmation covering every
  owned card from that note.
- Rechecked the missing state and every Anki ownership mapping immediately
  before deleting, then verified the complete batch before removing registry
  state.
- Added **Set new path…** for explicitly relinking a moved note to an existing
  vault-relative Markdown path while preserving bridge IDs and Anki review
  history.
- Rejected missing, unsafe, or already-owned replacement paths instead of
  guessing through ambiguous moves.
- Allowed whole-file deletion confirmation from mobile through the validated
  desktop outbox, retaining the same safety checks before Anki is changed.

## 0.4.3 - Reliable external file-sync catch-up

- Read queued mobile changes directly from disk so a stale Obsidian read cache
  cannot hide newly synchronized card text.
- Rechecked registered notes every 30 seconds and the complete vault every five
  minutes, covering sync clients that replace files without emitting Obsidian
  modify events or a mobile outbox entry.
- Moved the registry and mobile queue into the vault-global
  `.obsidian-anki-bridge` directory, with automatic legacy migration, so mobile
  and desktop can use separate Obsidian configuration folders safely.
- Made desktop the sole writer of the shared card registry, preventing a stale
  mobile plugin snapshot from rolling back card identities or sync state.
- Kept the scan serialized and reused the normal reconciliation path so card
  identity, scheduling, deletion quarantine, and media ownership stay intact.

## 0.4.2 - Automatic mobile card picker

- Opened the card-format picker immediately after the second `>` is typed on
  Obsidian Mobile, without requiring a Tab key or toolbar customization.
- Kept a single `>` inert and retained the existing desktop keyboard workflow.
- Restricted automatic triggering to direct typing so synchronized, pasted, or
  pre-existing `>>` text cannot open the picker unexpectedly.

## 0.4.1 - Touch-friendly mobile card creation

- Added one touch-friendly card picker for Basic, Reversible, List, Dump,
  native Image Occlusion, and Cloze cards.
- Exposed the picker through a ribbon icon, the editor context menu, the
  command palette, and Obsidian's configurable mobile editor toolbar.
- Preserved selected text as the card front or wrapped it as a cloze instead of
  discarding it.
- Positioned the cursor inside List, Dump, and empty Cloze templates so mobile
  typing can continue immediately.
- Added the previously missing individual Image Occlusion insertion command.

## 0.4.0 - Serverless mobile outbox

- Enabled the plugin on Obsidian Mobile without requiring AnkiConnect on the
  phone.
- Added a device-separated outbox that travels with the synchronized vault and
  is processed through local AnkiConnect when desktop Obsidian and Anki run.
- Added automatic desktop catch-up after the application was closed.
- Preserved explicit mobile note deletions as safe pending deletions instead of
  misclassifying them as ambiguous filesystem changes.
- Allowed deletion confirmations to be queued on mobile and revalidated on the
  desktop immediately before Anki is changed.
- Kept media and plugin-specific visual rendering on the desktop, avoiding
  blank or degraded cards when a renderer is unavailable on mobile.
- Added durable queue status, retry behaviour, validation, and integration
  coverage for mobile creation, editing, deletion quarantine, and confirmed
  deletion.

## 0.3.0 - Native Image Occlusion and reliable plugin visuals

- Switched image-marker cards to Anki's built-in Image Occlusion note type.
- Added a safe starter mask and preserved native masks, comments, and back
  extras during later synchronization.
- Preserved existing card identity and scheduling when a compatible
  AnkiConnect installation migrates an earlier bridge image card.
- Added durable ownership tags for native notes without a `CardKey` field.
- Replaced blank full-container screenshots with direct SVG and Canvas capture
  for Excalidraw, Function Plot, and Charts View.
- Made images, PDFs, Canvas files, Excalidraw drawings, and other embedded
  previews open their source file in Obsidian when selected in Anki.
- Made visual code-block previews open their exact source card in Obsidian.
- Added isolated coverage for native model identity, mask preservation,
  clickable embeds, and non-blank plugin visual output.

## 0.2.1 - Safe whole-note deletion handling

- Added origin-aware handling for whole-note deletion.
- Turned notes explicitly deleted through Obsidian into individually
  confirmable pending Anki deletions.
- Kept externally missing or ambiguously moved notes as non-destructive
  conflicts without an Anki deletion action.
- Added automatic reconciliation when a deleted or missing note is restored.
- Removed the file registry entry after the last confirmed card deletion.
- Added isolated Obsidian and Anki coverage for direct deletion, restoration,
  ambiguity, and final registry cleanup.

## 0.2.0 - Rich visual media and public documentation

- Fixed generated media HTML being escaped and displayed as text.
- Enabled the image-card marker to create synchronized Anki notes.
- Added a shared rich-media renderer for every card format and both card sides.
- Added direct local image, animated image, audio, and video transfer.
- Added first-page PDF previews while retaining a link to the transferred PDF.
- Added portable SVG previews for Obsidian Canvas files.
- Added rendered snapshots for Excalidraw embeds, Function Plot blocks, and
  Charts View blocks through their enabled Obsidian plugins.
- Rewrote the README as general English documentation without personal
  migration notes.
- Added an in-app guide ribbon icon and translated all user-facing plugin text
  to English.
- Added isolated integration coverage for image cards, PDF previews, Canvas
  rendering, stored Anki media, and unescaped HTML.

## 0.1.1 - Usability and deletion confirmation

- Made the note name on the card front the Obsidian deep link.
- Removed the redundant source-link footer and source path from card backs.
- Added durable previews for removed cards and List items.
- Added individually confirmed Anki deletion from the conflict report, including
  ownership checks and post-delete verification.
- Bundled the full guide and exposed it through settings and the command palette
  inside Obsidian.
- Stopped `>>` + Tab and inline card choices from inserting a leading space into
  the answer.

## 0.1.0 - Development preview

- Added collision-resistant, versioned syntax with `>>` + Tab expansion.
- Added Basic, reverse, Cloze, List, and Dump cards.
- Added one independently scheduled Anki note per List item.
- Added an external identity registry; no IDs are written to Markdown.
- Added exact Vault/folder/note deck hierarchy and deck moves on note renames.
- Added periodic recovery for unambiguous filesystem-level moves.
- Added managed Anki note models and source-context breadcrumbs.
- Added deep links from Anki to the precise source card in Obsidian.
- Added editor decorations using the Obsidian accent colour.
- Added automatic/manual background sync and durable visible conflicts.
- Added image/audio/video/PDF attachment transfer for Obsidian embeds.
- Added safe preview markers for future Image Occlusion support without writing
  to existing Image Occlusion notes.
