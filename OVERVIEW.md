Arc-style workspace switching for the Paseo desktop app. Hold Ctrl and tap Tab to step through your most recently used workspaces, shown as a strip of cards with a thumbnail of how you left each one. Release Ctrl to switch. A quick Ctrl+Tab flips straight back to the previous workspace without drawing anything.

## Keys

- Ctrl+Tab / Ctrl+Shift+Tab: open the switcher and move forward or back
- Release Ctrl: switch to the selected workspace
- Arrow keys move, Enter switches, 1 to 9 jump straight to a card, Esc cancels
- Hovering a card selects it and clicking switches to it

The Command Center also has **Switch workspace (Ctrl+Tab)**, which opens the same strip and waits for Enter or a click. Use it in a browser tab, where the browser keeps Ctrl+Tab for itself.

## Settings

**Settings → Plugins → Workspace Switcher → Workspaces shown** sets how many recent workspaces the strip shows: 2 to 9, default 5. The value is saved on each device, along with the visit order.

## Cards

Cards are your most recently visited workspaces. Until you have visited enough of them, the rest fill in by latest activity. Each card shows the workspace name, project, branch, diff stat, and a dot when an agent is running (blue), waiting on you (amber), or failed (red).

Thumbnails are small images of the workspace view, focused on the conversation. While you stay in a workspace, the plugin refreshes its thumbnail every couple of seconds when the browser is idle. It never does this work while you are switching. Thumbnails are kept in memory only, so a workspace you have not opened since the app started shows its project initial instead. Terminals, embedded previews and images loaded from the web appear blank in thumbnails.

## Limits

This plugin reads Paseo's page structure, which is not a public plugin API. It is pinned to Paseo 0.15 and may need an update when Paseo changes. It does nothing on iOS and Android.
