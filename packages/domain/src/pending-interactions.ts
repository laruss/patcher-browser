import { z } from "zod";
import { PLUGIN_INTERACTION_MAX_TITLE_LENGTH } from "./plugin-interaction-limits.js";

export { PLUGIN_INTERACTION_MAX_TITLE_LENGTH };
import { jsonValueSchema } from "./json-value.js";

export const pendingInteractionStatusSchema = z.enum([
  "pending",
  "resolving",
  "resolved",
  "interrupted",
]);
export type PendingInteractionStatus = z.infer<
  typeof pendingInteractionStatusSchema
>;

export const pendingInteractionCommandActionSchema = z.discriminatedUnion(
  "type",
  [
    z.object({
      type: z.literal("read"),
      command: z.string(),
      name: z.string(),
      path: z.string(),
    }),
    z.object({
      type: z.literal("listFiles"),
      command: z.string(),
      path: z.string().nullable(),
    }),
    z.object({
      type: z.literal("search"),
      command: z.string(),
      query: z.string().nullable(),
      path: z.string().nullable(),
    }),
    z.object({
      type: z.literal("unknown"),
      command: z.string(),
    }),
  ],
);
export type PendingInteractionCommandAction = z.infer<
  typeof pendingInteractionCommandActionSchema
>;

export const pendingInteractionNetworkPermissionsSchema = z.object({
  enabled: z.boolean().nullable(),
});

export const pendingInteractionFileSystemPermissionsSchema = z.object({
  read: z.array(z.string()),
  write: z.array(z.string()),
});

const pendingInteractionMacOsPreferencesPermissionSchema = z.enum([
  "none",
  "read_only",
  "read_write",
]);

const pendingInteractionMacOsContactsPermissionSchema = z.enum([
  "none",
  "read_only",
  "read_write",
]);

const pendingInteractionMacOsAutomationPermissionSchema = z.union([
  z.literal("none"),
  z.literal("all"),
  z.object({
    kind: z.literal("bundle_ids"),
    bundleIds: z.array(z.string()),
  }),
]);

export const pendingInteractionMacOsPermissionsSchema = z.object({
  preferences: pendingInteractionMacOsPreferencesPermissionSchema,
  automations: pendingInteractionMacOsAutomationPermissionSchema,
  launchServices: z.boolean(),
  accessibility: z.boolean(),
  calendar: z.boolean(),
  reminders: z.boolean(),
  contacts: pendingInteractionMacOsContactsPermissionSchema,
});
export type PendingInteractionMacOsPermissions = z.infer<
  typeof pendingInteractionMacOsPermissionsSchema
>;

export const pendingInteractionRequestedPermissionProfileSchema = z.object({
  network: pendingInteractionNetworkPermissionsSchema.nullable(),
  fileSystem: pendingInteractionFileSystemPermissionsSchema.nullable(),
  macos: pendingInteractionMacOsPermissionsSchema.nullable(),
});
export type PendingInteractionRequestedPermissionProfile = z.infer<
  typeof pendingInteractionRequestedPermissionProfileSchema
>;

export const pendingInteractionGrantablePermissionProfileSchema = z
  .object({
    network: pendingInteractionNetworkPermissionsSchema.nullable(),
    fileSystem: pendingInteractionFileSystemPermissionsSchema.nullable(),
  })
  .strict();
export type PendingInteractionGrantablePermissionProfile = z.infer<
  typeof pendingInteractionGrantablePermissionProfileSchema
>;

const pendingInteractionGrantedPermissionProfileSchema =
  pendingInteractionGrantablePermissionProfileSchema;
export type PendingInteractionGrantedPermissionProfile = z.infer<
  typeof pendingInteractionGrantedPermissionProfileSchema
>;

export const pendingInteractionApprovalDecisionSchema = z.enum([
  "allow_once",
  "allow_for_session",
  "deny",
]);
export type PendingInteractionApprovalDecision = z.infer<
  typeof pendingInteractionApprovalDecisionSchema
>;

export const pendingInteractionFileChangeWriteScopeSchema = z.string().min(1);

export const pendingInteractionCommandApprovalSubjectSchema = z.object({
  kind: z.literal("command"),
  itemId: z.string().min(1),
  command: z.string().min(1),
  cwd: z.string().nullable(),
  actions: z.array(pendingInteractionCommandActionSchema),
  sessionGrant: pendingInteractionGrantablePermissionProfileSchema.nullable(),
});

