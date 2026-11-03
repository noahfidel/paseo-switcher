Arc-style workspace switching for the Paseo desktop app. Hold Ctrl and tap Tab to step through your most recently used workspaces, shown as a list with each one's full name, branch, pull request and agent status. Release Ctrl to switch. A quick Ctrl+Tab flips straight back to the previous workspace without drawing anything.

## Keys

- Ctrl+Tab / Ctrl+Shift+Tab: open the switcher and move forward or back
- Release Ctrl: switch to the selected workspace
- Arrow keys move, Enter switches, 1 to 9 jump straight to a card, Esc cancels
- Hovering a card selects it and clicking switches to it

The Command Center also has **Switch workspace (Ctrl+Tab)**, which opens the same switcher and waits for Enter or a click. Use it in a browser tab, where the browser keeps Ctrl+Tab for itself.

## Settings

**Settings → Plugins → Workspace Switcher** has two settings, saved on each device along with the visit order:

- **Layout**: **List** (the default) shows each workspace's full name, project, branch, pull request and checks, diff stat, unpushed commits, and what its agent is doing and for how long. It takes no thumbnails, so the plugin does no background work at all. **Thumbnails** shows a row of cards with a preview of each workspace instead.
- **Workspaces shown**: how many recent workspaces appear, 2 to 9, default 5.

## Cards

The switcher shows your most recently visited workspaces. Until you have visited enough of them, the rest fill in by latest activity. Agent status is marked when an agent is running (blue), waiting on you (amber), or failed (red).

In the Thumbnails layout, thumbnails are small images of the workspace view, focused on the conversation. While you stay in a workspace, the plugin refreshes its thumbnail every couple of seconds when the browser is idle. It never does this work while you are switching. Thumbnails are kept in memory only, so a workspace you have not opened since the app started shows its project initial instead. Terminals, embedded previews and images loaded from the web appear blank in thumbnails.

## Limits

This plugin reads Paseo's page structure, which is not a public plugin API. It is pinned to Paseo 0.15 and may need an update when Paseo changes. It does nothing on iOS and Android.
