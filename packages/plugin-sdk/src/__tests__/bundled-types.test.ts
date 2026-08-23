import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("bundled plugin SDK declarations", () => {
  it("use portable named SDK results without workspace imports", async () => {
    const declarations = await readFile(
      new URL("../../bundled-types/patcher-plugin-sdk.d.ts", import.meta.url),
      "utf8",
    );

    expect(declarations).not.toMatch(/from ['"]@patcher\//u);
    expect(declarations).not.toContain("PublicApiOutput");
    expect(declarations).not.toContain("PublicApiSchema");
    expect(declarations).toContain("type ThreadSpawnResult = ThreadResponse;");
    expect(declarations).toContain(
      "type FileReadResult = HostFileReadResponse;",
    );
    expect(declarations).toContain("type ProjectGetResult = ProjectResponse;");
    expect(declarations).toContain(
      "type ProjectAttachmentUploadResult = UploadedPromptAttachment;",
    );
    expect(declarations).toContain(
      "upload(args: ProjectAttachmentUploadArgs): Promise<ProjectAttachmentUploadResult>;",
    );
    expect(declarations).toContain(
      "type EnvironmentStatusResult = EnvironmentStatusResponse;",
    );
    expect(declarations).toContain("interface PluginCatalogArea");
    expect(declarations).toContain("catalog: PluginCatalogArea;");
    expect(declarations).toContain("getSource(args: PluginGetSourceArgs)");
    expect(declarations).toContain("checkUpdates(");
    expect(declarations).toContain("applyUpdate(args: PluginIdArgs)");

    const appDeclarations = await readFile(
      new URL(
        "../../bundled-types/patcher-plugin-sdk-app.d.ts",
        import.meta.url,
      ),
      "utf8",
    );
    expect(appDeclarations).not.toContain("PluginCatalogArea");
    expect(appDeclarations).not.toContain("applyUpdate(args: PluginIdArgs)");
    expect(declarations).toContain(
      "list(args?: ProviderListArgs): Promise<ProviderListResult>;",
    );
    expect(declarations).toContain(
      "models(args?: ProviderModelsArgs): Promise<ProviderModelsResult>;",
    );
    expect(declarations).toContain("interface TerminalsArea");
    expect(declarations).toContain("terminals: TerminalsArea;");
    expect(declarations).toContain(
      "type TerminalListResult = TerminalListResponse;",
    );
    expect(declarations).toContain(
      "rename(args: TerminalRenameArgs): Promise<TerminalRenameResult>;",
    );
    expect(declarations).not.toContain("ThreadTerminalsArea");
    expect(declarations).not.toContain("threads.terminals");
  });

  it("ships portable declarations for every exported subpath", async () => {
    const fileNames = [
      "patcher-plugin-sdk.d.ts",
      "patcher-plugin-sdk-app.d.ts",
      "patcher-plugin-sdk-testing.d.ts",
      "patcher-plugin-sdk-testing-app.d.ts",
    ];
    const declarations = await Promise.all(
      fileNames.map((fileName) =>
        readFile(
          new URL(`../../bundled-types/${fileName}`, import.meta.url),
          "utf8",
        ),
      ),
    );
    for (const content of declarations.slice(0, 2)) {
      expect(content).not.toMatch(/from ['"]@patcher\//u);
      expect(content).not.toMatch(/import\(['"]@patcher\//u);
    }
    for (const content of declarations.slice(2)) {
      const patcherImports = [
        ...content.matchAll(/from ['"](@patcher\/[^'"]+)['"]/gu),
      ].map((match) => match[1]);
      expect(new Set(patcherImports)).toEqual(new Set(["@patcher/plugin-sdk"]));
      expect(content).not.toContain("@patcher/sdk");
      expect(content).not.toContain("@patcher/server-contract");
    }
    expect(declarations[2]).toContain("interface FakePluginBehaviorDrivers");
    expect(declarations[3]).toContain(
      "interface RenderedSlotLifecycleControls",
    );
  });
});