export const pendingInteractionFileChangeApprovalSubjectSchema = z.object({
  kind: z.literal("file_change"),
  itemId: z.string().min(1),
  writeScope: pendingInteractionFileChangeWriteScopeSchema.nullable(),
  sessionGrant: pendingInteractionGrantablePermissionProfileSchema.nullable(),
});

export const pendingInteractionPermissionGrantApprovalSubjectSchema = z.object({
  kind: z.literal("permission_grant"),
  itemId: z.string().min(1),
  toolName: z.string().nullable(),
  permissions: pendingInteractionGrantablePermissionProfileSchema,
});
export type PendingInteractionPermissionGrantApprovalSubject = z.infer<
  typeof pendingInteractionPermissionGrantApprovalSubjectSchema
>;

/**
 * A finished plan waiting for the user's verdict before the agent may act on
 * it. Unlike the other subjects this grants no permission: the decision only
 * says whether the agent leaves plan mode and starts the work.
 */
export const pendingInteractionPlanApprovalSubjectSchema = z.object({
  kind: z.literal("plan"),
  itemId: z.string().min(1),
  /** The plan body, as Markdown. */
  plan: z.string().min(1),
  /** Where the provider saved the plan, or null when it kept it in memory. */
  planFilePath: z.string().min(1).nullable(),
});
export type PendingInteractionPlanApprovalSubject = z.infer<
  typeof pendingInteractionPlanApprovalSubjectSchema
>;

export const pendingInteractionApprovalSubjectSchema = z.discriminatedUnion(
  "kind",
  [
    pendingInteractionCommandApprovalSubjectSchema,
    pendingInteractionFileChangeApprovalSubjectSchema,
    pendingInteractionPermissionGrantApprovalSubjectSchema,
    pendingInteractionPlanApprovalSubjectSchema,
  ],
);
export type PendingInteractionApprovalSubject = z.infer<
  typeof pendingInteractionApprovalSubjectSchema
>;

export const approvalPendingInteractionPayloadSchema = z.object({
  kind: z.literal("approval"),
  subject: pendingInteractionApprovalSubjectSchema,
  reason: z.string().nullable(),
  availableDecisions: z.array(pendingInteractionApprovalDecisionSchema).min(1),
});
export type ApprovalPendingInteractionPayload = z.infer<
  typeof approvalPendingInteractionPayloadSchema
>;

export const USER_QUESTION_MAX_QUESTIONS = 4;
export const USER_QUESTION_MAX_OPTIONS = 4;
export const USER_QUESTION_MAX_SELECTED = 4;
export const USER_QUESTION_MAX_FREE_TEXT_LENGTH = 4096;

const pendingInteractionUserQuestionIdSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "User question ids cannot be blank",
  });

const pendingInteractionUserQuestionPromptSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "User question prompts cannot be blank",
  });

const pendingInteractionUserQuestionShortLabelSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "User question short labels cannot be blank",
  });

const pendingInteractionUserQuestionOptionValueSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "User question option values cannot be blank",
  });

const pendingInteractionUserQuestionOptionLabelSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "User question option labels cannot be blank",
  });

const pendingInteractionUserQuestionOptionDescriptionSchema = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, {
    message: "User question option descriptions cannot be blank",
  });

const pendingInteractionUserQuestionFreeTextSchema = z
  .string()
  .min(1)
  .max(
    USER_QUESTION_MAX_FREE_TEXT_LENGTH,
    `User question free text cannot exceed ${USER_QUESTION_MAX_FREE_TEXT_LENGTH} characters`,
  )
  .refine((value) => value.trim().length > 0, {
    message: "User question free text cannot be blank",
  });

export const pendingInteractionUserQuestionOptionSchema = z.object({
  value: pendingInteractionUserQuestionOptionValueSchema,
  label: pendingInteractionUserQuestionOptionLabelSchema,
  description: pendingInteractionUserQuestionOptionDescriptionSchema.optional(),
});
export type PendingInteractionUserQuestionOption = z.infer<
  typeof pendingInteractionUserQuestionOptionSchema
>;

