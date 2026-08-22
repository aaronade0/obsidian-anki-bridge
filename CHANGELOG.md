# Changelog

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
