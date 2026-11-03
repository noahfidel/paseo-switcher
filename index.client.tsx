import type { PluginClientContext } from "@getpaseo/plugin/client";
import { Platform } from "react-native";
import { makeSettings } from "./client/settings";
import { installSwitcher } from "./client/switcher";

export default function contribute(client: PluginClientContext) {
  // Ctrl+Tab only reaches the page in the desktop app (and the web app outside a browser tab).
  if (Platform.OS !== "web") return () => {};
  const switcher = installSwitcher(client.paseo);
  const removers = [
    client.addSettingsScreen({
      id: "switcher",
      title: "Workspace Switcher",
      icon: "GalleryHorizontal",
      Component: makeSettings(switcher),
    }),
    client.addCommandCenterItem({
      id: "switch-workspace",
      title: "Switch workspace (Ctrl+Tab)",
      icon: "GalleryHorizontal",
      keywords: ["workspace", "switch", "recent", "tab", "arc"],
      context: "global",
      onSelect() {
        switcher.open();
      },
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
    for (const remove of removers) remove();
    switcher.dispose();
  };
}
