import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsSection, SettingsSelect } from "@getpaseo/plugin/client/ui";
import { useState, type ComponentType } from "react";
import { MAX_LIMIT, MIN_LIMIT, type Layout } from "./model";
import type { Switcher } from "./switcher";

const OPTIONS = Array.from({ length: MAX_LIMIT - MIN_LIMIT + 1 }, (_, i) => {
  const value = String(MIN_LIMIT + i);
  return { label: value, value };
});

const LAYOUTS: Array<{ label: string; value: Layout }> = [
  { label: "List", value: "list" },
  { label: "Thumbnails", value: "strip" },
];

export function makeSettings(switcher: Switcher): ComponentType<PluginSurfaceProps> {
  return function SwitcherSettings() {
    const [limit, setLimit] = useState(String(switcher.getLimit()));
    const [layout, setLayout] = useState<Layout>(switcher.getLayout());
    return (
      <SettingsSection title="Switcher">
        <SettingsCard>
          <SettingsSelect
            label="Layout"
            hint="List shows full names, branches, pull requests and agent status. Thumbnails shows a row of workspace previews, which the plugin snapshots in the background."
            value={layout}
            options={LAYOUTS}
            onValueChange={(value) => {
              switcher.setLayout(value as Layout);
              setLayout(switcher.getLayout());
            }}
          />
          <SettingsSelect
            label="Workspaces shown"
            hint="How many of your most recently used workspaces Ctrl+Tab shows. Saved on this device."
            value={limit}
            options={OPTIONS}
            onValueChange={(value) => {
              switcher.setLimit(Number(value));
              setLimit(String(switcher.getLimit()));
            }}
          />
        </SettingsCard>
      </SettingsSection>
    );
  };
}
