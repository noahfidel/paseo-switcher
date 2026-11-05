Arc-style workspace switching for the Paseo desktop app. Hold Ctrl and tap ` (the default shortcut) to step through your most recently used workspaces, shown as a list with each one's full name, branch, pull request and agent status. Release Ctrl to switch. A quick tap of the shortcut flips straight back to the previous workspace without drawing anything. Start typing while it is open to find any workspace by name, project, branch or pull request number.

## Keys

- Ctrl+` / Ctrl+Shift+`: open the switcher and move forward or back (or Ctrl+Tab or Option+Tab, see the Shortcut setting)
- Release the modifier (Ctrl, or Option for Option+Tab): switch to the selected workspace
- Arrow keys move, Enter switches, 1 to 9 jump straight to a row, Esc cancels
- Typing filters all workspaces and keeps the switcher open until Enter or a click; Esc clears the filter
- Hovering a row selects it and clicking switches to it

The Command Center also has **Switch workspace (Ctrl+`)**, which (its title shows the shortcut you chose) opens the same switcher and waits for Enter or a click. Use it in a browser tab, where the browser keeps Ctrl+Tab for itself, or in a phone browser, where a tap switches.

## Settings

**Settings → Plugins → Workspace Switcher** has three settings, saved on each device along with the visit order:

- **Layout**: **List** (the default) shows each workspace's full name, project, branch, pull request and checks, diff stat, unpushed commits, and what its agent is doing and for how long. It takes no thumbnails, so the plugin does no background work at all. **Thumbnails** shows a row of cards with a preview of each workspace instead.
- **Shortcut**: **Ctrl+`** (the default), **Ctrl+Tab** or **Option+Tab**. Hold the modifier, tap the key to open and step forward, add Shift to step back, and release the modifier to switch. Ctrl+Tab suits Windows and Linux; on macOS the system keeps Ctrl+Tab for switching apps, which is why the default is Ctrl+`. Keys are matched by physical position, so the shortcut works on any keyboard layout.
- **Workspaces shown**: how many recent workspaces appear, 2 to 9, default 5.

## Cards

The switcher shows your most recently visited workspaces. Until you have visited enough of them, the rest fill in by latest activity. Agent status follows Paseo's sidebar: a turning ring while an agent runs, amber when it needs input, red when it failed, and green when it finished and you have not looked yet.

In the Thumbnails layout, thumbnails are small images of the workspace view, focused on the conversation. While you stay in a workspace, the plugin refreshes its thumbnail every couple of seconds when the browser is idle. It never does this work while you are switching. Thumbnails are kept in memory only, so a workspace you have not opened since the app started shows "No preview yet" instead. Terminals, embedded previews and images loaded from the web appear blank in thumbnails.

## Limits

This plugin reads Paseo's page structure, which is not a public plugin API. It is pinned to Paseo 0.15 and may need an update when Paseo changes. It does nothing on iOS and Android.
