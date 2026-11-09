import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Image types a project icon may have; the client draws each as an img. */
export const PROJECT_ICON_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml", "image/x-icon"] as const;

/** A repository's icon (an icon file in the repo, else its GitHub owner's avatar), or null. */
export const projectIcon = defineRpc({
  name: "icons.project",
  input: z.object({ rootPath: z.string().min(1).max(4096) }),
  output: z.object({
    icon: z
      .object({
        mimeType: z.enum(PROJECT_ICON_TYPES),
        // 64 KB of bytes as base64.
        dataBase64: z.string().max(90_000),
      })
      .nullable(),
  }),
});
