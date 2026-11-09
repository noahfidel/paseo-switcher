import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createKnownRoots, paseoRoots } from "./server/known-roots";
import { createProjectIconResolver } from "./server/repo-icon";
import { projectIcon } from "./shared/icons";

export default function contribute(server: PluginServerContext) {
  const icons = createProjectIconResolver();
  const known = createKnownRoots();
  // Only a directory Paseo lists as a project or workspace is searched.
  server.handle(projectIcon, ({ rootPath }, { paseo }) =>
    icons.resolve(rootPath, { isKnownRoot: (root) => known.has(root, () => paseoRoots(paseo)) }),
  );
  return () => {};
}
