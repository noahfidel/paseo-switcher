import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useState, type ComponentType } from "react";
import { MAX_LIMIT, MIN_LIMIT, SHORTCUTS, type Layout, type Shortcut } from "./model";
import type { Switcher } from "./switcher";

const OPTIONS = Array.from({ length: MAX_LIMIT - MIN_LIMIT + 1 }, (_, i) => {
  const value = String(MIN_LIMIT + i);
  return { label: value, value };
});

const LAYOUTS: Array<{ label: string; value: Layout }> = [
  { label: "List", value: "list" },
  { label: "Thumbnails", value: "strip" },
];

const SHORTCUT_OPTIONS = (Object.keys(SHORTCUTS) as Shortcut[]).map((value) => ({
  // Paseo binds Ctrl+` itself (Toggle Explorer sidebar), so the two would fight over the key.
  label: value === "ctrl-backquote" ? `${SHORTCUTS[value].label} (conflicts with Paseo)` : SHORTCUTS[value].label,
  value,
}));

export function makeSettings(switcher: Switcher): ComponentType<PluginSurfaceProps> {
  return function SwitcherSettings() {
    const [limit, setLimit] = useState(String(switcher.getLimit()));
    const [layout, setLayout] = useState<Layout>(switcher.getLayout());
    const [shortcut, setShortcut] = useState<Shortcut>(switcher.getShortcut());
    const [includeBackground, setIncludeBackground] = useState(switcher.getIncludeBackground());
    return (
      <SettingsSection title="Switcher">
        <SettingsCard>
          <SettingsSelect
            label="Layout"
            hint="List: full names, branches, pull requests and agent status. Thumbnails: a preview of each workspace, refreshed in idle time."
            value={layout}
            options={LAYOUTS}
            onValueChange={(value) => {
              switcher.setLayout(value as Layout);
              setLayout(switcher.getLayout());
            }}
          />
          <SettingsSelect
            label="Shortcut"
            hint="Hold the modifier and tap the key to open and step through workspaces; Shift goes back and releasing the modifier switches. Pick one your system does not already use."
            value={shortcut}
            options={SHORTCUT_OPTIONS}
            onValueChange={(value) => {
              switcher.setShortcut(value as Shortcut);
              setShortcut(switcher.getShortcut());
            }}
          />
          <SettingsSelect
            label="Workspaces shown"
            hint="How many recent workspaces the shortcut shows. Type while it is open to search all of them."
            value={limit}
            options={OPTIONS}
            onValueChange={(value) => {
              switcher.setLimit(Number(value));
              setLimit(String(switcher.getLimit()));
            }}
          />
          <SettingsSwitch
            label="Include background workspaces"
            hint="Also list workspaces hidden from the sidebar. Your sidebar is unchanged."
            value={includeBackground}
            onValueChange={(value) => {
              switcher.setIncludeBackground(value);
              setIncludeBackground(switcher.getIncludeBackground());
            }}
          />
        </SettingsCard>
      </SettingsSection>
    );
  };
}