export const pendingInteractionUserQuestionQuestionSchema = z
  .object({
    id: pendingInteractionUserQuestionIdSchema,
    prompt: pendingInteractionUserQuestionPromptSchema,
    shortLabel: pendingInteractionUserQuestionShortLabelSchema.optional(),
    multiSelect: z.boolean(),
    options: z
      .array(pendingInteractionUserQuestionOptionSchema)
      .max(
        USER_QUESTION_MAX_OPTIONS,
        `User questions cannot include more than ${USER_QUESTION_MAX_OPTIONS} options`,
      )
      .optional(),
    allowFreeText: z.boolean(),
  })
  .superRefine((question, context) => {
    const optionValues = new Set<string>();
    question.options?.forEach((option, index) => {
      if (optionValues.has(option.value)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "User question option values must be unique",
          path: ["options", index, "value"],
        });
        return;
      }
      optionValues.add(option.value);
    });
  })
  .refine(
    (question) => question.allowFreeText || (question.options?.length ?? 0) > 0,
    {
      message:
        "User questions must allow free text or provide at least one option",
      path: ["options"],
    },
  );
export type PendingInteractionUserQuestionQuestion = z.infer<
  typeof pendingInteractionUserQuestionQuestionSchema
>;

export const userQuestionPendingInteractionPayloadSchema = z
  .object({
    kind: z.literal("user_question"),
    questions: z
      .array(pendingInteractionUserQuestionQuestionSchema)
      .min(1)
      .max(
        USER_QUESTION_MAX_QUESTIONS,
        `User questions cannot include more than ${USER_QUESTION_MAX_QUESTIONS} questions`,
      ),
  })
  .superRefine((payload, context) => {
    const questionIds = new Set<string>();
    payload.questions.forEach((question, index) => {
      if (questionIds.has(question.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "User question ids must be unique",
          path: ["questions", index, "id"],
        });
        return;
      }
      questionIds.add(question.id);
    });
  });
export type UserQuestionPendingInteractionPayload = z.infer<
  typeof userQuestionPendingInteractionPayloadSchema
>;

export const pluginPendingInteractionPayloadSchema = z.object({
  kind: z.literal("plugin"),
  title: z.string().trim().min(1).max(PLUGIN_INTERACTION_MAX_TITLE_LENGTH),
  data: jsonValueSchema,
});
export type PluginPendingInteractionPayload = z.infer<
  typeof pluginPendingInteractionPayloadSchema
>;

export const pendingInteractionConsentActionValues = [
  "enable",
  "disable",
  "install",
  "update",
  "remove",
  "configure",
  // Not a plugin action, and not necessarily one an agent asked for: the
  // repository's own `.patcher-env-setup.sh`, which the daemon runs on the host
  // outside any sandbox. Asked once per repository per script content, so a
  // script an agent committed cannot run on the strength of an older approval.
  "run-setup-script",
] as const;
export const pendingInteractionConsentActionSchema = z.enum(
  pendingInteractionConsentActionValues,
);
export type PendingInteractionConsentAction = z.infer<
  typeof pendingInteractionConsentActionSchema
>;

/**
 * Something waiting for the user to allow it, on a thread.
 *
 * Mostly a plugin change an agent asked for, raised by the server rather than
 * by a provider or a plugin: the CLI declares the thread it runs in, and a
 * declared thread is what turns a plugin mutation into a question. `subjectId`
 * is the plugin for every action but `install`, where it is the source being
 * installed and no plugin exists yet.
 *
 * The exception is `run-setup-script`, which the daemon asks for while it
 * provisions: there `subjectId` is the script's content hash and `subjectName`
 * its file name, and the person answering may well be the one who asked for the
 * worktree — the question is about the script's content, not about who typed.
 *
 * The permissions ride the payload rather than being looked up by whatever
 * renders it, because they are the reason to ask at all: whether this should be
 * allowed depends on them, and a card that omits them asks the user to consent
 * to nothing in particular.
 */
export const consentPendingInteractionPayloadSchema = z.object({
  kind: z.literal("consent"),
  action: pendingInteractionConsentActionSchema,
  subjectId: z.string().min(1).max(200),
  subjectName: z.string().min(1).max(200),
  permissions: z.array(z.string().min(1).max(100)).max(50),
  sites: z.array(z.string().min(1).max(255)).max(50),
  detail: z.string().min(1).max(500).nullable(),
});
export type ConsentPendingInteractionPayload = z.infer<
  typeof consentPendingInteractionPayloadSchema
>;

export const pendingInteractionPayloadSchema = z.discriminatedUnion("kind", [
  approvalPendingInteractionPayloadSchema,
  userQuestionPendingInteractionPayloadSchema,
]);
export type PendingInteractionPayload = z.infer<
  typeof pendingInteractionPayloadSchema
>;
export type AnyPendingInteractionPayload =
  | PendingInteractionPayload
  | PluginPendingInteractionPayload
  | ConsentPendingInteractionPayload;

