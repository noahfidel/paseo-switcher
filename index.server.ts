import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createProjectIconResolver } from "./server/repo-icon";
import { projectIcon } from "./shared/icons";

export default function contribute(server: PluginServerContext) {
  const icons = createProjectIconResolver();
  server.handle(projectIcon, async ({ rootPath }) => ({ icon: await icons.get(rootPath) }));
  return () => {};
}
