---
name: Workspace Switcher (Paseo Ctrl+Tab overlay)
description: Land in the intended workspace in one gesture; when it is not among the recent ones, type a few letters.
colors:
  scrim: "rgba(24, 24, 27, 0.34)"
  panel: "rgba(246, 246, 247, 0.96)"
  solid: "#f6f6f7"
  ink: "#18181b"
  muted: "#63636b"
  border: "rgba(0, 0, 0, 0.1)"
  tile: "rgba(0, 0, 0, 0.07)"
  selected: "rgba(0, 0, 0, 0.07)"
  ring: "rgba(0, 0, 0, 0.16)"
  faint: "rgba(0, 0, 0, 0.05)"
  thumb-border: "rgba(0, 0, 0, 0.08)"
  key: "rgba(255, 255, 255, 0.95)"
  mark: "rgba(24, 24, 27, 0.12)"
  running-blue: "#2563eb"
  waiting-amber: "#b45309"
  waiting-amber-dot: "#f59e0b"
  failed-red: "#dc2626"
  finished-green: "#16a34a"
  merged-purple: "#7c3aed"
  diff-add: "#15803d"
  diff-del: "#dc2626"
  scrim-dark: "rgba(0, 0, 0, 0.5)"
  panel-dark: "rgba(30, 30, 33, 0.95)"
  solid-dark: "#1e1e21"
  ink-dark: "#f4f4f5"
  muted-dark: "#a1a1aa"
  border-dark: "rgba(255, 255, 255, 0.09)"
  tile-dark: "rgba(255, 255, 255, 0.1)"
  selected-dark: "rgba(255, 255, 255, 0.08)"
  ring-dark: "rgba(255, 255, 255, 0.17)"
  faint-dark: "rgba(255, 255, 255, 0.05)"
  thumb-border-dark: "rgba(255, 255, 255, 0.07)"
  key-dark: "rgba(255, 255, 255, 0.07)"
  mark-dark: "rgba(255, 255, 255, 0.16)"
  running-blue-dark: "#60a5fa"
  waiting-amber-dark: "#fbbf24"
  failed-red-dark: "#f87171"
  finished-green-dark: "#4ade80"
  merged-purple-dark: "#a78bfa"
typography:
  query:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Helvetica, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 500
  name:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Helvetica, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: "20px"
    letterSpacing: "-0.01em"
  empty-title:
    fontSize: "14px"
    fontWeight: 600
  status:
    fontSize: "12px"
    fontWeight: 550
    lineHeight: "20px"
  meta:
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "17px"
    fontFeature: "tnum"
  hint:
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "18px"
  empty-text:
    fontSize: "12.5px"
    fontWeight: 400
  branch:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "11.5px"
    fontWeight: 400
  keycap:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: "16px"
    fontFeature: "tnum"
  placeholder-project:
    fontSize: "13px"
    fontWeight: 550
rounded:
  mark: "3px"
  key: "5px"
  tile: "7px"
  thumb: "9px"
  row: "12px"
  card: "15px"
  sheet-list: "18px"
  sheet-strip: "22px"
  pill: "999px"
spacing:
  row-gap: "2px"
  card-gap: "6px"
  list-inset: "6px"
  sheet-hint-gap: "10px"
  strip-inset: "10px"
  row-y: "10px"
  row-x: "12px"
  row-column-gap: "12px"
  phone-column-gap: "10px"
  phone-edge: "16px"
  query-x: "18px"
  strip-edge: "48px"
  top: "max(48px, 16vh)"