export function isApprovalPendingInteractionPayload(
  payload: AnyPendingInteractionPayload,
): payload is ApprovalPendingInteractionPayload {
  return payload.kind === "approval";
}

export function isUserQuestionPendingInteractionPayload(
  payload: AnyPendingInteractionPayload,
): payload is UserQuestionPendingInteractionPayload {
  return payload.kind === "user_question";
}

export function isPluginPendingInteractionPayload(
  payload: AnyPendingInteractionPayload,
): payload is PluginPendingInteractionPayload {
  return payload.kind === "plugin";
}

const approvalDecisionDiscriminatorError =
  "Invalid discriminator value. Expected 'allow_once' | 'allow_for_session' | 'deny'";

export const approvalPendingInteractionResolutionSchema = z.discriminatedUnion(
  "decision",
  [
    z.object({
      decision: z.literal("allow_once"),
      grantedPermissions:
        pendingInteractionGrantedPermissionProfileSchema.nullable(),
    }),
    z.object({
      decision: z.literal("allow_for_session"),
      grantedPermissions:
        pendingInteractionGrantedPermissionProfileSchema.nullable(),
    }),
    z.object({
      decision: z.literal("deny"),
    }),
  ],
  approvalDecisionDiscriminatorError,
);
export type ApprovalPendingInteractionResolution = z.infer<
  typeof approvalPendingInteractionResolutionSchema
>;

export const pendingInteractionUserAnswerSchema = z.object({
  selected: z
    .array(z.string().min(1))
    .max(
      USER_QUESTION_MAX_SELECTED,
      `User question selected choices cannot exceed ${USER_QUESTION_MAX_SELECTED}`,
    ),
  freeText: pendingInteractionUserQuestionFreeTextSchema.optional(),
});
export type PendingInteractionUserAnswer = z.infer<
  typeof pendingInteractionUserAnswerSchema
>;

export const userQuestionPendingInteractionResolutionSchema = z.object({
  kind: z.literal("user_answer"),
  answers: z.record(z.string().min(1), pendingInteractionUserAnswerSchema),
});
export type UserQuestionPendingInteractionResolution = z.infer<
  typeof userQuestionPendingInteractionResolutionSchema
>;

export const pluginPendingInteractionResolutionSchema = z.object({
  kind: z.literal("plugin_submitted"),
});
export type PluginPendingInteractionResolution = z.infer<
  typeof pluginPendingInteractionResolutionSchema
>;

/**
 * Kept out of `pendingInteractionResolutionSchema` on purpose. That union
 * travels to the host daemon inside the `interactive.resolve` command, which
 * parses `.strict()`, and invariant 1 of docs/architecture/bb-migration.md
 * makes any change to that wire a protocol-version bump. A consent interaction
 * has no provider request, so no resolve command is ever sent for one: adding
 * it there would buy the bump and change nothing.
 */
export const consentPendingInteractionResolutionSchema = z.object({
  kind: z.literal("consent_decided"),
  approved: z.boolean(),
});
export type ConsentPendingInteractionResolution = z.infer<
  typeof consentPendingInteractionResolutionSchema
>;

export const pendingInteractionResolutionSchema = z.union(
  [
    approvalPendingInteractionResolutionSchema,
    userQuestionPendingInteractionResolutionSchema,
    pluginPendingInteractionResolutionSchema,
  ],
  approvalDecisionDiscriminatorError,
);
export type PendingInteractionResolution = z.infer<
  typeof pendingInteractionResolutionSchema
>;

/**
 * Every resolution a stored interaction can carry, including the consent one
 * that is deliberately absent from `pendingInteractionResolutionSchema`.
 * Mirrors `AnyPendingInteractionPayload`: readers of a stored row need the
 * wider type, the daemon wire needs the narrower one.
 */
export type AnyPendingInteractionResolution =
  | PendingInteractionResolution
  | ConsentPendingInteractionResolution;

export function isApprovalPendingInteractionResolution(
  resolution: PendingInteractionResolution,
): resolution is ApprovalPendingInteractionResolution {
  return "decision" in resolution;
}

export function isUserQuestionPendingInteractionResolution(
  resolution: PendingInteractionResolution,
): resolution is UserQuestionPendingInteractionResolution {
  return "kind" in resolution && resolution.kind === "user_answer";
}

export function isPluginPendingInteractionResolution(
  resolution: PendingInteractionResolution,
): resolution is PluginPendingInteractionResolution {
  return "kind" in resolution && resolution.kind === "plugin_submitted";
}

