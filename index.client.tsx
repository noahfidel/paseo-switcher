import { getPaseoClient, type PluginClientContext } from "@getpaseo/plugin/client";
import { Platform } from "react-native";
import { makeSettings } from "./client/settings";
import { SHORTCUTS } from "./client/model";
import { installSwitcher } from "./client/switcher";
import { projectIcon } from "./shared/icons";

export default function contribute(client: PluginClientContext) {
  // The shortcut only reaches the page in the desktop app (and the web app outside a browser tab).
  if (Platform.OS !== "web") return () => {};
  // Paseo runs this once per connected host; the switcher reads every host through getPaseoClient.
  const switcher = installSwitcher(client.paseo, {
    projectIcon: (rootPath) => client.rpc(projectIcon, { rootPath }),
    getPaseoClient: typeof getPaseoClient === "function" ? getPaseoClient : undefined,
  });
  const switchItem = () =>
    client.addCommandCenterItem({
      id: "switch-workspace",
      title: `Switch workspace (${SHORTCUTS[switcher.getShortcut()].label})`,
      icon: "GalleryHorizontal",
      keywords: ["workspace", "switch", "recent", "tab", "arc"],
      context: "global",
      onSelect() {
        switcher.open();
      },
    });
  let removeSwitchItem = switchItem();
  // The title names the shortcut, so register it again when the setting changes.
  const stopListening = switcher.onShortcutChange(() => {
    removeSwitchItem();
    removeSwitchItem = switchItem();
  });
  const removers = [
    client.addSettingsScreen({
      id: "switcher",
      title: "Workspace Switcher",
      icon: "GalleryHorizontal",
      Component: makeSettings(switcher),
    }),
    client.addCommandCenterItem({
      id: "switcher-settings",
      title: "Workspace Switcher: settings",
      icon: "Settings",
      keywords: ["workspace", "switcher", "limit", "recent"],
      context: "global",
      onSelect({ openSettings }) {
        openSettings("switcher");
      },
    }),
  ];
  return () => {
    stopListening();
    removeSwitchItem();
    for (const remove of removers) remove();
    switcher.dispose();
  };
}