components:
  sheet-list:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.sheet-list}"
    width: "min(680px, calc(100vw - 32px))"
  sheet-strip:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.sheet-strip}"
    padding: "10px"
  row:
    rounded: "{rounded.row}"
    padding: "10px 12px"
    typography: "{typography.name}"
  row-selected:
    backgroundColor: "{colors.selected}"
    rounded: "{rounded.row}"
  row-phone:
    rounded: "{rounded.row}"
    padding: "10px"
  card:
    rounded: "{rounded.card}"
    padding: "8px 8px 10px"
    width: "176px to 240px"
  card-selected:
    backgroundColor: "{colors.selected}"
    rounded: "{rounded.card}"
  thumbnail:
    rounded: "{rounded.thumb}"
  keycap:
    backgroundColor: "{colors.key}"
    textColor: "{colors.muted}"
    rounded: "{rounded.key}"
    height: "18px"
    padding: "0 5px"
    typography: "{typography.keycap}"
  query-bar:
    backgroundColor: "{colors.solid}"
    textColor: "{colors.ink}"
    height: "48px"
    padding: "0 18px"
    typography: "{typography.query}"
  hint-bar:
    backgroundColor: "{colors.solid}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "5px 12px"
    typography: "{typography.hint}"
  status-dot:
    rounded: "{rounded.pill}"
    size: "8px"
  status-ring:
    textColor: "{colors.running-blue}"
    rounded: "{rounded.pill}"
    size: "9px"
  name-mark:
    backgroundColor: "{colors.mark}"
    rounded: "{rounded.mark}"
  empty-state:
    padding: "26px 32px"
    typography: "{typography.empty-title}"
---

# Design System: Workspace Switcher

## Overview

**Creative North Star: "The Cmd+Tab Sheet"**

The switcher is a macOS-grade switcher sheet drawn over Paseo. The app dims, and one translucent panel of workspaces appears near the top of the window, the way Spotlight does. Rows run in recency order, the selected one is lifted by a neutral ring, and a keycap legend sits under the sheet. When you type, a search field becomes the sheet's header without leaving the gesture. This is the signature move: the panel stays where it is, and the rows below the query never move.

It is an overlay, not a Paseo screen. It draws itself with plain DOM outside React, so it owns a small palette of zinc neutrals in two themes. The theme comes from the luminance of the workspace surface the sheet opens over, not from host tokens. Its only colours are Paseo's status hues, so a status reads exactly as it does in the sidebar. Selection never uses a hue. The settings screen is the exception: it is entirely the host's own `SettingsSection`, `SettingsCard` and `SettingsSelect`, with no styling of its own.

The density is that of a launcher. Names are 14px, everything else is 11–12px, and the query is the largest text on screen at 15px. Each row answers "which one is it" (project, name, branch, pull request, checks, diff, unpushed commits) and "what is its agent doing" (the state label and dot) in two lines.

**Key Characteristics:**

- One translucent sheet over a dimmed app; the hint pill is a separate solid object beneath it.
- Recency order always; the order never reshuffles by status.
- Neutral selection: a 7–8% fill plus a 1px inset ring, never a hue.
- Paseo's status language: blue turning ring for running, amber for needs input, red for failed, green for finished, and purple for merged pull requests.
- Lucide icons for PR state, checks, unpushed commits and search; keycaps for keys.
- Built for speed: plain DOM, under 200 elements, nothing on a navigation path.

## Colors

Zinc neutrals in two themes, with Paseo's status hues as the only colour. Each hue has a light value and a brighter dark value.

### Status

- **Running Blue** (`running-blue` / `running-blue-dark`): the turning ring of a running agent, in the status column and on thumbnail titles. The "Running" label stays in ink, because the ring already carries the hue.
- **Waiting Amber** (`waiting-amber`, dot `waiting-amber-dot` / `waiting-amber-dark`): needs input. The dot uses the brighter amber and the label uses the darker one so the text stays legible on light grounds. Pending checks also use this amber.
- **Failed Red** (`failed-red` / `failed-red-dark`): a failed agent (dot and label), failing checks, "Changes requested", and the icon of a closed pull request.
- **Finished Green** (`finished-green` / `finished-green-dark`): an agent that finished and hasn't been looked at yet (Paseo's "attention", labelled "Finished"), passing checks, "Approved", and the icon of an open pull request.
- **Merged Purple** (`merged-purple` / `merged-purple-dark`): a merged pull request, icon and label together.
- **Diff** (`diff-add`, `diff-del`): `+N` and `−N` line counts. In dark they share the finished green and failed red.

### Neutral

