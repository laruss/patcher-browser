import { z } from "zod";
import {
  normalizePluginSitePattern,
  PLUGIN_SITE_PATTERN_MAX_COUNT,
} from "./browser-url-pattern.js";
import { pluginPermissionSchema } from "./plugin-permission-schema.js";

const requiredManifestString = z.string().trim().min(1);

/**
 * `patcher.branding.icon` accepts either a host icon name or an explicit
 * plugin-relative compact SVG path.
 */
export function isPluginOwnedIconPath(icon: string): boolean {
  return icon.startsWith("./");
}

export const pluginBrandingSchema = z
  .object({
    icon: requiredManifestString.optional(),
    logo: z
      .object({
        light: requiredManifestString,
        dark: requiredManifestString.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((branding, context) => {
    if (
      branding.icon !== undefined &&
      isPluginOwnedIconPath(branding.icon) &&
      !branding.icon.toLowerCase().endsWith(".svg")
    ) {
      context.addIssue({
        code: "custom",
        path: ["icon"],
        message:
          'plugin-owned branding.icon paths must point at an .svg file (for example "./assets/icon.svg")',
      });
    }
  })
  .refine(
    (branding) => branding.icon !== undefined || branding.logo !== undefined,
    {
      message: "must declare at least branding.icon or branding.logo.light",
    },
  );

export const pluginPatcherManifestSchema = z
  .object({
    name: requiredManifestString,
    description: requiredManifestString,
    branding: pluginBrandingSchema,
    server: requiredManifestString,
    app: requiredManifestString.optional(),
    /**
     * What this plugin may reach. Absent or empty means it reaches nothing
     * gated — see {@link PLUGIN_PERMISSIONS} for why there is no "everything"
     * default and for what these can and cannot enforce.
     */
    permissions: z.array(pluginPermissionSchema).optional(),
    /**
     * Which sites this plugin's page contributions may reach, as URL globs
     * (`https://github.com/**`). Absent or empty means none, so a plugin holding
     * `pageStyle.register` and no sites reaches no page at all.
     *
     * Separate from `permissions` because it answers a different question —
     * *where*, not *what* — and because it is the line the user reads before
     * installing. `https` only, except loopback over plain http.
     *
     * Not to be confused with `patcher.sdk.hosts`, which is the enrolled
     * machines a plugin can reach; these are websites.
     */
    sites: z.array(z.string()).optional(),
    skills: z.array(requiredManifestString).optional(),
    themes: z
      .array(
        z
          .object({
            id: z
              .string()
              .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
              .max(64),
            name: requiredManifestString,
            description: requiredManifestString.optional(),
            css: requiredManifestString,
          })
          .strict(),
      )
      .optional(),
  })
  .strict()
  .superRefine((patcher, context) => {
    if (patcher.sites === undefined) return;
    if (patcher.sites.length > PLUGIN_SITE_PATTERN_MAX_COUNT) {
      context.addIssue({
        code: "custom",
        path: ["sites"],
        message: `declares more than ${PLUGIN_SITE_PATTERN_MAX_COUNT} site patterns; a list this long is not something a user can consent to`,
      });
    }
    patcher.sites.forEach((pattern, index) => {
      const normalized = normalizePluginSitePattern(pattern);
      if (normalized === null) {
        context.addIssue({
          code: "custom",
          path: ["sites", index],
          message: `${JSON.stringify(pattern)} is not a site pattern this plugin may declare — use an https URL glob such as "https://github.com/**" (plain http only for loopback)`,
        });
        return;
      }
      if (normalized !== pattern) {
        // Refused rather than quietly corrected: matching is case-sensitive and
        // a URL never arrives with an upper-case host, so this pattern would be
        // shown to the user at install and then claim no page at all. And it
        // cannot be corrected here, because a registration's `matches` has to
        // equal the declared string verbatim.
        context.addIssue({
          code: "custom",
          path: ["sites", index],
          message: `${JSON.stringify(pattern)} would match no page — write the host in lower case (${JSON.stringify(normalized)})`,
        });
      }
    });
  });

export const pluginPackageJsonSchema = z
  .object({
    name: requiredManifestString,
    version: requiredManifestString,
    engines: z
      .object({
        patcher: requiredManifestString.optional(),
        patcherPluginSdk: requiredManifestString.optional(),
      })
      .optional(),
    patcher: pluginPatcherManifestSchema,
  })
  .passthrough();

export type PluginPackageJson = z.infer<typeof pluginPackageJsonSchema>;
