# Anki Bridge

Anki Bridge creates and updates Anki flashcards directly from an
Obsidian vault. Card identities are stored in the plugin's private data file,
so no generated IDs are written into Markdown notes.

On desktop, the plugin connects to a running Anki application through
[AnkiConnect](https://ankiweb.net/shared/info/2055492159). On mobile, changes
are placed in a serverless outbox inside the synchronized plugin folder. The
desktop processes that outbox automatically the next time Obsidian and Anki
are open. No server, mobile Anki API, or additional account is required.

## Installation

The plugin has been submitted to Obsidian's Community Plugins directory. Until
the listing becomes installable after review, install the current GitHub
release manually:

1. Download `anki-bridge-<version>.zip` from the
   [latest release](https://github.com/aaronade0/obsidian-anki-bridge/releases/latest).
2. Extract the contained `anki-bridge` folder into
   `<vault>/.obsidian/plugins/`.
3. Reload Obsidian, open **Settings → Community plugins**, and enable
   **Anki Bridge**.
4. On the desktop, install
   [AnkiConnect](https://ankiweb.net/shared/info/2055492159), start Anki, and use
   **Test connection** in the bridge settings.
5. To create or edit cards on a phone or tablet, synchronize the complete vault
   including `.obsidian/plugins/anki-bridge`. No mobile connection
   setup is needed.

The release bundle contains all required runtime files. The PDF.js worker is
bundled into `main.js`, so Community Plugin installations can render PDF
previews without an unsupported extra release asset.

Versions before 1.0.0 used the plugin ID `obsidian-anki-bridge`. Install 1.0.0
into the new `anki-bridge` folder and enable **Anki Bridge**. The plugin reads
the existing vault-global `.obsidian-anki-bridge` registry and migrates the old
plugin-local settings/outbox, so Anki note IDs and review history are retained.
After verifying the migration, the disabled old plugin folder can be removed.

## Quick start

On desktop:

1. Install AnkiConnect and start Anki.
2. Type the front of a card followed by `>>`, then press `Tab`.
3. The bridge replaces `>>` with its collision-resistant card marker. Type the
   answer immediately; no leading space is inserted.

On a phone or tablet:

1. Type the front of a card followed by `>>`.
2. As soon as the second `>` is typed, choose Basic, Reversible, List, Dump,
   Image Occlusion, or Cloze from the card picker. A single `>` does nothing.
3. Enter the remaining content at the cursor position selected by the plugin.

The same touch-friendly picker remains available by long-pressing in the editor
and choosing **Insert Anki flashcard …**, through the command palette, or
through Obsidian's configurable mobile editor toolbar. These alternatives are
useful when selected text should become the front or a cloze deletion.

On desktop, wait for automatic synchronization or run **Sync current note with
Anki**. On mobile, that action safely queues the note for the next desktop
synchronization.

Desktop users can also type a single `>` and press `Tab` to open the same card
picker. Every template remains available individually through the command
palette.

The complete guide can also be opened inside Obsidian in three ways:

- click the book icon in the left ribbon;
- choose **Anki Bridge: Open user guide** in the command palette; or
- open the plugin settings and select **Open guide**.

## Mobile workflow

The mobile plugin does not attempt to contact `127.0.0.1:8765`, because Anki
desktop and AnkiConnect do not run on a phone. Instead it records small,
device-specific operations in `.obsidian-anki-bridge/mobile-outbox` at the
vault root:

1. Create cards by typing `>>` and choosing a format, then edit, rename, or
   remove them normally in Obsidian Mobile.
2. Let the same complete vault synchronize to the computer through Obsidian
   Sync, Nextcloud, Syncthing, or another file synchronization tool.
3. Open desktop Obsidian and Anki. The bridge processes queued operations
   automatically through the existing local AnkiConnect connection.
4. Synchronize AnkiMobile or AnkiDroid normally to receive the resulting Anki
   changes.

The status bar shows how many operations are queued. Repeated edits to the same
note on one device are coalesced. Events from different devices use separate
files, preventing them from overwriting one another during file synchronization.
Successfully applied events are removed automatically; failed events remain and
are retried every 30 seconds while desktop Obsidian is open. Desktop Obsidian
also checks registered note files directly every 30 seconds and scans the full
vault every five minutes, so external sync changes are recovered even when a
mobile event was not written.

Rich media and plugin-rendered visuals are rendered only on the desktop. A
phone that does not have Excalidraw, Function Plot, Charts View, or another
renderer installed therefore cannot replace a working Anki visual with a blank
or fallback image.

When a file-sync service synchronizes the complete vault, use a separate
Obsidian configuration folder on each device (for example `.obsidian` on
desktop and `.obsidian-mobile` on the phone). The bridge registry and queue are
vault-global, so this prevents device-specific Obsidian settings from
overwriting one another without breaking mobile card synchronization. Desktop
Obsidian is the sole writer of the shared card registry; mobile devices can only
append validated operations to the queue.

Removing a card inside a note is reconciled on the desktop and enters the usual
confirmed-deletion flow. Deleting or renaming a whole note through Obsidian
Mobile records an explicit outbox event, so the desktop does not confuse that
action with an unknown filesystem move. A permanent Anki deletion can also be
confirmed on mobile; the desktop rechecks the card's ownership and missing
state before applying that queued confirmation.

## Card formats

### Basic card

Creates one front-to-back card:

```markdown
Question ⇢%%oab:basic:v1%%Answer
```

The convenient desktop input sequence is `Question >>`, `Tab`, then `Answer`.
On mobile, typing `Question >>` opens the card picker immediately; choose
**Basic card** and type the answer.

### Reversible card

Creates both front-to-back and back-to-front cards:

```markdown
Term ⇄%%oab:reverse:v1%%Definition
```

Choose **Reversible card** in the card picker. On mobile the picker opens after
typing `>>`; desktop users can open it by typing `>` and pressing `Tab`.

### Cloze card

Turns the marked text into an Anki cloze deletion:

```markdown
The capital is ⟦%%oab:cloze:v1%%Berlin⟧%%oab:end:v1%%.
```

Select text and run **Mark selection as cloze deletion**. Multiple marked
parts on the same line become independently numbered clozes in one Anki note.

### List card

Creates one independently scheduled Anki note per top-level list item:

```markdown
Name the three laws ⇢[%%oab:list:v1%%
- First law
- Second law
- Third law
]⇠%%oab:end:v1%%
```

Numbered lists are supported as well. Indented lines and nested lists remain
part of their parent item.

List items may themselves contain Basic, Reversible, Cloze, or Image Occlusion
markers. The item front remains part of the outer List card, while the nested
marker creates an additional independently scheduled Anki note. Its answer is
not exposed on the outer List card:

```markdown
Name the quantities ⇢[%%oab:list:v1%%
- Velocity ⇢%%oab:basic:v1%%Change of position per time
- Momentum ⇄%%oab:reverse:v1%%Mass times velocity
]⇠%%oab:end:v1%%
```

Nested List and Dump blocks are intentionally rejected because their closing
markers would be ambiguous. Use an inline nested card or place the inner block
after the outer block instead.

### Dump card

Use a dump card for a larger, multi-line answer containing Markdown, code,
tables, media, or rendered diagrams:

````markdown
Explain the example ⇢{%%oab:dump:v1%%
A longer answer can contain several paragraphs.

```js
const answer = 42;
```
}⇠%%oab:end:v1%%
````

### Native Image Occlusion card

Creates a note using Anki's built-in **Image Occlusion** note type:

```markdown
Identify the labelled structures ⇢▣%%oab:image:v1%%![[diagram.png]]
```

The content after the marker may be a normal image, an Excalidraw drawing, or
another rendered visual. The first synchronization creates a temporary
full-image mask so Anki can create a real Image Occlusion card immediately.

To define the actual masks:

1. Open the synchronized note in Anki's browser.
2. Use Anki's native **Edit Image Occlusion** action.
3. Replace the temporary full-image mask with the desired rectangles,
   ellipses, or polygons.

Later synchronizations update the prompt and source visual but deliberately
leave **Occlusion**, **Back Extra**, and **Comments** under Anki's control. This
preserves masks and annotations edited in Anki.

Anki must already contain its built-in note type named **Image Occlusion**. If
it is missing or has incompatible fields, the bridge leaves the card unchanged
and reports the problem in **Conflicts and pending deletions**.

## Rich media and rendered visuals

The same renderer is used for every card format and for both sides of a card.
Supported content includes:

- Obsidian wikilink embeds and local Markdown image embeds;
- PNG, JPEG, GIF, WebP, SVG, BMP, and AVIF images;
- common audio and video files;
- PDF files with a first-page preview and a link to the transferred PDF;
- Obsidian Canvas files rendered as portable SVG diagrams;
- Function Plot and Charts View code blocks rendered as images;
- Excalidraw drawings and other visual file embeds rendered through their
  Obsidian plugin when that plugin is installed and enabled;
- standard Markdown formatting, tables, and fenced source code.

Plugin-specific visuals are rendered by the corresponding Obsidian plugin at
sync time and stored as ordinary Anki media. This keeps the resulting card
portable: Anki itself does not need the Obsidian rendering plugin.

Clicking an embedded image, PDF preview, Canvas, or plugin-rendered file in an
Anki card opens that source file in Obsidian. Function Plot and Charts View
blocks open the exact source card because they belong to the Markdown note
rather than to a separate file. Audio and video controls remain usable; their
captions link to the embedded source file.

If a visual cannot be rendered, synchronization records a visible warning and
keeps an explanatory placeholder instead of silently dropping the content.

## Priorities

Append `#prio1`, `#prio2`, `#prio3`, or `#prio4` to a card. The bridge adds the
corresponding priority tag in Anki. Tags added manually in Anki are preserved.

## Links back to Obsidian

The front of every Anki card shows its folder, source note, and heading
context. The highlighted note name is the link. Selecting it opens the exact
source note in Obsidian, scrolls to the card, and briefly highlights it.

In Obsidian, the visible card-type symbol itself is clickable. Selecting `⇢`,
`⇄`, `⇢[`, `⇢{`, `⇢▣`, or `⟦` opens that card in Anki's browser through local
AnkiConnect. A List marker opens all active notes belonging to that List card.
This desktop action replaces the former cursor-based command.

Indented list ancestors are shown below the folder, note, and heading context
on the Anki front. For example, a card below `Mechanics` → `Dynamics` carries
both list entries as context without adding them to the card answer.

No redundant source path or separate “Open in Obsidian” link is added to the
back of the card.

## Removed cards and confirmed deletion

Removing a card or list item from a Markdown note does not immediately delete
its Anki note:

1. Open **Conflicts and pending deletions** from the status bar or command
   palette.
2. Review the source path and saved card preview.
3. Select **Delete from Anki…**.
4. Confirm the permanent deletion in the second dialog.

Only then does the bridge delete the Anki note, including its review history,
and verify the result. Restoring the Markdown card before confirmation
reactivates the existing Anki note and clears the pending deletion.

Deleting an entire source note through Obsidian is handled like removing all of
its cards. Each card appears separately in **Conflicts and pending deletions**
and remains in Anki until its deletion is confirmed. Restoring the note before
confirmation reactivates the same Anki notes and clears those entries.

If a source note disappears without a deletion action observed inside Obsidian
(for example through a sync client or file manager), the bridge cannot safely
distinguish a deletion from a move. It therefore shows a non-destructive
**Source note missing or moved** conflict, keeps all associated Anki notes, and
runs a periodic path audit. The conflict offers two explicitly confirmed
resolutions:

- **Delete all from Anki…** permanently deletes every owned Anki note from the
  missing source file after rechecking its ownership and confirming that the
  source is still absent.
- **Set new path…** accepts an existing vault-relative Markdown path, keeps the
  bridge IDs and review history, and updates the Anki deck/source link to the
  new location. Paths already owned by another registered note are rejected.

If the periodic audit finds the same source file unambiguously before either
action is chosen, the registry and Anki deck path are updated automatically.

Cutting an unchanged card from one still-existing Markdown note and pasting it
into another also preserves the bridge key, Anki note/card IDs, scheduling, and
review history. The transfer is inferred only when the exact card fingerprint
is unique and the card is confirmed absent from its old source. Copying keeps
the original in place and therefore creates a new card. Ambiguous or edited
during-move cases are never guessed.

## Deck structure

Decks mirror the source location:

```text
Obsidian Flashcards
  :: <vault>
  :: <folder 1> :: ... :: <folder n>
  :: <note name>
```

Renames and unambiguous file moves also move the corresponding Anki cards.

## Safety and ownership

- The bridge never writes generated IDs or metadata into Markdown notes.
- Anki retains ownership of scheduling, review history, and manually added
  tags.
- The bridge updates only fields it owns and never changes scheduling data.
- Native Image Occlusion masks and Anki-only annotations are never overwritten
  during routine synchronization.
- Mobile devices never write directly to Anki or mutate the central card
  registry; they only append validated, device-separated outbox operations.
- Ambiguous mappings, missing renderers, and connection errors remain visible
  in the conflict report.
- Nothing is deleted from Anki without explicit confirmation.

## Network and data access

The plugin contains no telemetry, ads, account system, or hosted bridge. On
desktop it sends card operations only to the user-configured AnkiConnect HTTP
address, which defaults to `http://127.0.0.1:8765`. On mobile it performs no
network request to Anki; it writes validated events and registry state only
inside the current Obsidian vault for the user's chosen vault-sync service to
transport. Rich-media files are read only from the current vault and copied to
Anki through AnkiConnect.

## Settings

On desktop, the settings page contains the AnkiConnect address and optional API
key, deck root, vault-name override, automatic synchronization controls,
path-audit interval, success notifications, connection test, and the in-app
guide. On mobile, the local connection fields are replaced by the current
outbox count because no mobile connection configuration is required.

## Development

```bash
npm install
npm run check
```

Integration tests must use an isolated Anki collection. The repository's test
scripts refuse to run against the default production AnkiConnect port `8765`.
The optional `npm run test:visual` check additionally requires Excalidraw,
Function Plot, and Charts View to be installed in the test vault; it verifies
that their captured images contain visible pixels.
Architecture details are documented in [ARCHITECTURE.md](ARCHITECTURE.md).

## License

Anki Bridge is available under the [MIT License](LICENSE). Release
bundles also include the licenses of bundled third-party dependencies.