- **Scrim** (`scrim` / `scrim-dark`): dims the whole app enough that page text never competes with the sheet and the hint.
- **Panel** (`panel` / `panel-dark`): the sheet, at 95–96% opacity over a 28px blur saturated 1.4×.
- **Solid** (`solid` / `solid-dark`): opaque surfaces that sit on the sheet or the scrim: the query header and the hint pill.
- **Ink** (`ink` / `ink-dark`): names, query text, PR numbers, the status label for running, and keycaps in the hint.
- **Muted** (`muted` / `muted-dark`): the meta line, times, counts, the search icon, placeholder project names and the "Type to filter" hint.
- **Border** (`border` / `border-dark`): the sheet edge, the query header's bottom rule, the hint pill edge, and the keycap edge and bottom lip.
- **Tile** (`tile` / `tile-dark`): the plugin screen's placeholder tile.
- **Selected and Ring** (`selected`, `ring` and their dark values): the selected row or card fill and its 1px inset ring. The ring colour is also the strip's scrollbar thumb.
- **Mark** (`mark` / `mark-dark`): the highlight behind the matched letters of a filtered name.
- **Faint, Thumb border and Key**: the placeholder thumbnail ground, the thumbnail hairline, and the keycap face.

### Named Rules

**The Neutral Selection Rule.** The selected item is lifted by a neutral fill and a 1px inset ring, never by an accent or status hue. Hue always means agent or pull request state.

**The Say What Paseo Says Rule.** Status words and hues match the sidebar: "Running" with a blue turning ring, "Needs input" amber, "Failed" red, "Finished" green. A workspace with no live status ("done") gets no mark at all, only its age.

**The Checks Are Not Agents Rule.** A pending check reads "pending" in amber, never "running" in blue, so a check can never be mistaken for the agent's own status.

## Typography

**Body Font:** system sans (`system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`)
**Label/Mono Font:** `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` at 11.5px, for branch names only

**Character:** One system face in a narrow range. Hierarchy comes from weight (400 / 500 / 550 / 600 / 650) and ink versus muted. Every changing number (diff counts, times, match counts, PR numbers) is tabular.

### Hierarchy

- **Query** (500, 15px): the typed filter in the query header, followed by a 1.5 × 19px blinking caret.
- **Name** (600, 14px, 20px, −0.01em): the workspace name. In the list it wraps in full and is never truncated. On thumbnail cards it is clamped to two lines at a 19px line height.
- **Empty title** (600, 14px): "No workspace matches “…”", "No workspaces yet", and "Loading workspaces" (500, muted, with a spinner).
- **Status** (550, 12px, 20px): the status label in the side column.
- **Meta** (400, 12px, 17px, muted): project, PR, checks, review, diff and unpushed count, separated by a 12px gap rather than dots; times use the same size, right-aligned.
- **Hint** (400, 12px, 18px): keycap labels in ink at 85% opacity.
- **Empty text** (400, 12.5px, muted): the line under an empty title.
- **Branch** (mono 11.5px): the branch, shown only when it differs from the name.
- **Keycap** (600, 11px, 16px, tabular): keys.

### Named Rules

**The Mono Is For Branches Rule.** Mono marks a git branch. Names, projects and PR numbers stay in the sans.

**The Full Name Rule.** In the list, names and branches wrap rather than ellipsize, so two similar names can always be told apart.

## Layout

- **Placement:** the overlay fills the window and pins its content to the top, at `max(48px, 16vh)`, centred. So the sheet grows downward and never jumps while you type. The sheet and the hint stack with a 10px gap.
- **List (default):** the sheet is `min(680px, 100vw − 32px)` wide. Rows stack 2px apart inside a 6px inset. Each row is a three-column grid: a 20px lead slot | content | right-aligned column, on two lines, with 12px column gaps and 10 × 12px padding. Under 480px the right column drops below the content. The list scrolls inside a height of `100vh − top − 150px`. It scrolls the selection into view only when it overflows, because scrolling forces a layout.
- **Thumbnails:** cards from 176px to 240px wide (aspect 0.66) are sized to fit every card in the window less 48px a side. They sit 6px apart inside a 10px inset. A strip that still overflows scrolls sideways and fades 28px at each edge rather than cutting a card. Cards align to the top, so a two-line name never stretches its neighbours.
- **Phone rule (under 600px):** the thumbnail layout falls back to the list. The grid tightens to 10px gaps with 10px padding. The meta line wraps, and the hint becomes the sentence "Tap a workspace to switch". A coarse pointer gets that sentence at any width.
- **Right column:** right-aligned and unwrapped, one value per line: the state label on the name's 20px baseline, the compact facts under it.

