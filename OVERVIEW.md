Arc-style workspace switching for the Paseo desktop app. Hold Cmd and tap ` (the default shortcut) to step through your most recently used workspaces, shown as a list with each one's full name, branch, pull request and agent status. Release Cmd to switch. A quick tap of the shortcut flips straight back to the previous workspace without drawing anything. Start typing while it is open to find any workspace by name, project, branch or pull request number.

## Keys

- Cmd+` / Cmd+Shift+`: open the switcher and move forward or back (or Ctrl+Tab, Option+Tab or Ctrl+`, see the Shortcut setting)
- Release the modifier (Cmd, or Ctrl or Option for the other shortcuts): switch to the selected workspace
- Arrow keys move, Enter switches, 1 to 9 jump straight to a row, Esc cancels
- Typing filters all workspaces and keeps the switcher open until Enter or a click; Esc clears the filter
- Hovering a row selects it and clicking switches to it

The Command Center also has **Switch workspace (Cmd+`)**, which (its title shows the shortcut you chose) opens the same switcher and waits for Enter or a click. Use it in a browser tab, where the browser keeps Ctrl+Tab for itself, or in a phone browser, where a tap switches.

## Settings

**Settings → Plugins → Workspace Switcher** has five settings, saved on each device along with the visit history:

- **Layout**: **List** (the default) shows each workspace's full name, project, branch, pull request and checks, diff stat, unpushed commits, and what its agent is doing and for how long. It takes no thumbnails, so the plugin's only background work is noting which chat tab you are on and, with messages counted as visits, refreshing the agent list every 5 seconds in idle time. **Thumbnails** shows a row of cards with a preview of each workspace instead.
- **Shortcut**: **Cmd+`** (the default), **Ctrl+Tab**, **Option+Tab** or **Ctrl+`**. Hold the modifier, tap the key to open and step forward, add Shift to step back, and release the modifier to switch. On macOS, turn off the system's "Move focus to next window" shortcut (System Settings → Keyboard → Keyboard Shortcuts → Keyboard), which otherwise keeps Cmd+` for itself. Ctrl+Tab suits Windows and Linux; macOS keeps it for switching apps. Paseo uses Ctrl+` itself (Toggle Explorer sidebar), so Ctrl+` is only for when you have unbound that. Keys are matched by physical position, so the shortcut works on any keyboard layout.
- **Workspaces shown**: how many recent workspaces appear, 2 to 9, default 5.
- **Include background workspaces**: on by default. Also lists workspaces hidden from the sidebar, marked "hidden". Your sidebar is unchanged. Hosts that do not support background workspaces keep the sidebar's list.
- **Count chats you message as visits**: on by default. A workspace you send a message to ranks as if you had just opened it, even when you messaged it from a screen outside it, such as a bot chat. Chats a paseo-bots routine or another bot starts do not count until you reply to them. Off, only opening a workspace counts. Hidden workspaces still appear only with **Include background workspaces** on.

Switching to a workspace that has no sidebar row (a hidden one, or one in a collapsed project) reopens whichever is newer: the chat you last had open there, or the chat you last sent a message to (including one used from the Bots screen). If neither exists, it opens the most recently active chat that was not started by a routine, ask or PR review watcher. Workspaces in the sidebar open the way a sidebar click does.

## Cards

The switcher shows your most recently visited workspaces, where a visit is opening a workspace or, by default, sending it a message. Until you have visited enough of them, the rest fill in by latest activity. Agent status follows Paseo's sidebar: a turning ring while an agent runs, amber when it needs input, red when it failed, and green when it finished and you have not looked yet.

In the Thumbnails layout, thumbnails are small images of the workspace view, focused on the conversation. While you stay in a workspace, the plugin refreshes its thumbnail every couple of seconds when the browser is idle. It never does this work while you are switching. Thumbnails are kept in memory only, so a workspace you have not opened since the app started shows "No preview yet" instead. Terminals, embedded previews and images loaded from the web appear blank in thumbnails.

## Limits

This plugin reads Paseo's page structure, which is not a public plugin API. It is pinned to Paseo 0.15 and may need an update when Paseo changes. It does nothing on iOS and Android.
