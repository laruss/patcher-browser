import type { PatcherPluginApi } from "@patcher/plugin-sdk";
import {
  resolveWorkflowSource,
  type ResolvedWorkflowSource,
  type WorkflowSourceContext,
  type WorkflowSourceInput,
} from "./source-resolution.js";
import {
  validateWorkflowSource,
  type WorkflowValidationSummary,
} from "./workflow-validation.js";

export interface PreparedWorkflowSource extends ResolvedWorkflowSource {
  validation: WorkflowValidationSummary;
}

export async function prepareWorkflowSource(
  patcher: PatcherPluginApi,
  context: WorkflowSourceContext,
  input: WorkflowSourceInput,
): Promise<PreparedWorkflowSource> {
  const resolved = await resolveWorkflowSource(input, context, {
    async getThreadEnvironmentId(threadId) {
      const thread = await patcher.sdk.threads.get({ threadId });
      return thread.environmentId;
    },
    async getEnvironment(environmentId) {
      const environment = await patcher.sdk.environments.get({ environmentId });
      return {
        id: environment.id,
        projectId: environment.projectId,
        hostId: environment.hostId,
        path: environment.path,
      };
    },
    readFile(input) {
      return patcher.sdk.files.read(input);
    },
  });
  const validation = await validateWorkflowSource(
    resolved.source,
    resolved.environmentId,
    {
      listProviders(environmentId) {
        return patcher.sdk.providers.list({ environmentId });
      },
      loadModels(environmentId, providerId) {
        return patcher.sdk.providers.models({ environmentId, providerId });
      },
    },
  );
  return { ...resolved, validation };
}