## Elevation & Depth

There are three layers: the scrim, the blurred translucent sheet, and opaque solids on top (the query header and the hint pill). The sheet is the only element that casts a shadow. Everything inside it is flat, and selection is an inset ring, not a lift.

### Shadow Vocabulary

- **Sheet** (`box-shadow: 0 24px 64px rgba(0, 0, 0, 0.26), 0 2px 8px rgba(0, 0, 0, 0.1)`): the floating sheet, both themes.
- **Selection ring** (`box-shadow: inset 0 0 0 1px var(--pws-ring)`): the selected row or card.
- **Keycap lip** (`box-shadow: 0 1px 0 var(--pws-border)`): the 1px bottom edge that makes a keycap read as a key.
- **Match halo** (`box-shadow: 0 0 0 1px var(--pws-mark)`): extends the match highlight past the glyph edges.

### Named Rules

**The One Floating Sheet Rule.** One object floats and casts a shadow. Rows, cards and the query header are flat, and the hint is a solid pill with no shadow or blur, so it stays readable over any page.

## Shapes

Nested rounded rectangles. Each radius is smaller than the one around it: sheet 22px (strip) or 18px (list), card 15px, row 12px, thumbnail 9px, keycap 5px, match 3px. The hint is a pill. Status dots and the running ring are circles (8px and 9px). The ring has a 1.75px stroke with its top quarter open.

## Components

### Sheet

The one floating panel: `panel` over a 28px blur, a 1px `border` edge, the sheet shadow, and `listbox` role labelled "Switch workspace". It holds the optional query header and the rows or cards, and clips them to its corners.

### List row (signature)

