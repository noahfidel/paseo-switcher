import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createKnownRoots, paseoRoots } from "./server/known-roots";
import { createProjectIconResolver } from "./server/repo-icon";
import { projectIcon } from "./shared/icons";

export default function contribute(server: PluginServerContext) {
  const icons = createProjectIconResolver();
  const known = createKnownRoots();
  server.handle(projectIcon, async ({ rootPath }, { paseo }) => ({
    // Only a directory Paseo lists as a project or workspace is searched.
    icon: await icons.get(rootPath, { isKnownRoot: (root) => known.has(root, () => paseoRoots(paseo)) }),
  }));
  return () => {};
}