export const pendingInteractionProviderOriginSchema = z.object({
  kind: z.literal("provider"),
  providerId: z.string().min(1),
  providerThreadId: z.string().min(1),
  providerRequestId: z.string().min(1),
});
export type PendingInteractionProviderOrigin = z.infer<
  typeof pendingInteractionProviderOriginSchema
>;

export const pendingInteractionPluginOriginSchema = z.object({
  kind: z.literal("plugin"),
  pluginId: z.string().min(1),
  rendererId: z.string().min(1),
});
export type PendingInteractionPluginOrigin = z.infer<
  typeof pendingInteractionPluginOriginSchema
>;

/** The server asked, on behalf of the thread the interaction is raised in. */
export const pendingInteractionServerOriginSchema = z.object({
  kind: z.literal("server"),
});
export type PendingInteractionServerOrigin = z.infer<
  typeof pendingInteractionServerOriginSchema
>;

export const pendingInteractionOriginSchema = z.discriminatedUnion("kind", [
  pendingInteractionProviderOriginSchema,
  pendingInteractionPluginOriginSchema,
  pendingInteractionServerOriginSchema,
]);
export type PendingInteractionOrigin = z.infer<
  typeof pendingInteractionOriginSchema
>;

export const pendingInteractionCreateSchema = z.object({
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  providerId: z.string().min(1),
  providerThreadId: z.string().min(1),
  providerRequestId: z.string().min(1),
  payload: z.union([
    approvalPendingInteractionPayloadSchema,
    userQuestionPendingInteractionPayloadSchema,
  ]),
});
export type PendingInteractionCreate = z.infer<
  typeof pendingInteractionCreateSchema
>;

const pendingInteractionBaseSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  status: pendingInteractionStatusSchema,
  statusReason: z.string().nullable(),
  createdAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative().nullable().optional(),
  resolvedAt: z.number().int().nonnegative().nullable(),
});

export const providerPendingInteractionSchema =
  pendingInteractionBaseSchema.extend({
    turnId: z.string().min(1),
    providerId: z.string().min(1),
    providerThreadId: z.string().min(1),
    providerRequestId: z.string().min(1),
    origin: pendingInteractionProviderOriginSchema.optional(),
    payload: z.union([
      approvalPendingInteractionPayloadSchema,
      userQuestionPendingInteractionPayloadSchema,
    ]),
    resolution: z
      .union([
        approvalPendingInteractionResolutionSchema,
        userQuestionPendingInteractionResolutionSchema,
      ])
      .nullable(),
  });
export type ProviderPendingInteraction = z.infer<
  typeof providerPendingInteractionSchema
>;

export const pluginPendingInteractionSchema =
  pendingInteractionBaseSchema.extend({
    turnId: z.string().min(1).nullable(),
    origin: pendingInteractionPluginOriginSchema,
    payload: pluginPendingInteractionPayloadSchema,
    resolution: pluginPendingInteractionResolutionSchema.nullable(),
  });
export type PluginPendingInteraction = z.infer<
  typeof pluginPendingInteractionSchema
>;

export const consentPendingInteractionSchema =
  pendingInteractionBaseSchema.extend({
    turnId: z.string().min(1).nullable(),
    origin: pendingInteractionServerOriginSchema,
    payload: consentPendingInteractionPayloadSchema,
    resolution: consentPendingInteractionResolutionSchema.nullable(),
  });
export type ConsentPendingInteraction = z.infer<
  typeof consentPendingInteractionSchema
>;

export const pendingInteractionSchema = z.union([
  providerPendingInteractionSchema,
  pluginPendingInteractionSchema,
  consentPendingInteractionSchema,
]);
export type PendingInteraction =
  | ProviderPendingInteraction
  | PluginPendingInteraction
  | ConsentPendingInteraction;

export function isPluginPendingInteraction(
  interaction: PendingInteraction,
): interaction is PluginPendingInteraction {
  return interaction.payload.kind === "plugin";
}

export function isConsentPendingInteraction(
  interaction: PendingInteraction,
): interaction is ConsentPendingInteraction {
  return interaction.payload.kind === "consent";
}

export function isConsentPendingInteractionPayload(
  payload: AnyPendingInteractionPayload,
): payload is ConsentPendingInteractionPayload {
  return payload.kind === "consent";
}

export function isConsentPendingInteractionResolution(
  resolution: AnyPendingInteractionResolution,
): resolution is ConsentPendingInteractionResolution {
  return "kind" in resolution && resolution.kind === "consent_decided";
}