- **Lead slot (20px):** what the row is, as one muted 14px Lucide icon on every row so the rows line up: `git-branch` for a workspace on a branch, `folder` for one without, `puzzle` for a plugin screen. These are the fallbacks: a plugin screen shows its own icon (captured from its highlighted sidebar row, else from Paseo's screen header, and stored, sanitized, with the screen; a stored screen with no icon yet takes its own sidebar row's when the switcher opens, selected or not, where the plugin's sidebar item shares the screen's ID; a raster image in a row wins over an svg, and an svg that only holds a tint filter is not an icon), and a workspace shows the avatar of the paseo-bots bot behind its most recently active chat that carries a `paseo-bots.bot` label at 16px, else its repo icon at 16px (see Icons below). Both draw in the muted icon colour where the markup uses `currentColor`.
- **Line 1:** the full name, or the branch when the sidebar's Display settings title workspaces by branch (marked letters when filtering), bold, wrapping; a workspace hidden from the sidebar gets a small bordered "hidden" tag after it. On the right, the agent's state: the same status mark as the Thumbnails layout and Paseo's sidebar, 6px before one string in the label's colour: a turning ring and "Running · 4m" in `running-blue`, an amber dot and "Needs input · 4m" in `waiting-amber`, a red dot and "Failed · 4m", a green dot and "Finished · 4m". `done` has no mark, only "1h ago" or "just now" in muted. The time shows only while the sidebar's trailing item is the timestamp (Paseo's default); otherwise an active state shows its word alone and `done` shows nothing there.
- **Line 2, left:** muted "project · branch · host", each only when the sidebar's Display settings show it: project and branch are off by default, as in Paseo; the branch is in mono and left out when it is already the title; the host's name shows only when the app has more than one host. A plugin screen shows only its plugin name ("Flowly").
- **Line 2, right:** tabular facts in a fixed order, each omitted when it does not apply: PR (icon + `#N`, when the sidebar shows pull requests), checks as one icon (check in `finished-green`, clock in `waiting-amber`, x in `failed-red`; only while the PR is open or draft), followed by "passed", "pending" or "failed" when the sidebar shows checks as icon and text, and not at all when it hides them, the diff as one green `+N` and red `−N` pair (only when the sidebar's trailing item is the diff), and unpushed commits (up arrow + count). Plugin screens show none.
- **States:** hover moves the selection (no separate hover style), a click commits. The selected row takes a `running-blue` tint, 12% fill and 38% border, over 90ms.

### Sessions of a workspace

→ on a workspace row (↓ on a thumbnail card) replaces the list in place with that workspace's sessions: its agent chats and its terminals; ← (or a click on the header) goes back with the selection on the same workspace and its filter as it was. Plugin screens have no sessions, and a workspace's sessions come from its own host (the agent list, and `terminals.list` for that workspace), so → does nothing on a plugin screen or on a workspace whose host has not answered. Other tab kinds (browser, files, the setup tab, drafts) are not listed: browsers have no list in the SDK, and the rest are views, not sessions.

- **Header:** a 44px bar with a bottom rule: a ← keycap, the workspace name in 600 14px, and a right-aligned muted tabular count ("1 session", "3 sessions"; empty until both lists have loaded or failed). Paseo's agent list cannot be asked for one workspace, so the chats come from one page (200) of the host's most recently changed agents; when the host has more, the count says "3 recent sessions", since a workspace's oldest chats may be missing. Terminals are asked for on every drill-in. Under it the query header, once there is a query.
- **Chat row:** the list row's grid with one line: the Lucide `message-square` in the muted lead slot, the chat's title (Paseo's "New agent" when it has none) with marked letters when filtering, followed 8px later by its provider ("Claude", "Codex"; capitalized id for others) in muted 12px, and on the right the same status mark and label as a workspace row, from Paseo's own bucket for the chat (permission pending: Needs input; error: Failed; running: Running, timed from the turn's start; finished and not looked at: Finished; else "1h ago" from its last change). No facts line. The hover × archives (see Archiving); a chat cannot be hidden.
- **Terminal row:** the same grid with the Lucide `terminal` in the lead slot and the terminal's name ("Terminal" when it has none). No provider and no status: the SDK gives a terminal no state or timestamps. Its hover × is labelled "Close terminal".
- **Order:** the chat last focused in that workspace, then the rest by last change, with chats a routine, a bot's ask or the PR review watcher started after yours; then the terminals, in the order the host lists them. Archived and internal chats are left out.
- **Filter:** every word of the query must appear in the chat title or terminal name.
- **Always a list,** in the Thumbnails layout too.
- **States:** "Loading sessions" with a spinner; "Couldn’t load this workspace’s sessions" / "Enter opens the workspace." when the agent list fails, or the terminal list fails with none known (a host whose SDK refuses workspace terminals, "Update the host to use workspace terminals", counts as having none, not as a failure); "No sessions in this workspace" / "Enter opens the workspace."; "No session matches “x”" / "Chat titles and terminal names are searched." While one list has loaded and the other is pending, the rows found so far show. When the chats loaded but the terminal list failed, a muted "Terminals unavailable" note follows the rows.
- **Commit:** Enter, releasing the held modifier or a click opens the session through the workspace route with `?open=agent:<id>` or `?open=terminal:<id>`. A chat is remembered as that workspace's last focused chat; a terminal is not.

### Thumbnail card

A 15px-cornered card with a thumbnail framed by a 1px hairline at 9px corners. The thumbnail ground is the workspace's own surface colour. Below come the title (status mark + name, two lines at most) and a meta line (project · branch · host, then the diff, each as the sidebar's Display settings say). Before a raster exists, or when it was taken in the other theme, a placeholder shows the project name in muted text (the screen's icon, else a puzzle, for a plugin screen; the bot's avatar above the project name for a bot workspace) and "No preview yet".

### Icons from other sources

Svg from another source (a plugin screen's header icon, a bot avatar) is rewritten from an allowlist before it is stored or drawn: drawing elements and presentation attributes only; no scripts, `foreignObject`, styles, event handlers, links other than local `#id`, or `url()` other than `url(#id)`; at most 8 KB. `currentColor` is kept, so the icon takes the muted colour. A bot avatar comes from the optional `globalThis.__paseoBotsAvatars` API (version 1), read fresh on every render and never cached, because Paseo re-runs plugin entries after navigations and paseo-bots replaces it then. While the switcher is open it re-renders on the API's `subscribe` callback, resubscribing if the object changed. A picture avatar is drawn as an `img` only for `http(s)` or raster `data:` URLs. The bot is the `paseo-bots.bot` label of the workspace's most recently active chat that carries one. A screen's icon comes first from its own sidebar row, else the plugin's highlighted one (Paseo's header shows a badge only for legacy sidebar registrations, so a screen opened from a `SidebarRow` has none): its first svg, or an `img` whose source is a raster `data:` URL of at most 16 KB (drawn as is, so a tint Paseo applied is lost). Otherwise it is read from the title's own previous sibling. A row icon is kept while the sidebar is collapsed or no row is highlighted; without one, a title with no badge clears any stored icon. The screen's title is the drawn header title (Paseo keeps earlier plugin screens mounted but hidden, so only a title with client rects counts); with none drawn and none stored, the own row's label names the screen, and a stored title that came from a sibling screen's header is corrected to the own row's label when the switcher opens.

A repo icon comes from the plugin's own daemon side (`icons.project`), asked once per project root after the switcher draws, and only with the Repo icons setting on. The daemon answers only for a directory Paseo lists as a project root or workspace directory, and reads an icon file only when its real path stays inside the repo's (a symlink cannot lead out); it keeps at most 200 roots. It returns an icon file found with Paseo's own candidate list (square, at most 64 KB; an ICO becomes its largest PNG frame), else the GitHub owner avatar of the `origin` remote. It is always drawn as an `img` from a `data:` URL, with corners of 3px. Svg and ICO data URLs are allowed there (and only there) because a browser runs no script and loads nothing for an svg drawn as an image. Answers, including a definite "none" (no icon file and no GitHub remote, or GitHub has no such account), are kept per host and project root for a day, carried across plugin reinstalls with the loaded lists. A passing failure (a timeout, the network, GitHub's 5xx or rate limit, a project Paseo does not list yet) is kept for 5 minutes on the daemon and marked `retry`; the switcher asks again a minute after such an answer or a failed request. The RPC reaches only the daemon of the plugin installation that sends it, so each host's roots are asked of that host's installation, which the switcher identifies by one workspace ID it lists; a workspace on a host that does not run this plugin keeps its branch icon. Precedence on a workspace: bot avatar, then repo icon, then `git-branch` or `folder`.

Svg ids are rewritten to a unique prefix per drawing, and local references follow them; a reference to an id outside the svg is dropped.

### Several hosts

Paseo runs the plugin once per connected host. One switcher, made by the newest installation, handles the keys and lists the workspaces of every host the app can reach (each read through that host's own API and kept under its server ID), mixed by recency like any others. A row always shows its own host's data. When its host has not answered (offline, or still loading), it shows its sidebar label, else the name last seen when it was visited, never a bare "Workspace". Each host's rows are drawn as soon as its list lands, so a slow host holds up no other, and a request that has not settled in 10 seconds is given up so the host is asked again on the next open. When hosts run different versions of the plugin, the newest version's switcher handles the keys; an older copy that takes them is replaced again.

### Visits

A workspace or plugin screen counts as visited the moment it opens, stamped with that time; there is no minimum stay. A chat opened on paseo-bots' Bots screen counts like focusing that chat's tab: a visit to its workspace, and the chat becomes that workspace's remembered tab, so switching there reopens it unless you have messaged another chat since. These come from the optional `globalThis.__paseoBotsChatOpens` API (version 1): its `recent()` opens are folded in when it is first seen, then each new one through `subscribe`; times only move forward, so folding the same opens twice changes nothing. The API may appear after the switcher starts or be replaced when paseo-bots re-runs, so it is looked up again when the switcher opens and every two seconds. paseo-bots screens it lists in `passThroughScreens` (its "Opening chat" screen, which only forwards you on) never count as visits. The last list seen is stored and used while the API is absent (it can load after the switcher), and a visit to one of its screens recorded before the list was known is dropped when the API appears; with neither a live nor a stored list, no screen is skipped. Anything hidden from the switcher records nothing.

### Sidebar display settings

Rows follow the Display settings of Paseo's sidebar, re-read each time the switcher opens and never written: the title source (title or branch), which details show (branch, project, host, pull request), how checks show (icon and text, icon, or hidden), and the trailing item (last activity, diff, or nothing). Values the plugin cannot read fall back to Paseo's defaults. Status marks and words always show. The sidebar's services and labels have no counterpart: the switcher has no data for them, so it shows neither. The Thumbnails card's meta line follows the same details and diff setting.

### Status marks

- **Running:** a 9px ring in `running-blue`, turning once per 0.9s. Under reduced motion it stands still with a dotted stroke.
- **Needs input, Failed, Finished:** 8px dots in `waiting-amber-dot`, `failed-red` and `finished-green`.
- **Done:** no mark.

### Query header

It appears only once there is a query: a 48px `solid` bar with a bottom rule, a 16px muted search icon, the query in 500 15px, a blinking caret, and a right-aligned tabular count ("1 match", "2 matches", "5 of 12"; empty when nothing matches). Matched letters in names take the `mark` highlight.

### Hint keycaps

A `solid` pill under the sheet that lists only the keys that work right now:

- Holding: Ctrl "release to switch", ` "back" (Shift ` with the ` shortcuts; Shift Tab still works with the Tab ones), → "sessions", ⌫ "archive", ⇧⌫ "hide", Esc "cancel", then muted "Type to filter". When only plugin screens are listed, the pair is a single ⌫ "hide".
- Opened from the Command Center: Enter "switch", arrows "move", → "sessions", ⌫ "archive", ⇧⌫ "hide", Esc "close", "Type to filter".
- Filtering: Enter "switch", arrows "move", → "sessions", Esc "clear".
- No match: Backspace "edit", Esc "clear".
- In a workspace's sessions the switcher is always sticky (→ makes a held one so, and ← keeps it): Enter "open", ↑↓ "move", ← "workspaces", ⌫ "archive" or "close", Esc "close", "Type to filter"; filtering and no match as above with "open" for "switch". Touch: "Tap a session to open it".

Arrows are ↑↓ in the list and ←→ in the strip, where "sessions" is ↓. "sessions" is left out when only plugin screens are listed. Keycaps are 18px tall, at least 18px wide, with 5px corners, a `key` face, a `border` edge and a 1px lip. In the hint they use ink; on rows and cards they use muted.

### States

- **Loading:** a muted spinner and "Loading workspaces", with no hint pill. When the list arrives, the selection starts on the previous workspace, as on a fresh open.
- **Empty:** "No workspaces yet" / "Create one with New workspace in the sidebar."
- **No match:** "No workspace matches “sea”" / "Names, projects, branches and pull request numbers are searched.", with the edit/clear hint.
- **Single workspace:** a muted note under the only row: "Open another workspace, then Ctrl+Tab flips between the two." On touch screens it reads "Open another workspace to switch between them here."

### Settings

The host's Settings section "Switcher" with one card holding two `SettingsSelect` rows: Layout (List / Thumbnails) and Workspaces shown, each with a one-sentence hint. Switches follow for background workspaces, plugin screens, counting messages as visits, and Repo icons. No custom styling. A second section, "Hidden from switcher", appears only while something is hidden: one `SettingsAction` row per item (workspace name and project, or plugin screen title and "Plugin · name") with an "Unhide" button.

### Hiding

Shift+Backspace hides the selected workspace or plugin screen (on a chat it does nothing); with a query, Backspace edits it. Each workspace and plugin-screen row and card has a 22px × button, shown on hover, labelled "Hide from switcher". The selection stays on its index (clamped) and the list refills up to the limit. A hidden key is dropped from the recents, the Cmd+` cycle and the quick-tap target and records no visits (opening it or messaging it); filtering still finds it, and visiting it does not unhide it. Hidden keys are stored in `paseo-switcher:hidden`; the retired per-screen switches (`paseo-switcher:skipped-screens`) are merged into it once and deleted. Stored titles of hidden screens are kept so Settings can name them. The existing "hidden" tag still means hidden from Paseo's sidebar.

### Archiving

Hold mode keeps Ctrl down throughout, so the keys depend on Shift alone. With an empty query, Backspace archives the selected row: a workspace through the workspace API of its own host, a chat through that chat's agent handle on its own host. A terminal is closed instead, with `terminals.ref(id).kill()` on its own host. Plugin-screen rows cannot be archived, so Backspace hides them as Shift+Backspace does. With a query, Backspace edits it and Ctrl or Alt+Backspace clears it.

- **Arming.** Every workspace, chat and terminal needs a second Backspace: archiving a worktree workspace deletes its folder, and closing a terminal ends its process. The first press arms that one row: it takes a danger tint (`bad` at 14% under a 1px `bad` inset ring, over the selection tint) and the hint pill is replaced by "⌫ again to archive" ("⌫ again to close" on a terminal) in `bad` ink (touch: "Tap × again to archive" or "… to close"). Moving the selection, hovering another row, typing, any other key, or 4 seconds disarms it. Two guards keep a held key from archiving: a repeating (held) Backspace with an empty query does nothing at all (it still erases typed text), and a second Backspace is ignored, without disarming, until 250 ms have passed and a Backspace keyup has been seen since arming (so synthetic repeats without the repeat flag cannot archive).
- **Session ×.** Each chat and terminal row has the same 22px hover × as workspaces, labelled "Archive chat" or "Close terminal". The first click arms the row, the second (after the same 250 ms guard) archives or closes it; no × click counts within 250 ms of an archive, so a double-click cannot archive the row that moves under the pointer.
- **After.** The row leaves the list at once and the selection stays on its index, clamped. Archiving or closing a workspace's last session returns to the workspace list. The host's lists are then reloaded; a list that was already in flight cannot bring the row back.
- **Hold mode.** Archiving or hiding a row, like typing or drilling into a workspace's sessions with →, makes a held switcher wait for Enter or a click, so releasing the modifier does not open whichever row moved under the selection.
- **Failure.** The row comes back and the hint pill reads "Couldn't archive: <message>" ("Couldn't close: …" for a terminal) (at most 80 characters) in `bad` ink for 3 seconds.

### Motion

- The scrim fades in over 140ms ease-out.
- The sheet settles in over 180ms (`cubic-bezier(0.16, 1, 0.3, 1)`), from 6px below at 98.5% scale and transparent.
- The hint fades in over 220ms.
- Re-renders while the overlay is open never replay these.
- A quick tap (released within 110ms) switches without drawing anything.
- Under reduced motion none of this runs: no settle-in, no fade, no selection transition, a steady caret and a still dotted ring.

## Do's and Don'ts

### Do:

- **Do** keep recency order; status never reorders rows.
- **Do** mark selection with the neutral fill and 1px inset ring (thumbnails), or the blue tint and border (list).
- **Do** use Paseo's status words and hues: blue running ring, amber needs input, red failed, green finished, purple merged.
- **Do** use Lucide stroke icons (24-unit box, 2px stroke, drawn at 13px in meta and 16px in the query) for PR state, checks, unpushed commits and search, and keycaps for keys.
- **Do** keep the query header inside the same sheet, so typing never moves the panel.
- **Do** show only the keys that work in the current state.
- **Do** fall back to the list, switch to "Tap a workspace to switch" below 600px or on a coarse pointer.
- **Do** keep the overlay to plain DOM under 200 elements, and leave the navigation path untouched: thumbnails rasterize only in idle time.
- **Do** honour reduced motion in every animation, including the sheet's settle-in.

### Don't:

- **Don't** use an accent anywhere in the overlay except the selected list row's tint and the running state.
- **Don't** sort, group or badge rows by status.
- **Don't** nest cards inside cards; rows and thumbnail cards sit directly on the sheet.
- **Don't** use glyph or emoji icons; arrows appear only as keycap labels.
- **Don't** truncate names or branches in the list; wrap them.
- **Don't** give a project its own hue.
- **Don't** add blur or a shadow to the hint pill; it is solid.
