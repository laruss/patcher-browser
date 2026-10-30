import { definePluginApp } from "@patcher/plugin-sdk/app";

// Core owns the macOS menu, manager page and form integration. The plugin is
// the user's single enable/disable switch; it contributes no per-site button.
export default definePluginApp(() => {});
