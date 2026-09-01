// Portable type declarations for `@patcher/plugin-sdk`. Unpublished Patcher
// workspace contracts are flattened; public subpaths may reuse the
// package root without requiring any other @patcher/* package.
//
// Confused by the API, or need a symbol that isn't here? Clone the Patcher repo
// and read the real source: https://github.com/laruss/patcher-browser

import * as react from 'react';
import { ComponentType, ReactNode } from 'react';
import * as z from 'zod';
import { z as z$1 } from 'zod';
import Database from 'better-sqlite3';
import { Context } from 'hono';

/**
 * App-wide server-backed preferences.
 * Client-local settings stay in the frontend localStorage helpers instead.
 */
declare const appSettingsSchema: z$1.ZodObject<{
    caffeinate: z$1.ZodBoolean;
    showKeyboardHints: z$1.ZodBoolean;
    steerActiveThreadOnEnter: z$1.ZodBoolean;
    showUnhandledProviderEvents: z$1.ZodBoolean;
    codexMemoryEnabled: z$1.ZodBoolean;
    claudeCodeMemoryEnabled: z$1.ZodBoolean;
    codexSubagentsDisabled: z$1.ZodBoolean;
    claudeCodeSubagentsDisabled: z$1.ZodBoolean;
    claudeCodeWorkflowsDisabled: z$1.ZodBoolean;
    codexNetworkDisabled: z$1.ZodBoolean;
    onboardingCompletedAt: z$1.ZodNullable<z$1.ZodString>;
    browserSearchEngineId: z$1.ZodString;
}, z$1.core.$strict>;
type AppSettings = z$1.infer<typeof appSettingsSchema>;

declare const appKeybindingOverridesSchema: z$1.ZodArray<z$1.ZodObject<{
    command: z$1.ZodEnum<{
        "thread.jump.1": "thread.jump.1";
        "thread.jump.2": "thread.jump.2";
        "thread.jump.3": "thread.jump.3";
        "thread.jump.4": "thread.jump.4";
        "thread.jump.5": "thread.jump.5";
        "thread.jump.6": "thread.jump.6";
        "thread.jump.7": "thread.jump.7";
        "thread.jump.8": "thread.jump.8";
        "thread.jump.9": "thread.jump.9";
        "question.select.1": "question.select.1";
        "question.select.2": "question.select.2";
        "question.select.3": "question.select.3";
        "question.select.4": "question.select.4";
        "question.select.5": "question.select.5";
        "question.select.6": "question.select.6";
        "question.select.7": "question.select.7";
        "question.select.8": "question.select.8";
        "question.select.9": "question.select.9";
        "pane.focus.1": "pane.focus.1";
        "pane.focus.2": "pane.focus.2";
        "pane.focus.3": "pane.focus.3";
        "pane.focus.4": "pane.focus.4";
        "pane.focus.5": "pane.focus.5";
        "pane.focus.6": "pane.focus.6";
        "pane.focus.7": "pane.focus.7";
        "pane.focus.8": "pane.focus.8";
        "browser.selectTab.1": "browser.selectTab.1";
        "browser.selectTab.2": "browser.selectTab.2";
        "browser.selectTab.3": "browser.selectTab.3";
        "browser.selectTab.4": "browser.selectTab.4";
        "browser.selectTab.5": "browser.selectTab.5";
        "browser.selectTab.6": "browser.selectTab.6";
        "browser.selectTab.7": "browser.selectTab.7";
        "browser.selectTab.8": "browser.selectTab.8";
        "thread.new": "thread.new";
        "thread.search": "thread.search";
        "thread.rename": "thread.rename";
        "thread.archive": "thread.archive";
        "thread.previous": "thread.previous";
        "thread.next": "thread.next";
        "pane.focus.previous": "pane.focus.previous";
        "pane.focus.next": "pane.focus.next";
        "pane.maximize.toggle": "pane.maximize.toggle";
        "pane.close": "pane.close";
        "window.new": "window.new";
        "settings.open": "settings.open";
        "settings.openServers": "settings.openServers";
        "sidebar.toggle": "sidebar.toggle";
        "panel.newTab": "panel.newTab";
        "panel.close": "panel.close";
        "panel.toggle": "panel.toggle";
        "diff.toggle": "diff.toggle";
        "terminal.open": "terminal.open";
        "composer.focus": "composer.focus";
        "modelPicker.toggle": "modelPicker.toggle";
        "modelPicker.cycleModel": "modelPicker.cycleModel";
        "modelPicker.cycleReasoning": "modelPicker.cycleReasoning";
        "browser.focusLocation": "browser.focusLocation";
        "browser.reload": "browser.reload";
        "browser.find": "browser.find";
        "browser.fullscreen.toggle": "browser.fullscreen.toggle";
        "browser.devTools.toggle": "browser.devTools.toggle";
        "browser.newTab": "browser.newTab";
        "browser.closeTab": "browser.closeTab";
        "browser.reopenClosedTab": "browser.reopenClosedTab";
        "browser.selectLastTab": "browser.selectLastTab";
        "browser.recentTab.next": "browser.recentTab.next";
        "browser.recentTab.previous": "browser.recentTab.previous";
        "browser.goBack": "browser.goBack";
        "browser.goForward": "browser.goForward";
        "browser.zoomIn": "browser.zoomIn";
        "browser.zoomOut": "browser.zoomOut";
        "browser.zoomReset": "browser.zoomReset";
        "browser.print": "browser.print";
        "workspace.openPreferred": "workspace.openPreferred";
    }>;
    shortcut: z$1.ZodNullable<z$1.ZodObject<{
        key: z$1.ZodString;
        mod: z$1.ZodBoolean;
        meta: z$1.ZodBoolean;
        control: z$1.ZodBoolean;
        alt: z$1.ZodBoolean;
        shift: z$1.ZodBoolean;
    }, z$1.core.$strict>>;
}, z$1.core.$strict>>;
type AppKeybindingOverrides = z$1.infer<typeof appKeybindingOverridesSchema>;

declare const appThemeSchema: z$1.ZodObject<{
    themeId: z$1.ZodString;
    customCss: z$1.ZodNullable<z$1.ZodString>;
    faviconColor: z$1.ZodEnum<{
        default: "default";
        red: "red";
        orange: "orange";
        yellow: "yellow";
        green: "green";
        teal: "teal";
        blue: "blue";
        purple: "purple";
        pink: "pink";
    }>;
}, z$1.core.$strip>;
type AppTheme = z$1.infer<typeof appThemeSchema>;
/**
 * The complete appearance selection a client sends when changing the palette
 * and/or favicon tint. The server validates `themeId` (built-in id or an
 * existing custom theme) and resolves the CSS from disk for custom themes.
 * Callers changing only one facet must carry the other facet forward explicitly.
 */
declare const appThemeSelectionSchema: z$1.ZodObject<{
    themeId: z$1.ZodString;
    faviconColor: z$1.ZodEnum<{
        default: "default";
        red: "red";
        orange: "orange";
        yellow: "yellow";
        green: "green";
        teal: "teal";
        blue: "blue";
        purple: "purple";
        pink: "pink";
    }>;
}, z$1.core.$strip>;
type AppThemeSelection = z$1.infer<typeof appThemeSelectionSchema>;

declare const changedMessageSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    type: z$1.ZodLiteral<"changed">;
    entity: z$1.ZodLiteral<"thread">;
    id: z$1.ZodOptional<z$1.ZodString>;
    metadata: z$1.ZodOptional<z$1.ZodObject<{
        backgroundActivityChanged: z$1.ZodOptional<z$1.ZodBoolean>;
        eventTypes: z$1.ZodOptional<z$1.ZodReadonly<z$1.ZodArray<z$1.ZodString & z$1.ZodType<"thread/started" | "thread/identity" | "turn/started" | "turn/completed" | "turn/input/accepted" | "thread/name/updated" | "thread/compacted" | "thread/goal/updated" | "thread/goal/cleared" | "item/started" | "item/completed" | "item/agentMessage/delta" | "item/commandExecution/outputDelta" | "item/fileChange/outputDelta" | "item/reasoning/summaryTextDelta" | "item/reasoning/textDelta" | "item/plan/delta" | "item/mcpToolCall/progress" | "item/toolCall/progress" | "item/backgroundTask/progress" | "item/backgroundTask/completed" | "thread/tokenUsage/updated" | "thread/contextWindowUsage/updated" | "turn/plan/updated" | "turn/diff/updated" | "provider/error" | "provider/rateLimits/updated" | "provider/warning" | "provider/modelFallback" | "provider/unhandled" | "client/thread/start" | "client/turn/requested" | "client/turn/start" | "system/error" | "system/manager/user_message" | "system/thread/interrupted" | "system/operation" | "system/permissionGrant/lifecycle" | "system/userQuestion/lifecycle" | "system/thread-provisioning" | "system/provider-turn-watchdog", string, z$1.core.$ZodTypeInternals<"thread/started" | "thread/identity" | "turn/started" | "turn/completed" | "turn/input/accepted" | "thread/name/updated" | "thread/compacted" | "thread/goal/updated" | "thread/goal/cleared" | "item/started" | "item/completed" | "item/agentMessage/delta" | "item/commandExecution/outputDelta" | "item/fileChange/outputDelta" | "item/reasoning/summaryTextDelta" | "item/reasoning/textDelta" | "item/plan/delta" | "item/mcpToolCall/progress" | "item/toolCall/progress" | "item/backgroundTask/progress" | "item/backgroundTask/completed" | "thread/tokenUsage/updated" | "thread/contextWindowUsage/updated" | "turn/plan/updated" | "turn/diff/updated" | "provider/error" | "provider/rateLimits/updated" | "provider/warning" | "provider/modelFallback" | "provider/unhandled" | "client/thread/start" | "client/turn/requested" | "client/turn/start" | "system/error" | "system/manager/user_message" | "system/thread/interrupted" | "system/operation" | "system/permissionGrant/lifecycle" | "system/userQuestion/lifecycle" | "system/thread-provisioning" | "system/provider-turn-watchdog", string>>>>>;
        hasPendingInteraction: z$1.ZodOptional<z$1.ZodBoolean>;
        projectId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strict>>;
    changes: z$1.ZodReadonly<z$1.ZodArray<z$1.ZodEnum<{
        "thread-created": "thread-created";
        "thread-deleted": "thread-deleted";
        "events-appended": "events-appended";
        "history-rewritten": "history-rewritten";
        "interactions-changed": "interactions-changed";
        "status-changed": "status-changed";
        "title-changed": "title-changed";
        "queue-changed": "queue-changed";
        "archived-changed": "archived-changed";
        "pin-state-changed": "pin-state-changed";
        "parent-changed": "parent-changed";
        "environment-changed": "environment-changed";
        "read-state-changed": "read-state-changed";
        "order-changed": "order-changed";
        "tabs-changed": "tabs-changed";
        "terminals-changed": "terminals-changed";
    }>>>;
}, z$1.core.$strict>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"changed">;
    entity: z$1.ZodLiteral<"project">;
    id: z$1.ZodOptional<z$1.ZodString>;
    changes: z$1.ZodReadonly<z$1.ZodArray<z$1.ZodEnum<{
        "project-created": "project-created";
        "project-updated": "project-updated";
        "project-deleted": "project-deleted";
        "project-sources-changed": "project-sources-changed";
        "threads-changed": "threads-changed";
        "project-order-changed": "project-order-changed";
    }>>>;
}, z$1.core.$strict>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"changed">;
    entity: z$1.ZodLiteral<"environment">;
    id: z$1.ZodOptional<z$1.ZodString>;
    changes: z$1.ZodReadonly<z$1.ZodArray<z$1.ZodEnum<{
        "status-changed": "status-changed";
        "environment-created": "environment-created";
        "environment-deleted": "environment-deleted";
        "metadata-changed": "metadata-changed";
        "work-status-changed": "work-status-changed";
        "git-refs-changed": "git-refs-changed";
        "thread-storage-changed": "thread-storage-changed";
    }>>>;
}, z$1.core.$strict>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"changed">;
    entity: z$1.ZodLiteral<"host">;
    id: z$1.ZodOptional<z$1.ZodString>;
    changes: z$1.ZodReadonly<z$1.ZodArray<z$1.ZodEnum<{
        "host-connected": "host-connected";
        "host-disconnected": "host-disconnected";
    }>>>;
}, z$1.core.$strict>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"changed">;
    entity: z$1.ZodLiteral<"system">;
    changes: z$1.ZodReadonly<z$1.ZodArray<z$1.ZodEnum<{
        "browser-history-changed": "browser-history-changed";
        "config-changed": "config-changed";
        "plugins-changed": "plugins-changed";
    }>>>;
}, z$1.core.$strict>], "entity">;
type ChangedMessage = z$1.infer<typeof changedMessageSchema>;

declare const environmentSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    name: z$1.ZodNullable<z$1.ZodString>;
    projectId: z$1.ZodString;
    hostId: z$1.ZodString;
    path: z$1.ZodNullable<z$1.ZodString>;
    managed: z$1.ZodBoolean;
    isGitRepo: z$1.ZodBoolean;
    isWorktree: z$1.ZodBoolean;
    workspaceProvisionType: z$1.ZodEnum<{
        unmanaged: "unmanaged";
        "managed-worktree": "managed-worktree";
        personal: "personal";
    }>;
    branchName: z$1.ZodNullable<z$1.ZodString>;
    baseBranch: z$1.ZodNullable<z$1.ZodString>;
    defaultBranch: z$1.ZodNullable<z$1.ZodString>;
    mergeBaseBranch: z$1.ZodNullable<z$1.ZodString>;
    status: z$1.ZodEnum<{
        error: "error";
        provisioning: "provisioning";
        ready: "ready";
        retiring: "retiring";
        destroying: "destroying";
        destroyed: "destroyed";
    }>;
    createdAt: z$1.ZodNumber;
    updatedAt: z$1.ZodNumber;
}, z$1.core.$strip>;
type Environment = z$1.infer<typeof environmentSchema>;

declare const experimentsSchema: z$1.ZodRecord<z$1.ZodEnum<{
    claudeCodeMockCliTraffic: "claudeCodeMockCliTraffic";
    editMessages: "editMessages";
    newOnboarding: "newOnboarding";
    toolsHub: "toolsHub";
}>, z$1.ZodBoolean>;
type Experiments = z$1.infer<typeof experimentsSchema>;

declare const hostSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    name: z$1.ZodString;
    type: z$1.ZodEnum<{
        persistent: "persistent";
    }>;
    status: z$1.ZodEnum<{
        connected: "connected";
        disconnected: "disconnected";
    }>;
    maxPermissionMode: z$1.ZodEnum<{
        full: "full";
        auto: "auto";
        "accept-edits": "accept-edits";
    }>;
    lastSeenAt: z$1.ZodNullable<z$1.ZodNumber>;
    lastRejectedProtocolVersion: z$1.ZodNullable<z$1.ZodNumber>;
    createdAt: z$1.ZodNumber;
    updatedAt: z$1.ZodNumber;
}, z$1.core.$strip>;
type Host = z$1.infer<typeof hostSchema>;

interface JsonObject {
    [key: string]: JsonValue$1;
}
type JsonValue$1 = string | number | boolean | null | JsonValue$1[] | JsonObject;

declare const pendingInteractionResolutionSchema: z$1.ZodUnion<readonly [z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    decision: z$1.ZodLiteral<"allow_once">;
    grantedPermissions: z$1.ZodNullable<z$1.ZodObject<{
        network: z$1.ZodNullable<z$1.ZodObject<{
            enabled: z$1.ZodNullable<z$1.ZodBoolean>;
        }, z$1.core.$strip>>;
        fileSystem: z$1.ZodNullable<z$1.ZodObject<{
            read: z$1.ZodArray<z$1.ZodString>;
            write: z$1.ZodArray<z$1.ZodString>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strict>>;
}, z$1.core.$strip>, z$1.ZodObject<{
    decision: z$1.ZodLiteral<"allow_for_session">;
    grantedPermissions: z$1.ZodNullable<z$1.ZodObject<{
        network: z$1.ZodNullable<z$1.ZodObject<{
            enabled: z$1.ZodNullable<z$1.ZodBoolean>;
        }, z$1.core.$strip>>;
        fileSystem: z$1.ZodNullable<z$1.ZodObject<{
            read: z$1.ZodArray<z$1.ZodString>;
            write: z$1.ZodArray<z$1.ZodString>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strict>>;
}, z$1.core.$strip>, z$1.ZodObject<{
    decision: z$1.ZodLiteral<"deny">;
}, z$1.core.$strip>], "decision">, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"user_answer">;
    answers: z$1.ZodRecord<z$1.ZodString, z$1.ZodObject<{
        selected: z$1.ZodArray<z$1.ZodString>;
        freeText: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"plugin_submitted">;
}, z$1.core.$strip>]>;
type PendingInteractionResolution = z$1.infer<typeof pendingInteractionResolutionSchema>;
declare const providerPendingInteractionSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    status: z$1.ZodEnum<{
        pending: "pending";
        interrupted: "interrupted";
        resolving: "resolving";
        resolved: "resolved";
    }>;
    statusReason: z$1.ZodNullable<z$1.ZodString>;
    createdAt: z$1.ZodNumber;
    expiresAt: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodNumber>>;
    resolvedAt: z$1.ZodNullable<z$1.ZodNumber>;
    turnId: z$1.ZodString;
    providerId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    providerRequestId: z$1.ZodString;
    origin: z$1.ZodOptional<z$1.ZodObject<{
        kind: z$1.ZodLiteral<"provider">;
        providerId: z$1.ZodString;
        providerThreadId: z$1.ZodString;
        providerRequestId: z$1.ZodString;
    }, z$1.core.$strip>>;
    payload: z$1.ZodUnion<readonly [z$1.ZodObject<{
        kind: z$1.ZodLiteral<"approval">;
        subject: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"command">;
            itemId: z$1.ZodString;
            command: z$1.ZodString;
            cwd: z$1.ZodNullable<z$1.ZodString>;
            actions: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                type: z$1.ZodLiteral<"read">;
                command: z$1.ZodString;
                name: z$1.ZodString;
                path: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                type: z$1.ZodLiteral<"listFiles">;
                command: z$1.ZodString;
                path: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                type: z$1.ZodLiteral<"search">;
                command: z$1.ZodString;
                query: z$1.ZodNullable<z$1.ZodString>;
                path: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                type: z$1.ZodLiteral<"unknown">;
                command: z$1.ZodString;
            }, z$1.core.$strip>], "type">>;
            sessionGrant: z$1.ZodNullable<z$1.ZodObject<{
                network: z$1.ZodNullable<z$1.ZodObject<{
                    enabled: z$1.ZodNullable<z$1.ZodBoolean>;
                }, z$1.core.$strip>>;
                fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                    read: z$1.ZodArray<z$1.ZodString>;
                    write: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strip>>;
            }, z$1.core.$strict>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"file_change">;
            itemId: z$1.ZodString;
            writeScope: z$1.ZodNullable<z$1.ZodString>;
            sessionGrant: z$1.ZodNullable<z$1.ZodObject<{
                network: z$1.ZodNullable<z$1.ZodObject<{
                    enabled: z$1.ZodNullable<z$1.ZodBoolean>;
                }, z$1.core.$strip>>;
                fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                    read: z$1.ZodArray<z$1.ZodString>;
                    write: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strip>>;
            }, z$1.core.$strict>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"permission_grant">;
            itemId: z$1.ZodString;
            toolName: z$1.ZodNullable<z$1.ZodString>;
            permissions: z$1.ZodObject<{
                network: z$1.ZodNullable<z$1.ZodObject<{
                    enabled: z$1.ZodNullable<z$1.ZodBoolean>;
                }, z$1.core.$strip>>;
                fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                    read: z$1.ZodArray<z$1.ZodString>;
                    write: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strip>>;
            }, z$1.core.$strict>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"plan">;
            itemId: z$1.ZodString;
            plan: z$1.ZodString;
            planFilePath: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"mcp_tool_call">;
            serverName: z$1.ZodString;
            message: z$1.ZodString;
            toolDescription: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>], "kind">;
        reason: z$1.ZodNullable<z$1.ZodString>;
        availableDecisions: z$1.ZodArray<z$1.ZodEnum<{
            allow_once: "allow_once";
            allow_for_session: "allow_for_session";
            deny: "deny";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"user_question">;
        questions: z$1.ZodArray<z$1.ZodObject<{
            id: z$1.ZodString;
            prompt: z$1.ZodString;
            shortLabel: z$1.ZodOptional<z$1.ZodString>;
            multiSelect: z$1.ZodBoolean;
            options: z$1.ZodOptional<z$1.ZodArray<z$1.ZodObject<{
                value: z$1.ZodString;
                label: z$1.ZodString;
                description: z$1.ZodOptional<z$1.ZodString>;
            }, z$1.core.$strip>>>;
            allowFreeText: z$1.ZodBoolean;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>]>;
    resolution: z$1.ZodNullable<z$1.ZodUnion<readonly [z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        decision: z$1.ZodLiteral<"allow_once">;
        grantedPermissions: z$1.ZodNullable<z$1.ZodObject<{
            network: z$1.ZodNullable<z$1.ZodObject<{
                enabled: z$1.ZodNullable<z$1.ZodBoolean>;
            }, z$1.core.$strip>>;
            fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                read: z$1.ZodArray<z$1.ZodString>;
                write: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strict>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        decision: z$1.ZodLiteral<"allow_for_session">;
        grantedPermissions: z$1.ZodNullable<z$1.ZodObject<{
            network: z$1.ZodNullable<z$1.ZodObject<{
                enabled: z$1.ZodNullable<z$1.ZodBoolean>;
            }, z$1.core.$strip>>;
            fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                read: z$1.ZodArray<z$1.ZodString>;
                write: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strict>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        decision: z$1.ZodLiteral<"deny">;
    }, z$1.core.$strip>], "decision">, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"user_answer">;
        answers: z$1.ZodRecord<z$1.ZodString, z$1.ZodObject<{
            selected: z$1.ZodArray<z$1.ZodString>;
            freeText: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>]>>;
}, z$1.core.$strip>;
type ProviderPendingInteraction = z$1.infer<typeof providerPendingInteractionSchema>;
declare const pluginPendingInteractionSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    status: z$1.ZodEnum<{
        pending: "pending";
        interrupted: "interrupted";
        resolving: "resolving";
        resolved: "resolved";
    }>;
    statusReason: z$1.ZodNullable<z$1.ZodString>;
    createdAt: z$1.ZodNumber;
    expiresAt: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodNumber>>;
    resolvedAt: z$1.ZodNullable<z$1.ZodNumber>;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    origin: z$1.ZodObject<{
        kind: z$1.ZodLiteral<"plugin">;
        pluginId: z$1.ZodString;
        rendererId: z$1.ZodString;
    }, z$1.core.$strip>;
    payload: z$1.ZodObject<{
        kind: z$1.ZodLiteral<"plugin">;
        title: z$1.ZodString;
        data: z$1.ZodType<JsonValue$1, unknown, z$1.core.$ZodTypeInternals<JsonValue$1, unknown>>;
    }, z$1.core.$strip>;
    resolution: z$1.ZodNullable<z$1.ZodObject<{
        kind: z$1.ZodLiteral<"plugin_submitted">;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type PluginPendingInteraction = z$1.infer<typeof pluginPendingInteractionSchema>;
declare const consentPendingInteractionSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    status: z$1.ZodEnum<{
        pending: "pending";
        interrupted: "interrupted";
        resolving: "resolving";
        resolved: "resolved";
    }>;
    statusReason: z$1.ZodNullable<z$1.ZodString>;
    createdAt: z$1.ZodNumber;
    expiresAt: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodNumber>>;
    resolvedAt: z$1.ZodNullable<z$1.ZodNumber>;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    origin: z$1.ZodObject<{
        kind: z$1.ZodLiteral<"server">;
    }, z$1.core.$strip>;
    payload: z$1.ZodObject<{
        kind: z$1.ZodLiteral<"consent">;
        action: z$1.ZodEnum<{
            update: "update";
            enable: "enable";
            disable: "disable";
            install: "install";
            remove: "remove";
            configure: "configure";
            "run-setup-script": "run-setup-script";
            "move-workspace": "move-workspace";
        }>;
        subjectId: z$1.ZodString;
        subjectName: z$1.ZodString;
        permissions: z$1.ZodArray<z$1.ZodString>;
        sites: z$1.ZodArray<z$1.ZodString>;
        detail: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>;
    resolution: z$1.ZodNullable<z$1.ZodObject<{
        kind: z$1.ZodLiteral<"consent_decided">;
        approved: z$1.ZodBoolean;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type ConsentPendingInteraction = z$1.infer<typeof consentPendingInteractionSchema>;
type PendingInteraction = ProviderPendingInteraction | PluginPendingInteraction | ConsentPendingInteraction;

declare const projectSourceSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    projectId: z$1.ZodString;
    isDefault: z$1.ZodBoolean;
    createdAt: z$1.ZodNumber;
    updatedAt: z$1.ZodNumber;
    type: z$1.ZodLiteral<"local_path">;
    hostId: z$1.ZodString;
    path: z$1.ZodString;
}, z$1.core.$strip>;
type ProjectSource = z$1.infer<typeof projectSourceSchema>;

declare const reasoningLevelSchema: z$1.ZodEnum<{
    none: "none";
    low: "low";
    medium: "medium";
    high: "high";
    xhigh: "xhigh";
    ultracode: "ultracode";
    max: "max";
    ultra: "ultra";
}>;
type ReasoningLevel = z$1.infer<typeof reasoningLevelSchema>;
declare const serviceTierSchema: z$1.ZodEnum<{
    default: "default";
    fast: "fast";
}>;
type ServiceTier = z$1.infer<typeof serviceTierSchema>;
declare const permissionModeSchema: z$1.ZodEnum<{
    full: "full";
    auto: "auto";
    "accept-edits": "accept-edits";
}>;
type PermissionMode = z$1.infer<typeof permissionModeSchema>;
declare const promptInputSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    visibility: z$1.ZodOptional<z$1.ZodEnum<{
        "agent-only": "agent-only";
    }>>;
    type: z$1.ZodLiteral<"text">;
    text: z$1.ZodString;
    mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
        start: z$1.ZodNumber;
        end: z$1.ZodNumber;
        resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"thread">;
            threadId: z$1.ZodString;
            projectId: z$1.ZodOptional<z$1.ZodString>;
            label: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"project">;
            projectId: z$1.ZodString;
            label: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"section">;
            sectionId: z$1.ZodString;
            label: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"path">;
            source: z$1.ZodEnum<{
                workspace: "workspace";
                "thread-storage": "thread-storage";
            }>;
            entryKind: z$1.ZodEnum<{
                file: "file";
                directory: "directory";
            }>;
            path: z$1.ZodString;
            label: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"command">;
            trigger: z$1.ZodEnum<{
                "/": "/";
            }>;
            name: z$1.ZodString;
            source: z$1.ZodEnum<{
                command: "command";
                skill: "skill";
            }>;
            origin: z$1.ZodEnum<{
                user: "user";
                project: "project";
                builtin: "builtin";
            }>;
            label: z$1.ZodString;
            argumentHint: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"plugin">;
            pluginId: z$1.ZodString;
            icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
            itemId: z$1.ZodString;
            label: z$1.ZodString;
        }, z$1.core.$strip>], "kind">>;
    }, z$1.core.$strip>>>;
}, z$1.core.$strip>, z$1.ZodObject<{
    visibility: z$1.ZodOptional<z$1.ZodEnum<{
        "agent-only": "agent-only";
    }>>;
    type: z$1.ZodLiteral<"image">;
    url: z$1.ZodString;
}, z$1.core.$strip>, z$1.ZodObject<{
    visibility: z$1.ZodOptional<z$1.ZodEnum<{
        "agent-only": "agent-only";
    }>>;
    type: z$1.ZodLiteral<"localImage">;
    path: z$1.ZodString;
}, z$1.core.$strip>, z$1.ZodObject<{
    visibility: z$1.ZodOptional<z$1.ZodEnum<{
        "agent-only": "agent-only";
    }>>;
    type: z$1.ZodLiteral<"localFile">;
    path: z$1.ZodString;
    name: z$1.ZodOptional<z$1.ZodString>;
    sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
    mimeType: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>], "type">;
type PromptInput = z$1.infer<typeof promptInputSchema>;
declare const resolvedThreadExecutionOptionsSchema: z$1.ZodObject<{
    seq: z$1.ZodOptional<z$1.ZodNumber>;
    model: z$1.ZodString;
    serviceTier: z$1.ZodEnum<{
        default: "default";
        fast: "fast";
    }>;
    reasoningLevel: z$1.ZodEnum<{
        none: "none";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        ultracode: "ultracode";
        max: "max";
        ultra: "ultra";
    }>;
    permissionMode: z$1.ZodEnum<{
        full: "full";
        auto: "auto";
        "accept-edits": "accept-edits";
    }>;
    source: z$1.ZodEnum<{
        "client/thread/start": "client/thread/start";
        "client/turn/requested": "client/turn/requested";
        "client/turn/start": "client/turn/start";
    }>;
}, z$1.core.$strip>;
type ResolvedThreadExecutionOptions = z$1.infer<typeof resolvedThreadExecutionOptionsSchema>;
declare const projectExecutionDefaultsSchema: z$1.ZodObject<{
    providerId: z$1.ZodString;
    model: z$1.ZodString;
    serviceTier: z$1.ZodEnum<{
        default: "default";
        fast: "fast";
    }>;
    reasoningLevel: z$1.ZodEnum<{
        none: "none";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        ultracode: "ultracode";
        max: "max";
        ultra: "ultra";
    }>;
    permissionMode: z$1.ZodEnum<{
        full: "full";
        auto: "auto";
        "accept-edits": "accept-edits";
    }>;
}, z$1.core.$strip>;
type ProjectExecutionDefaults = z$1.infer<typeof projectExecutionDefaultsSchema>;

/** All thread events — provider-originated or system-originated. */
declare const threadEventSchema: z$1.ZodPipe<z$1.ZodUnknown, z$1.ZodUnion<readonly [z$1.ZodIntersection<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    type: z$1.ZodLiteral<"thread/started">;
    threadId: z$1.ZodString;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"thread/identity">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"turn/started">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"turn/completed">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodNullable<z$1.ZodString>;
    status: z$1.ZodEnum<{
        completed: "completed";
        failed: "failed";
        interrupted: "interrupted";
    }>;
    error: z$1.ZodOptional<z$1.ZodObject<{
        message: z$1.ZodString;
    }, z$1.core.$strip>>;
    providerCheckpointId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"turn/input/accepted">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    clientRequestId: z$1.ZodString;
    scope: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"thread">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"turn">;
        turnId: z$1.ZodString;
    }, z$1.core.$strip>], "kind">;
}, z$1.core.$strict>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"thread/name/updated">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    threadName: z$1.ZodString;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"thread/compacted">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"thread/goal/updated">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    objective: z$1.ZodString;
    status: z$1.ZodEnum<{
        paused: "paused";
        active: "active";
        budgetLimited: "budgetLimited";
        complete: "complete";
    }>;
    tokenBudget: z$1.ZodNullable<z$1.ZodNumber>;
    tokensUsed: z$1.ZodNumber;
    timeUsedSeconds: z$1.ZodNumber;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"thread/goal/cleared">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"item/started">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    item: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        type: z$1.ZodLiteral<"userMessage">;
        id: z$1.ZodString;
        content: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            type: z$1.ZodLiteral<"text">;
            text: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"image">;
            url: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"localImage">;
            path: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"localFile">;
            path: z$1.ZodString;
        }, z$1.core.$strip>], "type">>;
        clientRequestId: z$1.ZodOptional<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"agentMessage">;
        id: z$1.ZodString;
        text: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"commandExecution">;
        id: z$1.ZodString;
        command: z$1.ZodString;
        cwd: z$1.ZodString;
        status: z$1.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
        }>;
        approvalStatus: z$1.ZodNullable<z$1.ZodEnum<{
            waiting_for_approval: "waiting_for_approval";
            denied: "denied";
        }>>;
        aggregatedOutput: z$1.ZodOptional<z$1.ZodString>;
        exitCode: z$1.ZodOptional<z$1.ZodNumber>;
        durationMs: z$1.ZodOptional<z$1.ZodNumber>;
        truncation: z$1.ZodOptional<z$1.ZodObject<{
            aggregatedOutput: z$1.ZodOptional<z$1.ZodObject<{
                originalLength: z$1.ZodNumber;
                retainedHeadLength: z$1.ZodNumber;
                retainedTailLength: z$1.ZodNumber;
                truncatedAt: z$1.ZodNumber;
            }, z$1.core.$strip>>;
            result: z$1.ZodOptional<z$1.ZodObject<{
                originalLength: z$1.ZodNumber;
                retainedHeadLength: z$1.ZodNumber;
                retainedTailLength: z$1.ZodNumber;
                truncatedAt: z$1.ZodNumber;
            }, z$1.core.$strip>>;
            resultText: z$1.ZodOptional<z$1.ZodObject<{
                originalLength: z$1.ZodNumber;
                retainedHeadLength: z$1.ZodNumber;
                retainedTailLength: z$1.ZodNumber;
                truncatedAt: z$1.ZodNumber;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"fileChange">;
        id: z$1.ZodString;
        changes: z$1.ZodArray<z$1.ZodObject<{
            path: z$1.ZodString;
            kind: z$1.ZodEnum<{
                add: "add";
                delete: "delete";
                update: "update";
            }>;
            movePath: z$1.ZodOptional<z$1.ZodString>;
            diff: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        status: z$1.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
        }>;
        approvalStatus: z$1.ZodNullable<z$1.ZodEnum<{
            waiting_for_approval: "waiting_for_approval";
            denied: "denied";
        }>>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"webSearch">;
        id: z$1.ZodString;
        queries: z$1.ZodArray<z$1.ZodString>;
        resultText: z$1.ZodNullable<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"webFetch">;
        id: z$1.ZodString;
        url: z$1.ZodString;
        prompt: z$1.ZodNullable<z$1.ZodString>;
        pattern: z$1.ZodNullable<z$1.ZodString>;
        resultText: z$1.ZodNullable<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"imageView">;
        id: z$1.ZodString;
        path: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"toolCall">;
        id: z$1.ZodString;
        server: z$1.ZodOptional<z$1.ZodString>;
        tool: z$1.ZodString;
        arguments: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodString, z$1.ZodUnknown>>;
        statusLabels: z$1.ZodOptional<z$1.ZodObject<{
            pending: z$1.ZodString;
            completed: z$1.ZodString;
        }, z$1.core.$strip>>;
        status: z$1.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
        }>;
        result: z$1.ZodOptional<z$1.ZodUnknown>;
        error: z$1.ZodOptional<z$1.ZodString>;
        durationMs: z$1.ZodOptional<z$1.ZodNumber>;
        truncation: z$1.ZodOptional<z$1.ZodObject<{
            aggregatedOutput: z$1.ZodOptional<z$1.ZodObject<{
                originalLength: z$1.ZodNumber;
                retainedHeadLength: z$1.ZodNumber;
                retainedTailLength: z$1.ZodNumber;
                truncatedAt: z$1.ZodNumber;
            }, z$1.core.$strip>>;
            result: z$1.ZodOptional<z$1.ZodObject<{
                originalLength: z$1.ZodNumber;
                retainedHeadLength: z$1.ZodNumber;
                retainedTailLength: z$1.ZodNumber;
                truncatedAt: z$1.ZodNumber;
            }, z$1.core.$strip>>;
            resultText: z$1.ZodOptional<z$1.ZodObject<{
                originalLength: z$1.ZodNumber;
                retainedHeadLength: z$1.ZodNumber;
                retainedTailLength: z$1.ZodNumber;
                truncatedAt: z$1.ZodNumber;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"reasoning">;
        id: z$1.ZodString;
        summary: z$1.ZodArray<z$1.ZodString>;
        content: z$1.ZodArray<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"plan">;
        id: z$1.ZodString;
        text: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"contextCompaction">;
        id: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"backgroundTask">;
        id: z$1.ZodString;
        taskType: z$1.ZodString;
        description: z$1.ZodString;
        status: z$1.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
        }>;
        taskStatus: z$1.ZodEnum<{
            pending: "pending";
            running: "running";
            paused: "paused";
            completed: "completed";
            failed: "failed";
            killed: "killed";
            stopped: "stopped";
        }>;
        skipTranscript: z$1.ZodBoolean;
        workflowName: z$1.ZodOptional<z$1.ZodString>;
        workflow: z$1.ZodOptional<z$1.ZodObject<{
            phases: z$1.ZodArray<z$1.ZodObject<{
                index: z$1.ZodNumber;
                title: z$1.ZodString;
                kind: z$1.ZodOptional<z$1.ZodString>;
            }, z$1.core.$strip>>;
            agents: z$1.ZodArray<z$1.ZodObject<{
                index: z$1.ZodNumber;
                label: z$1.ZodString;
                state: z$1.ZodEnum<{
                    running: "running";
                    failed: "failed";
                    queued: "queued";
                    done: "done";
                    skipped: "skipped";
                }>;
                model: z$1.ZodString;
                attempt: z$1.ZodNumber;
                cached: z$1.ZodBoolean;
                lastProgressAt: z$1.ZodNumber;
                phaseIndex: z$1.ZodOptional<z$1.ZodNumber>;
                phaseTitle: z$1.ZodOptional<z$1.ZodString>;
                agentType: z$1.ZodOptional<z$1.ZodString>;
                isolation: z$1.ZodOptional<z$1.ZodString>;
                queuedAt: z$1.ZodOptional<z$1.ZodNumber>;
                startedAt: z$1.ZodOptional<z$1.ZodNumber>;
                lastToolName: z$1.ZodOptional<z$1.ZodString>;
                lastToolSummary: z$1.ZodOptional<z$1.ZodString>;
                promptPreview: z$1.ZodOptional<z$1.ZodString>;
                resultPreview: z$1.ZodOptional<z$1.ZodString>;
                error: z$1.ZodOptional<z$1.ZodString>;
                tokens: z$1.ZodOptional<z$1.ZodNumber>;
                toolCalls: z$1.ZodOptional<z$1.ZodNumber>;
                durationMs: z$1.ZodOptional<z$1.ZodNumber>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
        usage: z$1.ZodOptional<z$1.ZodObject<{
            totalTokens: z$1.ZodNumber;
            toolUses: z$1.ZodNumber;
            durationMs: z$1.ZodNumber;
        }, z$1.core.$strip>>;
        summary: z$1.ZodOptional<z$1.ZodString>;
        error: z$1.ZodOptional<z$1.ZodString>;
        outputFile: z$1.ZodOptional<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>], "type">;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"item/completed">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    item: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        type: z$1.ZodLiteral<"userMessage">;
        id: z$1.ZodString;
        content: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            type: z$1.ZodLiteral<"text">;
            text: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"image">;
            url: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"localImage">;
            path: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"localFile">;
            path: z$1.ZodString;
        }, z$1.core.$strip>], "type">>;
        clientRequestId: z$1.ZodOptional<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"agentMessage">;
        id: z$1.ZodString;
        text: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"commandExecution">;
        id: z$1.ZodString;
        command: z$1.ZodString;
        cwd: z$1.ZodString;
        status: z$1.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
        }>;
        approvalStatus: z$1.ZodNullable<z$1.ZodEnum<{
            waiting_for_approval: "waiting_for_approval";
            denied: "denied";
        }>>;
        aggregatedOutput: z$1.ZodOptional<z$1.ZodString>;
        exitCode: z$1.ZodOptional<z$1.ZodNumber>;
        durationMs: z$1.ZodOptional<z$1.ZodNumber>;
        truncation: z$1.ZodOptional<z$1.ZodObject<{
            aggregatedOutput: z$1.ZodOptional<z$1.ZodObject<{
                originalLength: z$1.ZodNumber;
                retainedHeadLength: z$1.ZodNumber;
                retainedTailLength: z$1.ZodNumber;
                truncatedAt: z$1.ZodNumber;
            }, z$1.core.$strip>>;
            result: z$1.ZodOptional<z$1.ZodObject<{
                originalLength: z$1.ZodNumber;
                retainedHeadLength: z$1.ZodNumber;
                retainedTailLength: z$1.ZodNumber;
                truncatedAt: z$1.ZodNumber;
            }, z$1.core.$strip>>;
            resultText: z$1.ZodOptional<z$1.ZodObject<{
                originalLength: z$1.ZodNumber;
                retainedHeadLength: z$1.ZodNumber;
                retainedTailLength: z$1.ZodNumber;
                truncatedAt: z$1.ZodNumber;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"fileChange">;
        id: z$1.ZodString;
        changes: z$1.ZodArray<z$1.ZodObject<{
            path: z$1.ZodString;
            kind: z$1.ZodEnum<{
                add: "add";
                delete: "delete";
                update: "update";
            }>;
            movePath: z$1.ZodOptional<z$1.ZodString>;
            diff: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        status: z$1.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
        }>;
        approvalStatus: z$1.ZodNullable<z$1.ZodEnum<{
            waiting_for_approval: "waiting_for_approval";
            denied: "denied";
        }>>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"webSearch">;
        id: z$1.ZodString;
        queries: z$1.ZodArray<z$1.ZodString>;
        resultText: z$1.ZodNullable<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"webFetch">;
        id: z$1.ZodString;
        url: z$1.ZodString;
        prompt: z$1.ZodNullable<z$1.ZodString>;
        pattern: z$1.ZodNullable<z$1.ZodString>;
        resultText: z$1.ZodNullable<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"imageView">;
        id: z$1.ZodString;
        path: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"toolCall">;
        id: z$1.ZodString;
        server: z$1.ZodOptional<z$1.ZodString>;
        tool: z$1.ZodString;
        arguments: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodString, z$1.ZodUnknown>>;
        statusLabels: z$1.ZodOptional<z$1.ZodObject<{
            pending: z$1.ZodString;
            completed: z$1.ZodString;
        }, z$1.core.$strip>>;
        status: z$1.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
        }>;
        result: z$1.ZodOptional<z$1.ZodUnknown>;
        error: z$1.ZodOptional<z$1.ZodString>;
        durationMs: z$1.ZodOptional<z$1.ZodNumber>;
        truncation: z$1.ZodOptional<z$1.ZodObject<{
            aggregatedOutput: z$1.ZodOptional<z$1.ZodObject<{
                originalLength: z$1.ZodNumber;
                retainedHeadLength: z$1.ZodNumber;
                retainedTailLength: z$1.ZodNumber;
                truncatedAt: z$1.ZodNumber;
            }, z$1.core.$strip>>;
            result: z$1.ZodOptional<z$1.ZodObject<{
                originalLength: z$1.ZodNumber;
                retainedHeadLength: z$1.ZodNumber;
                retainedTailLength: z$1.ZodNumber;
                truncatedAt: z$1.ZodNumber;
            }, z$1.core.$strip>>;
            resultText: z$1.ZodOptional<z$1.ZodObject<{
                originalLength: z$1.ZodNumber;
                retainedHeadLength: z$1.ZodNumber;
                retainedTailLength: z$1.ZodNumber;
                truncatedAt: z$1.ZodNumber;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"reasoning">;
        id: z$1.ZodString;
        summary: z$1.ZodArray<z$1.ZodString>;
        content: z$1.ZodArray<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"plan">;
        id: z$1.ZodString;
        text: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"contextCompaction">;
        id: z$1.ZodString;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"backgroundTask">;
        id: z$1.ZodString;
        taskType: z$1.ZodString;
        description: z$1.ZodString;
        status: z$1.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
        }>;
        taskStatus: z$1.ZodEnum<{
            pending: "pending";
            running: "running";
            paused: "paused";
            completed: "completed";
            failed: "failed";
            killed: "killed";
            stopped: "stopped";
        }>;
        skipTranscript: z$1.ZodBoolean;
        workflowName: z$1.ZodOptional<z$1.ZodString>;
        workflow: z$1.ZodOptional<z$1.ZodObject<{
            phases: z$1.ZodArray<z$1.ZodObject<{
                index: z$1.ZodNumber;
                title: z$1.ZodString;
                kind: z$1.ZodOptional<z$1.ZodString>;
            }, z$1.core.$strip>>;
            agents: z$1.ZodArray<z$1.ZodObject<{
                index: z$1.ZodNumber;
                label: z$1.ZodString;
                state: z$1.ZodEnum<{
                    running: "running";
                    failed: "failed";
                    queued: "queued";
                    done: "done";
                    skipped: "skipped";
                }>;
                model: z$1.ZodString;
                attempt: z$1.ZodNumber;
                cached: z$1.ZodBoolean;
                lastProgressAt: z$1.ZodNumber;
                phaseIndex: z$1.ZodOptional<z$1.ZodNumber>;
                phaseTitle: z$1.ZodOptional<z$1.ZodString>;
                agentType: z$1.ZodOptional<z$1.ZodString>;
                isolation: z$1.ZodOptional<z$1.ZodString>;
                queuedAt: z$1.ZodOptional<z$1.ZodNumber>;
                startedAt: z$1.ZodOptional<z$1.ZodNumber>;
                lastToolName: z$1.ZodOptional<z$1.ZodString>;
                lastToolSummary: z$1.ZodOptional<z$1.ZodString>;
                promptPreview: z$1.ZodOptional<z$1.ZodString>;
                resultPreview: z$1.ZodOptional<z$1.ZodString>;
                error: z$1.ZodOptional<z$1.ZodString>;
                tokens: z$1.ZodOptional<z$1.ZodNumber>;
                toolCalls: z$1.ZodOptional<z$1.ZodNumber>;
                durationMs: z$1.ZodOptional<z$1.ZodNumber>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
        usage: z$1.ZodOptional<z$1.ZodObject<{
            totalTokens: z$1.ZodNumber;
            toolUses: z$1.ZodNumber;
            durationMs: z$1.ZodNumber;
        }, z$1.core.$strip>>;
        summary: z$1.ZodOptional<z$1.ZodString>;
        error: z$1.ZodOptional<z$1.ZodString>;
        outputFile: z$1.ZodOptional<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>], "type">;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"item/agentMessage/delta">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    itemId: z$1.ZodString;
    delta: z$1.ZodString;
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"item/commandExecution/outputDelta">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    itemId: z$1.ZodString;
    delta: z$1.ZodString;
    reset: z$1.ZodOptional<z$1.ZodBoolean>;
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"item/fileChange/outputDelta">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    itemId: z$1.ZodString;
    delta: z$1.ZodString;
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"item/reasoning/summaryTextDelta">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    itemId: z$1.ZodString;
    delta: z$1.ZodString;
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"item/reasoning/textDelta">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    itemId: z$1.ZodString;
    delta: z$1.ZodString;
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"item/plan/delta">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    itemId: z$1.ZodString;
    delta: z$1.ZodString;
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"item/mcpToolCall/progress">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    itemId: z$1.ZodString;
    message: z$1.ZodOptional<z$1.ZodString>;
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"item/toolCall/progress">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    itemId: z$1.ZodString;
    message: z$1.ZodOptional<z$1.ZodString>;
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"item/backgroundTask/progress">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    item: z$1.ZodObject<{
        type: z$1.ZodLiteral<"backgroundTask">;
        id: z$1.ZodString;
        taskType: z$1.ZodString;
        description: z$1.ZodString;
        status: z$1.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
        }>;
        taskStatus: z$1.ZodEnum<{
            pending: "pending";
            running: "running";
            paused: "paused";
            completed: "completed";
            failed: "failed";
            killed: "killed";
            stopped: "stopped";
        }>;
        skipTranscript: z$1.ZodBoolean;
        workflowName: z$1.ZodOptional<z$1.ZodString>;
        workflow: z$1.ZodOptional<z$1.ZodObject<{
            phases: z$1.ZodArray<z$1.ZodObject<{
                index: z$1.ZodNumber;
                title: z$1.ZodString;
                kind: z$1.ZodOptional<z$1.ZodString>;
            }, z$1.core.$strip>>;
            agents: z$1.ZodArray<z$1.ZodObject<{
                index: z$1.ZodNumber;
                label: z$1.ZodString;
                state: z$1.ZodEnum<{
                    running: "running";
                    failed: "failed";
                    queued: "queued";
                    done: "done";
                    skipped: "skipped";
                }>;
                model: z$1.ZodString;
                attempt: z$1.ZodNumber;
                cached: z$1.ZodBoolean;
                lastProgressAt: z$1.ZodNumber;
                phaseIndex: z$1.ZodOptional<z$1.ZodNumber>;
                phaseTitle: z$1.ZodOptional<z$1.ZodString>;
                agentType: z$1.ZodOptional<z$1.ZodString>;
                isolation: z$1.ZodOptional<z$1.ZodString>;
                queuedAt: z$1.ZodOptional<z$1.ZodNumber>;
                startedAt: z$1.ZodOptional<z$1.ZodNumber>;
                lastToolName: z$1.ZodOptional<z$1.ZodString>;
                lastToolSummary: z$1.ZodOptional<z$1.ZodString>;
                promptPreview: z$1.ZodOptional<z$1.ZodString>;
                resultPreview: z$1.ZodOptional<z$1.ZodString>;
                error: z$1.ZodOptional<z$1.ZodString>;
                tokens: z$1.ZodOptional<z$1.ZodNumber>;
                toolCalls: z$1.ZodOptional<z$1.ZodNumber>;
                durationMs: z$1.ZodOptional<z$1.ZodNumber>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
        usage: z$1.ZodOptional<z$1.ZodObject<{
            totalTokens: z$1.ZodNumber;
            toolUses: z$1.ZodNumber;
            durationMs: z$1.ZodNumber;
        }, z$1.core.$strip>>;
        summary: z$1.ZodOptional<z$1.ZodString>;
        error: z$1.ZodOptional<z$1.ZodString>;
        outputFile: z$1.ZodOptional<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"item/backgroundTask/completed">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    item: z$1.ZodObject<{
        type: z$1.ZodLiteral<"backgroundTask">;
        id: z$1.ZodString;
        taskType: z$1.ZodString;
        description: z$1.ZodString;
        status: z$1.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
            interrupted: "interrupted";
        }>;
        taskStatus: z$1.ZodEnum<{
            pending: "pending";
            running: "running";
            paused: "paused";
            completed: "completed";
            failed: "failed";
            killed: "killed";
            stopped: "stopped";
        }>;
        skipTranscript: z$1.ZodBoolean;
        workflowName: z$1.ZodOptional<z$1.ZodString>;
        workflow: z$1.ZodOptional<z$1.ZodObject<{
            phases: z$1.ZodArray<z$1.ZodObject<{
                index: z$1.ZodNumber;
                title: z$1.ZodString;
                kind: z$1.ZodOptional<z$1.ZodString>;
            }, z$1.core.$strip>>;
            agents: z$1.ZodArray<z$1.ZodObject<{
                index: z$1.ZodNumber;
                label: z$1.ZodString;
                state: z$1.ZodEnum<{
                    running: "running";
                    failed: "failed";
                    queued: "queued";
                    done: "done";
                    skipped: "skipped";
                }>;
                model: z$1.ZodString;
                attempt: z$1.ZodNumber;
                cached: z$1.ZodBoolean;
                lastProgressAt: z$1.ZodNumber;
                phaseIndex: z$1.ZodOptional<z$1.ZodNumber>;
                phaseTitle: z$1.ZodOptional<z$1.ZodString>;
                agentType: z$1.ZodOptional<z$1.ZodString>;
                isolation: z$1.ZodOptional<z$1.ZodString>;
                queuedAt: z$1.ZodOptional<z$1.ZodNumber>;
                startedAt: z$1.ZodOptional<z$1.ZodNumber>;
                lastToolName: z$1.ZodOptional<z$1.ZodString>;
                lastToolSummary: z$1.ZodOptional<z$1.ZodString>;
                promptPreview: z$1.ZodOptional<z$1.ZodString>;
                resultPreview: z$1.ZodOptional<z$1.ZodString>;
                error: z$1.ZodOptional<z$1.ZodString>;
                tokens: z$1.ZodOptional<z$1.ZodNumber>;
                toolCalls: z$1.ZodOptional<z$1.ZodNumber>;
                durationMs: z$1.ZodOptional<z$1.ZodNumber>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
        usage: z$1.ZodOptional<z$1.ZodObject<{
            totalTokens: z$1.ZodNumber;
            toolUses: z$1.ZodNumber;
            durationMs: z$1.ZodNumber;
        }, z$1.core.$strip>>;
        summary: z$1.ZodOptional<z$1.ZodString>;
        error: z$1.ZodOptional<z$1.ZodString>;
        outputFile: z$1.ZodOptional<z$1.ZodString>;
        parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"thread/tokenUsage/updated">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    tokenUsage: z$1.ZodObject<{
        total: z$1.ZodObject<{
            totalTokens: z$1.ZodNumber;
            inputTokens: z$1.ZodNumber;
            cachedInputTokens: z$1.ZodNumber;
            outputTokens: z$1.ZodNumber;
            reasoningOutputTokens: z$1.ZodNumber;
        }, z$1.core.$strip>;
        last: z$1.ZodObject<{
            totalTokens: z$1.ZodNumber;
            inputTokens: z$1.ZodNumber;
            cachedInputTokens: z$1.ZodNumber;
            outputTokens: z$1.ZodNumber;
            reasoningOutputTokens: z$1.ZodNumber;
        }, z$1.core.$strip>;
        modelContextWindow: z$1.ZodNullable<z$1.ZodNumber>;
    }, z$1.core.$strip>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"thread/contextWindowUsage/updated">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    contextWindowUsage: z$1.ZodObject<{
        usedTokens: z$1.ZodNullable<z$1.ZodNumber>;
        modelContextWindow: z$1.ZodNullable<z$1.ZodNumber>;
        estimated: z$1.ZodBoolean;
    }, z$1.core.$strip>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"turn/plan/updated">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    plan: z$1.ZodArray<z$1.ZodObject<{
        step: z$1.ZodString;
        status: z$1.ZodOptional<z$1.ZodEnum<{
            pending: "pending";
            completed: "completed";
            failed: "failed";
            active: "active";
        }>>;
    }, z$1.core.$strip>>;
    explanation: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"turn/diff/updated">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    diff: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"provider/error">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    message: z$1.ZodString;
    detail: z$1.ZodOptional<z$1.ZodString>;
    willRetry: z$1.ZodOptional<z$1.ZodBoolean>;
    errorInfo: z$1.ZodOptional<z$1.ZodObject<{
        category: z$1.ZodEnum<{
            unknown: "unknown";
            "active-turn-not-steerable": "active-turn-not-steerable";
            "bad-request": "bad-request";
            "connection-failed": "connection-failed";
            "context-window-exceeded": "context-window-exceeded";
            billing: "billing";
            "budget-exceeded": "budget-exceeded";
            internal: "internal";
            "max-output-tokens": "max-output-tokens";
            "max-turns": "max-turns";
            overloaded: "overloaded";
            policy: "policy";
            "rate-limit": "rate-limit";
            sandbox: "sandbox";
            "stream-disconnected": "stream-disconnected";
            "structured-output-retries": "structured-output-retries";
            "thread-rollback-failed": "thread-rollback-failed";
            "too-many-failed-attempts": "too-many-failed-attempts";
            unauthorized: "unauthorized";
        }>;
        providerCode: z$1.ZodNullable<z$1.ZodString>;
        httpStatusCode: z$1.ZodNullable<z$1.ZodNumber>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"provider/rateLimits/updated">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    rateLimits: z$1.ZodObject<{
        providerId: z$1.ZodString;
        status: z$1.ZodEnum<{
            unknown: "unknown";
            warning: "warning";
            allowed: "allowed";
            blocked: "blocked";
        }>;
        kind: z$1.ZodEnum<{
            unknown: "unknown";
            "subscription-window": "subscription-window";
            credits: "credits";
            "spend-control": "spend-control";
        }>;
        windows: z$1.ZodArray<z$1.ZodObject<{
            providerKey: z$1.ZodNullable<z$1.ZodString>;
            label: z$1.ZodNullable<z$1.ZodString>;
            status: z$1.ZodEnum<{
                unknown: "unknown";
                warning: "warning";
                allowed: "allowed";
                blocked: "blocked";
            }>;
            resetsAtMs: z$1.ZodNullable<z$1.ZodNumber>;
        }, z$1.core.$strip>>;
        reachedReason: z$1.ZodNullable<z$1.ZodString>;
        overageStatus: z$1.ZodNullable<z$1.ZodEnum<{
            warning: "warning";
            rejected: "rejected";
            allowed: "allowed";
            unavailable: "unavailable";
        }>>;
        overageReason: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"provider/warning">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    category: z$1.ZodEnum<{
        deprecation: "deprecation";
        config: "config";
        general: "general";
    }>;
    summary: z$1.ZodOptional<z$1.ZodString>;
    details: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"provider/modelFallback">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    originalModel: z$1.ZodString;
    fallbackModel: z$1.ZodString;
    reason: z$1.ZodEnum<{
        refusal: "refusal";
        provider: "provider";
    }>;
    message: z$1.ZodString;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"provider/unhandled">;
    threadId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    providerId: z$1.ZodString;
    rawType: z$1.ZodString;
    rawEvent: z$1.ZodObject<{
        jsonrpc: z$1.ZodLiteral<"2.0">;
        id: z$1.ZodOptional<z$1.ZodUnion<readonly [z$1.ZodString, z$1.ZodNumber]>>;
        method: z$1.ZodString;
        params: z$1.ZodOptional<z$1.ZodType<JsonValue$1, unknown, z$1.core.$ZodTypeInternals<JsonValue$1, unknown>>>;
    }, z$1.core.$strip>;
    parentToolCallId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>], "type">, z$1.ZodObject<{
    scope: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"thread">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"turn">;
        turnId: z$1.ZodString;
    }, z$1.core.$strip>], "kind">;
}, z$1.core.$strip>>, z$1.ZodIntersection<z$1.ZodUnion<readonly [z$1.ZodObject<{
    type: z$1.ZodLiteral<"client/thread/start">;
    threadId: z$1.ZodString;
    direction: z$1.ZodLiteral<"outbound">;
    source: z$1.ZodEnum<{
        spawn: "spawn";
        tell: "tell";
    }>;
    initiator: z$1.ZodEnum<{
        user: "user";
        system: "system";
        agent: "agent";
    }>;
    request: z$1.ZodObject<{
        method: z$1.ZodEnum<{
            "thread/start": "thread/start";
            "turn/start": "turn/start";
        }>;
        params: z$1.ZodRecord<z$1.ZodString, z$1.ZodUnknown>;
    }, z$1.core.$strip>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"client/turn/requested">;
    threadId: z$1.ZodString;
    direction: z$1.ZodLiteral<"outbound">;
    requestId: z$1.ZodString;
    continuationOfRequestId: z$1.ZodOptional<z$1.ZodString>;
    source: z$1.ZodEnum<{
        spawn: "spawn";
        tell: "tell";
    }>;
    initiator: z$1.ZodEnum<{
        user: "user";
        system: "system";
        agent: "agent";
    }>;
    senderThreadId: z$1.ZodNullable<z$1.ZodString>;
    systemMessageKind: z$1.ZodOptional<z$1.ZodEnum<{
        "ownership-assigned": "ownership-assigned";
        "ownership-removed": "ownership-removed";
        "child-needs-attention": "child-needs-attention";
        "child-completed": "child-completed";
        "child-failed": "child-failed";
        "child-interrupted": "child-interrupted";
        "child-outcome-batch": "child-outcome-batch";
        unlabeled: "unlabeled";
    }>>;
    systemMessageSubject: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"thread">;
        threadId: z$1.ZodString;
        threadName: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"thread-batch">;
        count: z$1.ZodNumber;
    }, z$1.core.$strip>], "kind">>>;
    input: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"text">;
        text: z$1.ZodString;
        mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            start: z$1.ZodNumber;
            end: z$1.ZodNumber;
            resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"thread">;
                threadId: z$1.ZodString;
                projectId: z$1.ZodOptional<z$1.ZodString>;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"project">;
                projectId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"section">;
                sectionId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"path">;
                source: z$1.ZodEnum<{
                    workspace: "workspace";
                    "thread-storage": "thread-storage";
                }>;
                entryKind: z$1.ZodEnum<{
                    file: "file";
                    directory: "directory";
                }>;
                path: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"command">;
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
                name: z$1.ZodString;
                source: z$1.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                origin: z$1.ZodEnum<{
                    user: "user";
                    project: "project";
                    builtin: "builtin";
                }>;
                label: z$1.ZodString;
                argumentHint: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"plugin">;
                pluginId: z$1.ZodString;
                icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                itemId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>], "kind">>;
        }, z$1.core.$strip>>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"image">;
        url: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localImage">;
        path: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localFile">;
        path: z$1.ZodString;
        name: z$1.ZodOptional<z$1.ZodString>;
        sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
        mimeType: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>], "type">>;
    inputGroups: z$1.ZodOptional<z$1.ZodArray<z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"text">;
        text: z$1.ZodString;
        mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            start: z$1.ZodNumber;
            end: z$1.ZodNumber;
            resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"thread">;
                threadId: z$1.ZodString;
                projectId: z$1.ZodOptional<z$1.ZodString>;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"project">;
                projectId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"section">;
                sectionId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"path">;
                source: z$1.ZodEnum<{
                    workspace: "workspace";
                    "thread-storage": "thread-storage";
                }>;
                entryKind: z$1.ZodEnum<{
                    file: "file";
                    directory: "directory";
                }>;
                path: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"command">;
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
                name: z$1.ZodString;
                source: z$1.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                origin: z$1.ZodEnum<{
                    user: "user";
                    project: "project";
                    builtin: "builtin";
                }>;
                label: z$1.ZodString;
                argumentHint: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"plugin">;
                pluginId: z$1.ZodString;
                icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                itemId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>], "kind">>;
        }, z$1.core.$strip>>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"image">;
        url: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localImage">;
        path: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localFile">;
        path: z$1.ZodString;
        name: z$1.ZodOptional<z$1.ZodString>;
        sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
        mimeType: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>], "type">>>>;
    target: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"thread-start">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"new-turn">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"auto">;
        expectedTurnId: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"steer">;
        expectedTurnId: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>], "kind">;
    request: z$1.ZodObject<{
        method: z$1.ZodEnum<{
            "thread/start": "thread/start";
            "turn/start": "turn/start";
        }>;
        params: z$1.ZodRecord<z$1.ZodString, z$1.ZodUnknown>;
    }, z$1.core.$strip>;
    execution: z$1.ZodObject<{
        seq: z$1.ZodOptional<z$1.ZodNumber>;
        model: z$1.ZodString;
        serviceTier: z$1.ZodEnum<{
            default: "default";
            fast: "fast";
        }>;
        reasoningLevel: z$1.ZodEnum<{
            none: "none";
            low: "low";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            ultracode: "ultracode";
            max: "max";
            ultra: "ultra";
        }>;
        source: z$1.ZodEnum<{
            "client/thread/start": "client/thread/start";
            "client/turn/requested": "client/turn/requested";
            "client/turn/start": "client/turn/start";
        }>;
        permissionMode: z$1.ZodEnum<{
            readonly: "readonly";
            full: "full";
            auto: "auto";
            "accept-edits": "accept-edits";
            "workspace-write": "workspace-write";
        }>;
    }, z$1.core.$strip>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"client/turn/start">;
    threadId: z$1.ZodString;
    direction: z$1.ZodLiteral<"outbound">;
    source: z$1.ZodEnum<{
        spawn: "spawn";
        tell: "tell";
    }>;
    initiator: z$1.ZodEnum<{
        user: "user";
        system: "system";
        agent: "agent";
    }>;
    request: z$1.ZodObject<{
        method: z$1.ZodEnum<{
            "thread/start": "thread/start";
            "turn/start": "turn/start";
        }>;
        params: z$1.ZodRecord<z$1.ZodString, z$1.ZodUnknown>;
    }, z$1.core.$strip>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"system/error">;
    threadId: z$1.ZodString;
    code: z$1.ZodOptional<z$1.ZodString>;
    message: z$1.ZodString;
    detail: z$1.ZodOptional<z$1.ZodString>;
    reconnectAttempt: z$1.ZodOptional<z$1.ZodNumber>;
    reconnectTotal: z$1.ZodOptional<z$1.ZodNumber>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"system/manager/user_message">;
    threadId: z$1.ZodString;
    text: z$1.ZodString;
    toolCallId: z$1.ZodOptional<z$1.ZodString>;
    turnId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"system/thread/interrupted">;
    threadId: z$1.ZodString;
    reason: z$1.ZodEnum<{
        "manual-stop": "manual-stop";
        "host-daemon-restarted": "host-daemon-restarted";
        "provider-turn-idle": "provider-turn-idle";
    }>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"system/operation">;
    threadId: z$1.ZodString;
    operation: z$1.ZodString;
    status: z$1.ZodString;
    message: z$1.ZodString;
    operationId: z$1.ZodString;
    metadata: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodString, z$1.ZodType<JsonValue$1, unknown, z$1.core.$ZodTypeInternals<JsonValue$1, unknown>>>>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"system/permissionGrant/lifecycle">;
    threadId: z$1.ZodString;
    interactionId: z$1.ZodString;
    providerId: z$1.ZodString;
    providerRequestId: z$1.ZodString;
    status: z$1.ZodEnum<{
        pending: "pending";
        interrupted: "interrupted";
        resolving: "resolving";
        resolved: "resolved";
    }>;
    resolution: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        decision: z$1.ZodLiteral<"allow_once">;
        grantedPermissions: z$1.ZodNullable<z$1.ZodObject<{
            network: z$1.ZodNullable<z$1.ZodObject<{
                enabled: z$1.ZodNullable<z$1.ZodBoolean>;
            }, z$1.core.$strip>>;
            fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                read: z$1.ZodArray<z$1.ZodString>;
                write: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strict>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        decision: z$1.ZodLiteral<"allow_for_session">;
        grantedPermissions: z$1.ZodNullable<z$1.ZodObject<{
            network: z$1.ZodNullable<z$1.ZodObject<{
                enabled: z$1.ZodNullable<z$1.ZodBoolean>;
            }, z$1.core.$strip>>;
            fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                read: z$1.ZodArray<z$1.ZodString>;
                write: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strict>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        decision: z$1.ZodLiteral<"deny">;
    }, z$1.core.$strip>], "decision">>>;
    statusReason: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodString>>;
    subject: z$1.ZodObject<{
        kind: z$1.ZodLiteral<"permission_grant">;
        itemId: z$1.ZodString;
        toolName: z$1.ZodNullable<z$1.ZodString>;
        permissions: z$1.ZodObject<{
            network: z$1.ZodNullable<z$1.ZodObject<{
                enabled: z$1.ZodNullable<z$1.ZodBoolean>;
            }, z$1.core.$strip>>;
            fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                read: z$1.ZodArray<z$1.ZodString>;
                write: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strict>;
    }, z$1.core.$strip>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"system/userQuestion/lifecycle">;
    threadId: z$1.ZodString;
    interactionId: z$1.ZodString;
    providerId: z$1.ZodString;
    providerRequestId: z$1.ZodString;
    status: z$1.ZodEnum<{
        pending: "pending";
        interrupted: "interrupted";
        resolving: "resolving";
        resolved: "resolved";
    }>;
    resolution: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodObject<{
        kind: z$1.ZodLiteral<"user_answer">;
        answers: z$1.ZodRecord<z$1.ZodString, z$1.ZodObject<{
            selected: z$1.ZodArray<z$1.ZodString>;
            freeText: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>>>;
    statusReason: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodString>>;
    payload: z$1.ZodObject<{
        kind: z$1.ZodLiteral<"user_question">;
        questions: z$1.ZodArray<z$1.ZodObject<{
            id: z$1.ZodString;
            prompt: z$1.ZodString;
            shortLabel: z$1.ZodOptional<z$1.ZodString>;
            multiSelect: z$1.ZodBoolean;
            options: z$1.ZodOptional<z$1.ZodArray<z$1.ZodObject<{
                value: z$1.ZodString;
                label: z$1.ZodString;
                description: z$1.ZodOptional<z$1.ZodString>;
            }, z$1.core.$strip>>>;
            allowFreeText: z$1.ZodBoolean;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"system/thread-provisioning">;
    threadId: z$1.ZodString;
    provisioningId: z$1.ZodString;
    status: z$1.ZodEnum<{
        completed: "completed";
        failed: "failed";
        active: "active";
        cancelled: "cancelled";
    }>;
    environmentId: z$1.ZodString;
    entries: z$1.ZodArray<z$1.ZodObject<{
        type: z$1.ZodEnum<{
            output: "output";
            step: "step";
        }>;
        key: z$1.ZodString;
        text: z$1.ZodString;
        startedAt: z$1.ZodOptional<z$1.ZodNumber>;
        status: z$1.ZodOptional<z$1.ZodEnum<{
            completed: "completed";
            failed: "failed";
            started: "started";
        }>>;
        metadata: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodString, z$1.ZodUnknown>>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"system/provider-turn-watchdog">;
    threadId: z$1.ZodString;
    reason: z$1.ZodLiteral<"provider-turn-idle">;
    thresholdMs: z$1.ZodNumber;
    elapsedMs: z$1.ZodNumber;
    activeTurnId: z$1.ZodString;
    activeTurnStartedAt: z$1.ZodNumber;
    lastActivityEventSequence: z$1.ZodNumber;
    lastActivityEventType: z$1.ZodString;
    lastActivityEventAt: z$1.ZodNumber;
    providerId: z$1.ZodString;
    providerThreadId: z$1.ZodNullable<z$1.ZodString>;
    firedAt: z$1.ZodNumber;
}, z$1.core.$strip>]>, z$1.ZodObject<{
    scope: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"thread">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"turn">;
        turnId: z$1.ZodString;
    }, z$1.core.$strip>], "kind">;
}, z$1.core.$strip>>]>>;
type ThreadEvent = z$1.infer<typeof threadEventSchema>;
type ThreadEventType = ThreadEvent["type"];

declare const providerInfoSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    displayName: z$1.ZodString;
    logoUrl: z$1.ZodNullable<z$1.ZodString>;
    capabilities: z$1.ZodObject<{
        supportsArchive: z$1.ZodBoolean;
        supportsRename: z$1.ZodBoolean;
        supportsServiceTier: z$1.ZodBoolean;
        supportsUserQuestion: z$1.ZodBoolean;
        supportsFork: z$1.ZodBoolean;
        supportedPermissionModes: z$1.ZodArray<z$1.ZodEnum<{
            full: "full";
            auto: "auto";
            "accept-edits": "accept-edits";
        }>>;
    }, z$1.core.$strip>;
    composerActions: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"skills">;
        trigger: z$1.ZodEnum<{
            "/": "/";
        }>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"plan">;
        command: z$1.ZodObject<{
            trigger: z$1.ZodEnum<{
                "/": "/";
            }>;
            name: z$1.ZodString;
            trailingText: z$1.ZodString;
        }, z$1.core.$strip>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"goal">;
        command: z$1.ZodObject<{
            trigger: z$1.ZodEnum<{
                "/": "/";
            }>;
            name: z$1.ZodString;
            trailingText: z$1.ZodString;
        }, z$1.core.$strip>;
    }, z$1.core.$strip>], "kind">>;
    available: z$1.ZodBoolean;
}, z$1.core.$strip>;
type ProviderInfo = z$1.infer<typeof providerInfoSchema>;

declare const threadEventScopeSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    kind: z$1.ZodLiteral<"thread">;
}, z$1.core.$strip>, z$1.ZodObject<{
    kind: z$1.ZodLiteral<"turn">;
    turnId: z$1.ZodString;
}, z$1.core.$strip>], "kind">;
type ThreadEventScope = z$1.infer<typeof threadEventScopeSchema>;

type ThreadEventByType = {
    [TType in ThreadEventType]: Extract<ThreadEvent, {
        type: TType;
    }>;
};
type ThreadEventForType<TType extends ThreadEventType> = ThreadEventByType[TType];
type StoredThreadEventDataFromEvent<TEvent extends ThreadEvent> = Omit<TEvent, "threadId" | "type" | "scope">;
interface ThreadEventRowBase {
    id: string;
    scope: ThreadEventScope;
    threadId: string;
    seq: number;
    createdAt: number;
}
type ThreadEventRowFromEvent<TEvent extends ThreadEvent> = ThreadEventRowBase & {
    type: TEvent["type"];
    data: StoredThreadEventDataFromEvent<TEvent>;
};
type ThreadEventRowOfType<TType extends ThreadEventType> = ThreadEventRowFromEvent<ThreadEventForType<TType>>;
type ThreadEventRow = {
    [TType in ThreadEventType]: ThreadEventRowOfType<TType>;
}[ThreadEventType];

declare const threadStatusSchema: z$1.ZodEnum<{
    error: "error";
    active: "active";
    starting: "starting";
    idle: "idle";
    stopping: "stopping";
}>;
type ThreadStatus = z$1.infer<typeof threadStatusSchema>;

declare const threadTimelinePendingTodosSchema: z$1.ZodObject<{
    sourceSeq: z$1.ZodNumber;
    updatedAt: z$1.ZodNumber;
    items: z$1.ZodArray<z$1.ZodObject<{
        id: z$1.ZodString;
        text: z$1.ZodString;
        status: z$1.ZodEnum<{
            pending: "pending";
            completed: "completed";
            in_progress: "in_progress";
        }>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type ThreadTimelinePendingTodos = z$1.infer<typeof threadTimelinePendingTodosSchema>;

declare const threadQueuedMessageSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    content: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"text">;
        text: z$1.ZodString;
        mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            start: z$1.ZodNumber;
            end: z$1.ZodNumber;
            resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"thread">;
                threadId: z$1.ZodString;
                projectId: z$1.ZodOptional<z$1.ZodString>;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"project">;
                projectId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"section">;
                sectionId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"path">;
                source: z$1.ZodEnum<{
                    workspace: "workspace";
                    "thread-storage": "thread-storage";
                }>;
                entryKind: z$1.ZodEnum<{
                    file: "file";
                    directory: "directory";
                }>;
                path: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"command">;
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
                name: z$1.ZodString;
                source: z$1.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                origin: z$1.ZodEnum<{
                    user: "user";
                    project: "project";
                    builtin: "builtin";
                }>;
                label: z$1.ZodString;
                argumentHint: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"plugin">;
                pluginId: z$1.ZodString;
                icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                itemId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>], "kind">>;
        }, z$1.core.$strip>>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"image">;
        url: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localImage">;
        path: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localFile">;
        path: z$1.ZodString;
        name: z$1.ZodOptional<z$1.ZodString>;
        sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
        mimeType: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>], "type">>;
    model: z$1.ZodString;
    reasoningLevel: z$1.ZodEnum<{
        none: "none";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        ultracode: "ultracode";
        max: "max";
        ultra: "ultra";
    }>;
    permissionMode: z$1.ZodEnum<{
        full: "full";
        auto: "auto";
        "accept-edits": "accept-edits";
    }>;
    serviceTier: z$1.ZodEnum<{
        default: "default";
        fast: "fast";
    }>;
    groupWithNext: z$1.ZodBoolean;
    createdAt: z$1.ZodNumber;
    updatedAt: z$1.ZodNumber;
}, z$1.core.$strip>;
type ThreadQueuedMessage = z$1.infer<typeof threadQueuedMessageSchema>;

declare const createThreadEnvironmentArgsSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    type: z$1.ZodLiteral<"reuse">;
    environmentId: z$1.ZodString;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"host">;
    hostId: z$1.ZodOptional<z$1.ZodString>;
    workspace: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        type: z$1.ZodLiteral<"unmanaged">;
        path: z$1.ZodNullable<z$1.ZodString>;
        branch: z$1.ZodOptional<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"existing">;
            name: z$1.ZodString;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"new">;
            baseBranch: z$1.ZodString;
        }, z$1.core.$strict>], "kind">>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"managed-worktree">;
        baseBranch: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"named">;
            name: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"default">;
        }, z$1.core.$strip>], "kind">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"personal">;
    }, z$1.core.$strip>], "type">;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"project-default">;
}, z$1.core.$strip>], "type">;
type CreateThreadEnvironmentArgs = z$1.infer<typeof createThreadEnvironmentArgsSchema>;
declare const workspaceFileListResponseSchema: z$1.ZodObject<{
    files: z$1.ZodArray<z$1.ZodObject<{
        path: z$1.ZodString;
        name: z$1.ZodString;
    }, z$1.core.$strip>>;
    truncated: z$1.ZodBoolean;
}, z$1.core.$strip>;
type WorkspaceFileListResponse = z$1.infer<typeof workspaceFileListResponseSchema>;
declare const workspacePathListResponseSchema: z$1.ZodObject<{
    paths: z$1.ZodArray<z$1.ZodObject<{
        kind: z$1.ZodEnum<{
            file: "file";
            directory: "directory";
        }>;
        path: z$1.ZodString;
        name: z$1.ZodString;
        score: z$1.ZodNumber;
        positions: z$1.ZodArray<z$1.ZodNumber>;
    }, z$1.core.$strip>>;
    truncated: z$1.ZodBoolean;
}, z$1.core.$strip>;
type WorkspacePathListResponse = z$1.infer<typeof workspacePathListResponseSchema>;

declare const createProjectSourceRequestSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    hostId: z$1.ZodString;
    type: z$1.ZodLiteral<"local_path">;
    path: z$1.ZodPipe<z$1.ZodString, z$1.ZodTransform<string, string>>;
}, z$1.core.$strict>, z$1.ZodObject<{
    hostId: z$1.ZodString;
    type: z$1.ZodLiteral<"clone">;
    targetPath: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodString, z$1.ZodTransform<string, string>>>;
    remoteUrl: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strict>], "type">;
type CreateProjectSourceRequest = z$1.infer<typeof createProjectSourceRequestSchema>;
declare const createProjectRequestSchema: z$1.ZodObject<{
    name: z$1.ZodString;
    source: z$1.ZodObject<{
        hostId: z$1.ZodString;
        type: z$1.ZodLiteral<"local_path">;
        path: z$1.ZodPipe<z$1.ZodString, z$1.ZodTransform<string, string>>;
    }, z$1.core.$strict>;
}, z$1.core.$strip>;
type CreateProjectRequest = z$1.infer<typeof createProjectRequestSchema>;
declare const threadSectionSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    name: z$1.ZodString;
    createdAt: z$1.ZodNumber;
    updatedAt: z$1.ZodNumber;
}, z$1.core.$strict>;
type ThreadSectionResponse = z$1.infer<typeof threadSectionSchema>;
declare const createThreadSectionRequestSchema: z$1.ZodObject<{
    name: z$1.ZodString;
}, z$1.core.$strict>;
type CreateThreadSectionRequest = z$1.infer<typeof createThreadSectionRequestSchema>;
declare const updateThreadSectionRequestSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    name: z$1.ZodString;
}, z$1.core.$strict>;
type UpdateThreadSectionRequest = z$1.infer<typeof updateThreadSectionRequestSchema>;
declare const deleteThreadSectionRequestSchema: z$1.ZodObject<{
    id: z$1.ZodString;
}, z$1.core.$strict>;
type DeleteThreadSectionRequest = z$1.infer<typeof deleteThreadSectionRequestSchema>;
declare const threadSectionMutationResponseSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    name: z$1.ZodString;
    updatedThreadCount: z$1.ZodNumber;
}, z$1.core.$strict>;
type ThreadSectionMutationResponse = z$1.infer<typeof threadSectionMutationResponseSchema>;
declare const reorderProjectRequestSchema: z$1.ZodObject<{
    previousProjectId: z$1.ZodNullable<z$1.ZodString>;
    nextProjectId: z$1.ZodNullable<z$1.ZodString>;
}, z$1.core.$strip>;
type ReorderProjectRequest = z$1.infer<typeof reorderProjectRequestSchema>;
declare const projectListQuerySchema: z$1.ZodObject<{
    include: z$1.ZodOptional<z$1.ZodString>;
    includePersonal: z$1.ZodOptional<z$1.ZodEnum<{
        true: "true";
        false: "false";
    }>>;
}, z$1.core.$strip>;
type ProjectListQuery = z$1.infer<typeof projectListQuerySchema>;
declare const projectFilesQuerySchema: z$1.ZodObject<{
    query: z$1.ZodOptional<z$1.ZodOptional<z$1.ZodString>>;
    limit: z$1.ZodOptional<z$1.ZodOptional<z$1.ZodString>>;
    hostId: z$1.ZodOptional<z$1.ZodString>;
    environmentId: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodOptional<z$1.ZodString>>>;
}, z$1.core.$strip>;
type ProjectFilesQuery = z$1.infer<typeof projectFilesQuerySchema>;
declare const projectPathsQuerySchema: z$1.ZodObject<{
    query: z$1.ZodOptional<z$1.ZodOptional<z$1.ZodString>>;
    limit: z$1.ZodOptional<z$1.ZodOptional<z$1.ZodString>>;
    includeFiles: z$1.ZodEnum<{
        true: "true";
        false: "false";
    }>;
    includeDirectories: z$1.ZodEnum<{
        true: "true";
        false: "false";
    }>;
    hostId: z$1.ZodOptional<z$1.ZodString>;
    environmentId: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodOptional<z$1.ZodString>>>;
}, z$1.core.$strip>;
type ProjectPathsQuery = z$1.infer<typeof projectPathsQuerySchema>;
declare const projectFileContentQuerySchema: z$1.ZodObject<{
    path: z$1.ZodString;
    hostId: z$1.ZodOptional<z$1.ZodString>;
    environmentId: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodOptional<z$1.ZodString>>>;
}, z$1.core.$strip>;
type ProjectFileContentQuery = z$1.infer<typeof projectFileContentQuerySchema>;
declare const projectBranchesQuerySchema: z$1.ZodObject<{
    query: z$1.ZodOptional<z$1.ZodString>;
    limit: z$1.ZodOptional<z$1.ZodString>;
    hostId: z$1.ZodString;
    selectedBranch: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type ProjectBranchesQuery = z$1.infer<typeof projectBranchesQuerySchema>;
declare const projectBranchesResponseSchema: z$1.ZodObject<{
    branches: z$1.ZodArray<z$1.ZodString>;
    branchesTruncated: z$1.ZodBoolean;
    checkout: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"branch">;
        branchName: z$1.ZodString;
        headSha: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"detached">;
        headSha: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"unborn">;
        branchName: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"unknown">;
        reason: z$1.ZodString;
    }, z$1.core.$strip>], "kind">;
    defaultBranch: z$1.ZodNullable<z$1.ZodString>;
    defaultBranchRelation: z$1.ZodNullable<z$1.ZodEnum<{
        unknown: "unknown";
        equal: "equal";
        "local-behind": "local-behind";
        "local-ahead": "local-ahead";
        diverged: "diverged";
    }>>;
    hasUncommittedChanges: z$1.ZodBoolean;
    operation: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"none">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"merge">;
        hasConflicts: z$1.ZodBoolean;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"rebase">;
        hasConflicts: z$1.ZodBoolean;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"cherry-pick">;
        hasConflicts: z$1.ZodBoolean;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"revert">;
        hasConflicts: z$1.ZodBoolean;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"unknown">;
        reason: z$1.ZodString;
        hasConflicts: z$1.ZodBoolean;
    }, z$1.core.$strip>], "kind">;
    originDefaultBranch: z$1.ZodNullable<z$1.ZodString>;
    remoteBranches: z$1.ZodArray<z$1.ZodString>;
    remoteBranchesTruncated: z$1.ZodBoolean;
    selectedBranch: z$1.ZodNullable<z$1.ZodObject<{
        name: z$1.ZodString;
        kind: z$1.ZodEnum<{
            local: "local";
            remote: "remote";
            missing: "missing";
        }>;
    }, z$1.core.$strip>>;
    defaultWorktreeBaseBranch: z$1.ZodNullable<z$1.ZodString>;
}, z$1.core.$strip>;
type ProjectBranchesResponse = z$1.infer<typeof projectBranchesResponseSchema>;
declare const promptHistoryQuerySchema: z$1.ZodObject<{
    limit: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type PromptHistoryQuery = z$1.infer<typeof promptHistoryQuerySchema>;
declare const promptHistoryResponseSchema: z$1.ZodArray<z$1.ZodObject<{
    id: z$1.ZodString;
    createdAt: z$1.ZodNumber;
    input: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"text">;
        text: z$1.ZodString;
        mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            start: z$1.ZodNumber;
            end: z$1.ZodNumber;
            resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"thread">;
                threadId: z$1.ZodString;
                projectId: z$1.ZodOptional<z$1.ZodString>;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"project">;
                projectId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"section">;
                sectionId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"path">;
                source: z$1.ZodEnum<{
                    workspace: "workspace";
                    "thread-storage": "thread-storage";
                }>;
                entryKind: z$1.ZodEnum<{
                    file: "file";
                    directory: "directory";
                }>;
                path: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"command">;
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
                name: z$1.ZodString;
                source: z$1.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                origin: z$1.ZodEnum<{
                    user: "user";
                    project: "project";
                    builtin: "builtin";
                }>;
                label: z$1.ZodString;
                argumentHint: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"plugin">;
                pluginId: z$1.ZodString;
                icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                itemId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>], "kind">>;
        }, z$1.core.$strip>>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"image">;
        url: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localImage">;
        path: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localFile">;
        path: z$1.ZodString;
        name: z$1.ZodOptional<z$1.ZodString>;
        sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
        mimeType: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>], "type">>;
}, z$1.core.$strip>>;
type PromptHistoryResponse = z$1.infer<typeof promptHistoryResponseSchema>;
declare const updateProjectRequestSchema: z$1.ZodObject<{
    name: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type UpdateProjectRequest = z$1.infer<typeof updateProjectRequestSchema>;
declare const updateProjectSourceRequestSchema: z$1.ZodObject<{
    type: z$1.ZodLiteral<"local_path">;
    path: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodString, z$1.ZodTransform<string, string>>>;
    isDefault: z$1.ZodOptional<z$1.ZodLiteral<true>>;
}, z$1.core.$strict>;
type UpdateProjectSourceRequest = z$1.infer<typeof updateProjectSourceRequestSchema>;
declare const commandListResponseSchema: z$1.ZodObject<{
    commands: z$1.ZodArray<z$1.ZodObject<{
        name: z$1.ZodString;
        source: z$1.ZodEnum<{
            command: "command";
            skill: "skill";
        }>;
        origin: z$1.ZodEnum<{
            user: "user";
            project: "project";
            builtin: "builtin";
        }>;
        description: z$1.ZodNullable<z$1.ZodString>;
        argumentHint: z$1.ZodNullable<z$1.ZodString>;
        pluginId: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type CommandListResponse = z$1.infer<typeof commandListResponseSchema>;
/** Query for the complete command catalog available to a project and provider. */
declare const projectCommandsQuerySchema: z$1.ZodObject<{
    provider: z$1.ZodString;
    hostId: z$1.ZodOptional<z$1.ZodString>;
    environmentId: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodOptional<z$1.ZodString>>>;
}, z$1.core.$strict>;
type ProjectCommandsQuery = z$1.infer<typeof projectCommandsQuerySchema>;
declare const skillListResponseSchema: z$1.ZodObject<{
    skills: z$1.ZodArray<z$1.ZodObject<{
        id: z$1.ZodString;
        name: z$1.ZodString;
        description: z$1.ZodNullable<z$1.ZodString>;
        provider: z$1.ZodNullable<z$1.ZodEnum<{
            "claude-code": "claude-code";
            codex: "codex";
            "acp-cursor": "acp-cursor";
        }>>;
        scope: z$1.ZodEnum<{
            plugin: "plugin";
            "patcher-builtin": "patcher-builtin";
            "patcher-user": "patcher-user";
            "patcher-project": "patcher-project";
            "claude-user": "claude-user";
            "claude-project": "claude-project";
            "codex-user": "codex-user";
            "codex-project": "codex-project";
            "cursor-user": "cursor-user";
            "cursor-project": "cursor-project";
            "shared-user": "shared-user";
            "shared-project": "shared-project";
        }>;
        pluginId: z$1.ZodNullable<z$1.ZodString>;
        filePath: z$1.ZodString;
        manageable: z$1.ZodBoolean;
        registrySkillId: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type SkillListResponse = z$1.infer<typeof skillListResponseSchema>;
declare const skillContentResponseSchema: z$1.ZodObject<{
    content: z$1.ZodString;
    revision: z$1.ZodString;
}, z$1.core.$strip>;
type SkillContentResponse = z$1.infer<typeof skillContentResponseSchema>;
declare const skillFilesResponseSchema: z$1.ZodObject<{
    files: z$1.ZodArray<z$1.ZodString>;
    truncated: z$1.ZodBoolean;
}, z$1.core.$strip>;
type SkillFilesResponse = z$1.infer<typeof skillFilesResponseSchema>;
declare const projectResponseSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    kind: z$1.ZodEnum<{
        personal: "personal";
        standard: "standard";
    }>;
    name: z$1.ZodString;
    gitRemoteUrl: z$1.ZodNullable<z$1.ZodString>;
    createdAt: z$1.ZodNumber;
    updatedAt: z$1.ZodNumber;
    sources: z$1.ZodArray<z$1.ZodObject<{
        id: z$1.ZodString;
        projectId: z$1.ZodString;
        isDefault: z$1.ZodBoolean;
        createdAt: z$1.ZodNumber;
        updatedAt: z$1.ZodNumber;
        type: z$1.ZodLiteral<"local_path">;
        hostId: z$1.ZodString;
        path: z$1.ZodString;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type ProjectResponse = z$1.infer<typeof projectResponseSchema>;
declare const projectWithThreadsResponseSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    kind: z$1.ZodEnum<{
        personal: "personal";
        standard: "standard";
    }>;
    name: z$1.ZodString;
    gitRemoteUrl: z$1.ZodNullable<z$1.ZodString>;
    createdAt: z$1.ZodNumber;
    updatedAt: z$1.ZodNumber;
    sources: z$1.ZodArray<z$1.ZodObject<{
        id: z$1.ZodString;
        projectId: z$1.ZodString;
        isDefault: z$1.ZodBoolean;
        createdAt: z$1.ZodNumber;
        updatedAt: z$1.ZodNumber;
        type: z$1.ZodLiteral<"local_path">;
        hostId: z$1.ZodString;
        path: z$1.ZodString;
    }, z$1.core.$strip>>;
    threads: z$1.ZodArray<z$1.ZodObject<{
        id: z$1.ZodString;
        projectId: z$1.ZodString;
        environmentId: z$1.ZodNullable<z$1.ZodString>;
        providerId: z$1.ZodString;
        title: z$1.ZodNullable<z$1.ZodString>;
        titleFallback: z$1.ZodNullable<z$1.ZodString>;
        sectionId: z$1.ZodNullable<z$1.ZodString>;
        status: z$1.ZodEnum<{
            error: "error";
            stopping: "stopping";
            idle: "idle";
            starting: "starting";
            active: "active";
        }>;
        parentThreadId: z$1.ZodNullable<z$1.ZodString>;
        sourceThreadId: z$1.ZodNullable<z$1.ZodString>;
        originKind: z$1.ZodNullable<z$1.ZodEnum<{
            fork: "fork";
        }>>;
        childOrigin: z$1.ZodNullable<z$1.ZodEnum<{
            fork: "fork";
        }>>;
        originPluginId: z$1.ZodNullable<z$1.ZodString>;
        visibility: z$1.ZodEnum<{
            visible: "visible";
            hidden: "hidden";
        }>;
        archivedAt: z$1.ZodNullable<z$1.ZodNumber>;
        pinnedAt: z$1.ZodNullable<z$1.ZodNumber>;
        deletedAt: z$1.ZodNullable<z$1.ZodNumber>;
        lastReadAt: z$1.ZodNullable<z$1.ZodNumber>;
        latestAttentionAt: z$1.ZodNumber;
        createdAt: z$1.ZodNumber;
        updatedAt: z$1.ZodNumber;
        runtime: z$1.ZodObject<{
            displayStatus: z$1.ZodEnum<{
                error: "error";
                provisioning: "provisioning";
                stopping: "stopping";
                idle: "idle";
                starting: "starting";
                active: "active";
                "host-reconnecting": "host-reconnecting";
                "waiting-for-host": "waiting-for-host";
            }>;
            hostReconnectGraceExpiresAt: z$1.ZodNullable<z$1.ZodNumber>;
        }, z$1.core.$strip>;
        activity: z$1.ZodObject<{
            activeWorkflowCount: z$1.ZodNumber;
            activeBackgroundAgentCount: z$1.ZodNumber;
            activeBackgroundCommandCount: z$1.ZodNumber;
            activePlanModeCount: z$1.ZodNumber;
            activeGoalCount: z$1.ZodNumber;
        }, z$1.core.$strip>;
        pinSortKey: z$1.ZodNullable<z$1.ZodString>;
        hasPendingInteraction: z$1.ZodBoolean;
        environmentHostId: z$1.ZodNullable<z$1.ZodString>;
        environmentName: z$1.ZodNullable<z$1.ZodString>;
        environmentBranchName: z$1.ZodNullable<z$1.ZodString>;
        environmentWorkspaceDisplayKind: z$1.ZodEnum<{
            "managed-worktree": "managed-worktree";
            "unmanaged-worktree": "unmanaged-worktree";
            other: "other";
        }>;
    }, z$1.core.$strip>>;
    defaultExecutionOptions: z$1.ZodNullable<z$1.ZodObject<{
        providerId: z$1.ZodString;
        model: z$1.ZodString;
        serviceTier: z$1.ZodEnum<{
            default: "default";
            fast: "fast";
        }>;
        reasoningLevel: z$1.ZodEnum<{
            none: "none";
            low: "low";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            ultracode: "ultracode";
            max: "max";
            ultra: "ultra";
        }>;
        permissionMode: z$1.ZodEnum<{
            auto: "auto";
            "accept-edits": "accept-edits";
            full: "full";
        }>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type ProjectWithThreadsResponse = z$1.infer<typeof projectWithThreadsResponseSchema>;
declare const uploadedPromptAttachmentSchema: z$1.ZodObject<{
    type: z$1.ZodEnum<{
        localImage: "localImage";
        localFile: "localFile";
    }>;
    path: z$1.ZodString;
    name: z$1.ZodString;
    mimeType: z$1.ZodOptional<z$1.ZodString>;
    sizeBytes: z$1.ZodNumber;
}, z$1.core.$strip>;
type UploadedPromptAttachment = z$1.infer<typeof uploadedPromptAttachmentSchema>;
declare const copyProjectAttachmentsRequestSchema: z$1.ZodObject<{
    sourceProjectId: z$1.ZodString;
    paths: z$1.ZodArray<z$1.ZodString>;
}, z$1.core.$strict>;
type CopyProjectAttachmentsRequest = z$1.infer<typeof copyProjectAttachmentsRequestSchema>;

declare const registrySkillSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    source: z$1.ZodString;
    skillId: z$1.ZodString;
    name: z$1.ZodString;
    installs: z$1.ZodNumber;
    stars: z$1.ZodNullable<z$1.ZodNumber>;
    installUrl: z$1.ZodNullable<z$1.ZodString>;
    url: z$1.ZodString;
    topic: z$1.ZodNullable<z$1.ZodString>;
    summary: z$1.ZodNullable<z$1.ZodString>;
}, z$1.core.$strip>;
type RegistrySkill = z$1.infer<typeof registrySkillSchema>;
declare const registrySkillsPageSchema: z$1.ZodObject<{
    skills: z$1.ZodArray<z$1.ZodObject<{
        id: z$1.ZodString;
        source: z$1.ZodString;
        skillId: z$1.ZodString;
        name: z$1.ZodString;
        installs: z$1.ZodNumber;
        stars: z$1.ZodNullable<z$1.ZodNumber>;
        installUrl: z$1.ZodNullable<z$1.ZodString>;
        url: z$1.ZodString;
        topic: z$1.ZodNullable<z$1.ZodString>;
        summary: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>>;
    pagination: z$1.ZodObject<{
        page: z$1.ZodNumber;
        perPage: z$1.ZodNumber;
        total: z$1.ZodNumber;
        hasMore: z$1.ZodBoolean;
    }, z$1.core.$strip>;
}, z$1.core.$strip>;
type RegistrySkillsPage = z$1.infer<typeof registrySkillsPageSchema>;
declare const registryRepositoryStarsSchema: z$1.ZodObject<{
    stars: z$1.ZodNumber;
}, z$1.core.$strip>;
type RegistryRepositoryStars = z$1.infer<typeof registryRepositoryStarsSchema>;
declare const registrySkillDetailSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    source: z$1.ZodString;
    skillId: z$1.ZodString;
    hash: z$1.ZodNullable<z$1.ZodString>;
    files: z$1.ZodNullable<z$1.ZodArray<z$1.ZodObject<{
        path: z$1.ZodString;
        contents: z$1.ZodString;
    }, z$1.core.$strip>>>;
}, z$1.core.$strip>;
type RegistrySkillDetail = z$1.infer<typeof registrySkillDetailSchema>;
declare const registrySkillInstallResponseSchema: z$1.ZodObject<{
    ok: z$1.ZodLiteral<true>;
    filePath: z$1.ZodString;
}, z$1.core.$strip>;
type RegistrySkillInstallResponse = z$1.infer<typeof registrySkillInstallResponseSchema>;

declare const updateEnvironmentRequestSchema: z$1.ZodObject<{
    mergeBaseBranch: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
    name: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
}, z$1.core.$strip>;
type UpdateEnvironmentRequest = z$1.infer<typeof updateEnvironmentRequestSchema>;
/**
 * Query for searching paths in an environment's workspace. Unlike the
 * project-scoped variant this needs no `environmentId` — the environment is
 * the route param — and is project-agnostic, so it works for projectless
 * (personal) environments too.
 */
declare const environmentPathsQuerySchema: z$1.ZodObject<{
    query: z$1.ZodOptional<z$1.ZodString>;
    limit: z$1.ZodOptional<z$1.ZodString>;
    includeFiles: z$1.ZodEnum<{
        true: "true";
        false: "false";
    }>;
    includeDirectories: z$1.ZodEnum<{
        true: "true";
        false: "false";
    }>;
}, z$1.core.$strip>;
type EnvironmentPathsQuery = z$1.infer<typeof environmentPathsQuerySchema>;
declare const environmentDiffBranchesQuerySchema: z$1.ZodObject<{
    query: z$1.ZodOptional<z$1.ZodString>;
    limit: z$1.ZodOptional<z$1.ZodString>;
    selectedBranch: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type EnvironmentDiffBranchesQuery = z$1.infer<typeof environmentDiffBranchesQuerySchema>;
declare const environmentDiffBranchesResponseSchema: z$1.ZodObject<{
    branches: z$1.ZodArray<z$1.ZodString>;
    branchesTruncated: z$1.ZodBoolean;
    remoteBranches: z$1.ZodArray<z$1.ZodString>;
    remoteBranchesTruncated: z$1.ZodBoolean;
    selectedBranch: z$1.ZodNullable<z$1.ZodObject<{
        name: z$1.ZodString;
        kind: z$1.ZodEnum<{
            local: "local";
            remote: "remote";
            missing: "missing";
        }>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type EnvironmentDiffBranchesResponse = z$1.infer<typeof environmentDiffBranchesResponseSchema>;
declare const environmentStatusQuerySchema: z$1.ZodObject<{
    mergeBaseBranch: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodString, z$1.ZodString>>;
}, z$1.core.$strip>;
type EnvironmentStatusQuery = z$1.infer<typeof environmentStatusQuerySchema>;
declare const environmentDiffQuerySchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    target: z$1.ZodLiteral<"uncommitted">;
}, z$1.core.$strip>, z$1.ZodObject<{
    target: z$1.ZodLiteral<"branch_committed">;
    mergeBaseBranch: z$1.ZodPipe<z$1.ZodString, z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    target: z$1.ZodLiteral<"all">;
    mergeBaseBranch: z$1.ZodPipe<z$1.ZodString, z$1.ZodString>;
}, z$1.core.$strip>, z$1.ZodObject<{
    target: z$1.ZodLiteral<"commit">;
    sha: z$1.ZodString;
}, z$1.core.$strip>], "target">;
type EnvironmentDiffQuery = z$1.infer<typeof environmentDiffQuerySchema>;
/**
 * Query for fetching a single file's contents at one side of a diff target.
 * Used by the diff card to reparse the card's patch with full old/new contents
 * so `@pierre/diffs` can render expand-context buttons between hunks.
 *
 * For `branch_committed` / `all`, callers pass the resolved merge-base SHA
 * (`mergeBaseRef`, surfaced by `workspace.diff`) rather than the branch name
 * — the diff itself was computed against that SHA, so reading the old side
 * from the same SHA keeps the file content aligned with the hunk line
 * numbers. Reading from the branch tip is wrong whenever the branch has
 * moved past the merge-base since the file existed there.
 */
declare const environmentDiffFileQuerySchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    target: z$1.ZodLiteral<"uncommitted">;
    path: z$1.ZodString;
    side: z$1.ZodEnum<{
        new: "new";
        old: "old";
    }>;
}, z$1.core.$strip>, z$1.ZodObject<{
    target: z$1.ZodLiteral<"branch_committed">;
    mergeBaseRef: z$1.ZodString;
    path: z$1.ZodString;
    side: z$1.ZodEnum<{
        new: "new";
        old: "old";
    }>;
}, z$1.core.$strip>, z$1.ZodObject<{
    target: z$1.ZodLiteral<"all">;
    mergeBaseRef: z$1.ZodString;
    path: z$1.ZodString;
    side: z$1.ZodEnum<{
        new: "new";
        old: "old";
    }>;
}, z$1.core.$strip>, z$1.ZodObject<{
    target: z$1.ZodLiteral<"commit">;
    sha: z$1.ZodString;
    path: z$1.ZodString;
    side: z$1.ZodEnum<{
        new: "new";
        old: "old";
    }>;
}, z$1.core.$strip>], "target">;
type EnvironmentDiffFileQuery = z$1.infer<typeof environmentDiffFileQuerySchema>;
declare const environmentDiffFileResponseSchema: z$1.ZodObject<{
    path: z$1.ZodString;
    content: z$1.ZodString;
    contentEncoding: z$1.ZodEnum<{
        base64: "base64";
        utf8: "utf8";
    }>;
    mimeType: z$1.ZodOptional<z$1.ZodString>;
    sizeBytes: z$1.ZodNumber;
}, z$1.core.$strip>;
type EnvironmentDiffFileResponse = z$1.infer<typeof environmentDiffFileResponseSchema>;
declare const environmentArchiveThreadsResponseSchema: z$1.ZodObject<{
    ok: z$1.ZodLiteral<true>;
    archivedThreadIds: z$1.ZodArray<z$1.ZodString>;
}, z$1.core.$strip>;
type EnvironmentArchiveThreadsResponse = z$1.infer<typeof environmentArchiveThreadsResponseSchema>;
declare const pullRequestMergeMethodSchema: z$1.ZodEnum<{
    merge: "merge";
    rebase: "rebase";
    squash: "squash";
}>;
type PullRequestMergeMethod = z$1.infer<typeof pullRequestMergeMethodSchema>;
declare const commitActionResponseSchema: z$1.ZodObject<{
    ok: z$1.ZodLiteral<true>;
    action: z$1.ZodLiteral<"commit">;
    message: z$1.ZodString;
    commitSha: z$1.ZodString;
    commitSubject: z$1.ZodString;
}, z$1.core.$strip>;
type CommitActionResponse = z$1.infer<typeof commitActionResponseSchema>;
declare const squashMergeActionResponseSchema: z$1.ZodObject<{
    ok: z$1.ZodLiteral<true>;
    action: z$1.ZodLiteral<"squash_merge">;
    merged: z$1.ZodBoolean;
    message: z$1.ZodString;
    commitSha: z$1.ZodString;
    commitSubject: z$1.ZodString;
}, z$1.core.$strip>;
type SquashMergeActionResponse = z$1.infer<typeof squashMergeActionResponseSchema>;
declare const pullRequestReadyActionResponseSchema: z$1.ZodObject<{
    ok: z$1.ZodLiteral<true>;
    action: z$1.ZodLiteral<"pull_request_ready">;
    message: z$1.ZodString;
}, z$1.core.$strip>;
type PullRequestReadyActionResponse = z$1.infer<typeof pullRequestReadyActionResponseSchema>;
declare const pullRequestMergeActionResponseSchema: z$1.ZodObject<{
    ok: z$1.ZodLiteral<true>;
    action: z$1.ZodLiteral<"pull_request_merge">;
    method: z$1.ZodEnum<{
        merge: "merge";
        rebase: "rebase";
        squash: "squash";
    }>;
    message: z$1.ZodString;
}, z$1.core.$strip>;
type PullRequestMergeActionResponse = z$1.infer<typeof pullRequestMergeActionResponseSchema>;
declare const pullRequestDraftActionResponseSchema: z$1.ZodObject<{
    ok: z$1.ZodLiteral<true>;
    action: z$1.ZodLiteral<"pull_request_draft">;
    message: z$1.ZodString;
}, z$1.core.$strip>;
type PullRequestDraftActionResponse = z$1.infer<typeof pullRequestDraftActionResponseSchema>;
declare const environmentStatusResponseSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    outcome: z$1.ZodLiteral<"available">;
    workspace: z$1.ZodObject<{
        workingTree: z$1.ZodObject<{
            insertions: z$1.ZodNumber;
            deletions: z$1.ZodNumber;
            files: z$1.ZodArray<z$1.ZodObject<{
                path: z$1.ZodString;
                status: z$1.ZodEnum<{
                    M: "M";
                    A: "A";
                    D: "D";
                    R: "R";
                    C: "C";
                    U: "U";
                    "??": "??";
                    "?": "?";
                }>;
                insertions: z$1.ZodNullable<z$1.ZodNumber>;
                deletions: z$1.ZodNullable<z$1.ZodNumber>;
            }, z$1.core.$strip>>;
            hasUncommittedChanges: z$1.ZodBoolean;
            state: z$1.ZodEnum<{
                clean: "clean";
                untracked: "untracked";
                dirty_uncommitted: "dirty_uncommitted";
                committed_unmerged: "committed_unmerged";
                dirty_and_committed_unmerged: "dirty_and_committed_unmerged";
            }>;
        }, z$1.core.$strip>;
        checkout: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"branch">;
            branchName: z$1.ZodString;
            headSha: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"detached">;
            headSha: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"unborn">;
            branchName: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"unknown">;
            reason: z$1.ZodString;
        }, z$1.core.$strip>], "kind">;
        branch: z$1.ZodObject<{
            currentBranch: z$1.ZodNullable<z$1.ZodString>;
            defaultBranch: z$1.ZodString;
        }, z$1.core.$strip>;
        mergeBase: z$1.ZodNullable<z$1.ZodObject<{
            insertions: z$1.ZodNumber;
            deletions: z$1.ZodNumber;
            files: z$1.ZodArray<z$1.ZodObject<{
                path: z$1.ZodString;
                status: z$1.ZodEnum<{
                    M: "M";
                    A: "A";
                    D: "D";
                    R: "R";
                    C: "C";
                    U: "U";
                    "??": "??";
                    "?": "?";
                }>;
                insertions: z$1.ZodNullable<z$1.ZodNumber>;
                deletions: z$1.ZodNullable<z$1.ZodNumber>;
            }, z$1.core.$strip>>;
            mergeBaseBranch: z$1.ZodString;
            baseRef: z$1.ZodNullable<z$1.ZodString>;
            aheadCount: z$1.ZodNumber;
            behindCount: z$1.ZodNumber;
            hasCommittedUnmergedChanges: z$1.ZodBoolean;
            commits: z$1.ZodArray<z$1.ZodObject<{
                sha: z$1.ZodString;
                shortSha: z$1.ZodString;
                subject: z$1.ZodString;
                authorName: z$1.ZodString;
                authoredAt: z$1.ZodNumber;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>;
}, z$1.core.$strict>, z$1.ZodObject<{
    outcome: z$1.ZodLiteral<"not_applicable">;
    reason: z$1.ZodEnum<{
        non_git_environment: "non_git_environment";
    }>;
    message: z$1.ZodString;
}, z$1.core.$strict>, z$1.ZodObject<{
    outcome: z$1.ZodLiteral<"unavailable">;
    failure: z$1.ZodObject<{
        code: z$1.ZodEnum<{
            unknown: "unknown";
            path_not_found: "path_not_found";
            not_git_repo: "not_git_repo";
            not_worktree: "not_worktree";
            workspace_type_mismatch: "workspace_type_mismatch";
            permission_denied: "permission_denied";
            unknown_environment: "unknown_environment";
        }>;
        workspacePath: z$1.ZodString;
        message: z$1.ZodString;
    }, z$1.core.$strict>;
}, z$1.core.$strict>], "outcome">;
/**
 * Structured pull-request lookup outcome. "absent" is a real answer — the
 * host checked and the branch has no PR (non-git environments resolve to
 * "absent" without a daemon call). "unavailable" means the lookup itself
 * failed (gh missing, not authenticated, timeout, unreachable workspace), so
 * callers must not render it as "no PR exists".
 */
declare const environmentPullRequestResponseSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    outcome: z$1.ZodLiteral<"available">;
    pullRequest: z$1.ZodObject<{
        number: z$1.ZodNumber;
        title: z$1.ZodString;
        state: z$1.ZodEnum<{
            merged: "merged";
            draft: "draft";
            open: "open";
            closed: "closed";
        }>;
        url: z$1.ZodString;
        baseRefName: z$1.ZodString;
        headRefName: z$1.ZodString;
        updatedAt: z$1.ZodString;
        checks: z$1.ZodObject<{
            state: z$1.ZodEnum<{
                unknown: "unknown";
                pending: "pending";
                passing: "passing";
                failing: "failing";
                no_checks: "no_checks";
            }>;
            totalCount: z$1.ZodNumber;
            passedCount: z$1.ZodNumber;
            failedCount: z$1.ZodNumber;
            pendingCount: z$1.ZodNumber;
        }, z$1.core.$strict>;
        review: z$1.ZodObject<{
            state: z$1.ZodEnum<{
                none: "none";
                approved: "approved";
                changes_requested: "changes_requested";
                review_required: "review_required";
                review_requested: "review_requested";
            }>;
            reviewRequestCount: z$1.ZodNumber;
        }, z$1.core.$strict>;
        mergeability: z$1.ZodObject<{
            state: z$1.ZodEnum<{
                unknown: "unknown";
                blocked: "blocked";
                draft: "draft";
                mergeable: "mergeable";
                conflicts: "conflicts";
            }>;
            mergeStateStatus: z$1.ZodNullable<z$1.ZodEnum<{
                BEHIND: "BEHIND";
                BLOCKED: "BLOCKED";
                CLEAN: "CLEAN";
                DIRTY: "DIRTY";
                DRAFT: "DRAFT";
                HAS_HOOKS: "HAS_HOOKS";
                UNKNOWN: "UNKNOWN";
                UNSTABLE: "UNSTABLE";
            }>>;
            mergeable: z$1.ZodNullable<z$1.ZodEnum<{
                UNKNOWN: "UNKNOWN";
                CONFLICTING: "CONFLICTING";
                MERGEABLE: "MERGEABLE";
            }>>;
        }, z$1.core.$strict>;
        attention: z$1.ZodEnum<{
            blocked: "blocked";
            none: "none";
            merged: "merged";
            draft: "draft";
            closed: "closed";
            changes_requested: "changes_requested";
            review_requested: "review_requested";
            conflicts: "conflicts";
            checks_failed: "checks_failed";
            checks_pending: "checks_pending";
            ready_to_merge: "ready_to_merge";
        }>;
    }, z$1.core.$strict>;
}, z$1.core.$strict>, z$1.ZodObject<{
    outcome: z$1.ZodLiteral<"absent">;
}, z$1.core.$strict>, z$1.ZodObject<{
    outcome: z$1.ZodLiteral<"unavailable">;
    message: z$1.ZodString;
}, z$1.core.$strict>], "outcome">;
type EnvironmentPullRequestResponse = z$1.infer<typeof environmentPullRequestResponseSchema>;
declare const environmentDiffResponseSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    outcome: z$1.ZodLiteral<"available">;
    diff: z$1.ZodObject<{
        diff: z$1.ZodString;
        truncated: z$1.ZodBoolean;
        shortstat: z$1.ZodString;
        files: z$1.ZodString;
        mergeBaseRef: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>;
}, z$1.core.$strict>, z$1.ZodObject<{
    outcome: z$1.ZodLiteral<"not_applicable">;
    reason: z$1.ZodEnum<{
        non_git_environment: "non_git_environment";
    }>;
    message: z$1.ZodString;
}, z$1.core.$strict>, z$1.ZodObject<{
    outcome: z$1.ZodLiteral<"unavailable">;
    failure: z$1.ZodObject<{
        code: z$1.ZodEnum<{
            unknown: "unknown";
            path_not_found: "path_not_found";
            not_git_repo: "not_git_repo";
            not_worktree: "not_worktree";
            workspace_type_mismatch: "workspace_type_mismatch";
            permission_denied: "permission_denied";
            unknown_environment: "unknown_environment";
        }>;
        workspacePath: z$1.ZodString;
        message: z$1.ZodString;
    }, z$1.core.$strict>;
}, z$1.core.$strict>], "outcome">;
type EnvironmentDiffResponse = z$1.infer<typeof environmentDiffResponseSchema>;
declare const environmentDiffFilesResponseSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    outcome: z$1.ZodLiteral<"available">;
    files: z$1.ZodArray<z$1.ZodObject<{
        path: z$1.ZodString;
        previousPath: z$1.ZodNullable<z$1.ZodString>;
        changeKind: z$1.ZodEnum<{
            deleted: "deleted";
            added: "added";
            modified: "modified";
            renamed: "renamed";
            copied: "copied";
            type_changed: "type_changed";
        }>;
        additions: z$1.ZodNumber;
        deletions: z$1.ZodNumber;
        binary: z$1.ZodBoolean;
        origin: z$1.ZodEnum<{
            untracked: "untracked";
            tracked: "tracked";
        }>;
        loadMode: z$1.ZodEnum<{
            auto: "auto";
            on_demand: "on_demand";
            too_large: "too_large";
        }>;
    }, z$1.core.$strip>>;
    shortstat: z$1.ZodString;
    mergeBaseRef: z$1.ZodNullable<z$1.ZodString>;
    initialPatches: z$1.ZodArray<z$1.ZodObject<{
        path: z$1.ZodString;
        patch: z$1.ZodString;
        truncated: z$1.ZodBoolean;
    }, z$1.core.$strip>>;
}, z$1.core.$strict>, z$1.ZodObject<{
    outcome: z$1.ZodLiteral<"not_applicable">;
    reason: z$1.ZodEnum<{
        non_git_environment: "non_git_environment";
        too_many_files: "too_many_files";
    }>;
    message: z$1.ZodString;
}, z$1.core.$strict>, z$1.ZodObject<{
    outcome: z$1.ZodLiteral<"unavailable">;
    failure: z$1.ZodObject<{
        code: z$1.ZodEnum<{
            unknown: "unknown";
            path_not_found: "path_not_found";
            not_git_repo: "not_git_repo";
            not_worktree: "not_worktree";
            workspace_type_mismatch: "workspace_type_mismatch";
            permission_denied: "permission_denied";
            unknown_environment: "unknown_environment";
        }>;
        workspacePath: z$1.ZodString;
        message: z$1.ZodString;
    }, z$1.core.$strict>;
}, z$1.core.$strict>], "outcome">;
type EnvironmentDiffFilesResponse = z$1.infer<typeof environmentDiffFilesResponseSchema>;
declare const environmentDiffPatchResponseSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    outcome: z$1.ZodLiteral<"available">;
    patches: z$1.ZodArray<z$1.ZodObject<{
        path: z$1.ZodString;
        patch: z$1.ZodString;
        truncated: z$1.ZodBoolean;
    }, z$1.core.$strip>>;
}, z$1.core.$strict>, z$1.ZodObject<{
    outcome: z$1.ZodLiteral<"not_applicable">;
    reason: z$1.ZodEnum<{
        non_git_environment: "non_git_environment";
    }>;
    message: z$1.ZodString;
}, z$1.core.$strict>, z$1.ZodObject<{
    outcome: z$1.ZodLiteral<"unavailable">;
    failure: z$1.ZodObject<{
        code: z$1.ZodEnum<{
            unknown: "unknown";
            path_not_found: "path_not_found";
            not_git_repo: "not_git_repo";
            not_worktree: "not_worktree";
            workspace_type_mismatch: "workspace_type_mismatch";
            permission_denied: "permission_denied";
            unknown_environment: "unknown_environment";
        }>;
        workspacePath: z$1.ZodString;
        message: z$1.ZodString;
    }, z$1.core.$strict>;
}, z$1.core.$strict>], "outcome">;
type EnvironmentDiffPatchResponse = z$1.infer<typeof environmentDiffPatchResponseSchema>;
/**
 * Body for `POST /diff/patch`: the diff target plus the list of new paths whose
 * patches the client wants. A POST (not GET) because the repeated `paths` array
 * cannot survive flat query parsing. The client supplies only new paths; the
 * server re-derives each file's rename/copy pairing (`previousPath`) from its
 * own TOC.
 */
declare const environmentDiffPatchRequestSchema: z$1.ZodObject<{
    target: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        type: z$1.ZodLiteral<"uncommitted">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"branch_committed">;
        mergeBaseBranch: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"all">;
        mergeBaseBranch: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"commit">;
        sha: z$1.ZodString;
    }, z$1.core.$strip>], "type">;
    paths: z$1.ZodArray<z$1.ZodString>;
}, z$1.core.$strict>;
type EnvironmentDiffPatchRequest = z$1.infer<typeof environmentDiffPatchRequestSchema>;
type EnvironmentStatusResponse = z$1.infer<typeof environmentStatusResponseSchema>;

declare const providerUsageResponseSchema: z$1.ZodObject<{
    codex: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        status: z$1.ZodLiteral<"ok">;
        accountEmail: z$1.ZodNullable<z$1.ZodString>;
        planLabel: z$1.ZodNullable<z$1.ZodString>;
        windows: z$1.ZodArray<z$1.ZodObject<{
            label: z$1.ZodString;
            usedPercent: z$1.ZodNumber;
            resetsAt: z$1.ZodNullable<z$1.ZodString>;
            cost: z$1.ZodOptional<z$1.ZodObject<{
                usedUsdCents: z$1.ZodNumber;
                limitUsdCents: z$1.ZodNumber;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        status: z$1.ZodLiteral<"not_installed">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        status: z$1.ZodLiteral<"unauthenticated">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        status: z$1.ZodLiteral<"expired">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        status: z$1.ZodLiteral<"error">;
        message: z$1.ZodString;
        planLabel: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodString>>;
        accountEmail: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodString>>;
    }, z$1.core.$strip>], "status">;
    claudeCode: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        status: z$1.ZodLiteral<"ok">;
        accountEmail: z$1.ZodNullable<z$1.ZodString>;
        planLabel: z$1.ZodNullable<z$1.ZodString>;
        windows: z$1.ZodArray<z$1.ZodObject<{
            label: z$1.ZodString;
            usedPercent: z$1.ZodNumber;
            resetsAt: z$1.ZodNullable<z$1.ZodString>;
            cost: z$1.ZodOptional<z$1.ZodObject<{
                usedUsdCents: z$1.ZodNumber;
                limitUsdCents: z$1.ZodNumber;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        status: z$1.ZodLiteral<"not_installed">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        status: z$1.ZodLiteral<"unauthenticated">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        status: z$1.ZodLiteral<"expired">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        status: z$1.ZodLiteral<"error">;
        message: z$1.ZodString;
        planLabel: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodString>>;
        accountEmail: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodString>>;
    }, z$1.core.$strip>], "status">;
    cursor: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        status: z$1.ZodLiteral<"ok">;
        accountEmail: z$1.ZodNullable<z$1.ZodString>;
        planLabel: z$1.ZodNullable<z$1.ZodString>;
        windows: z$1.ZodArray<z$1.ZodObject<{
            label: z$1.ZodString;
            usedPercent: z$1.ZodNumber;
            resetsAt: z$1.ZodNullable<z$1.ZodString>;
            cost: z$1.ZodOptional<z$1.ZodObject<{
                usedUsdCents: z$1.ZodNumber;
                limitUsdCents: z$1.ZodNumber;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        status: z$1.ZodLiteral<"not_installed">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        status: z$1.ZodLiteral<"unauthenticated">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        status: z$1.ZodLiteral<"expired">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        status: z$1.ZodLiteral<"error">;
        message: z$1.ZodString;
        planLabel: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodString>>;
        accountEmail: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodString>>;
    }, z$1.core.$strip>], "status">;
}, z$1.core.$strip>;
type ProviderUsageResponse = z$1.infer<typeof providerUsageResponseSchema>;
declare const discoverReposResultSchema: z$1.ZodObject<{
    repos: z$1.ZodArray<z$1.ZodObject<{
        path: z$1.ZodString;
        name: z$1.ZodString;
        lastActivityAt: z$1.ZodString;
        originUrl: z$1.ZodNullable<z$1.ZodString>;
        agentSeen: z$1.ZodBoolean;
        agentSeenAt: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strict>>;
    truncated: z$1.ZodBoolean;
}, z$1.core.$strict>;
type DiscoverReposResult = z$1.infer<typeof discoverReposResultSchema>;
type HostDaemonCommandTransport = "settled" | "onlineRpc";
type HostDaemonCommandEnvironmentLane = "read" | "write";
type HostDaemonFlushEventsBeforeResult = boolean | "when-initiated";
interface HostDaemonCommandDescriptor<Type extends string, Schema extends z$1.ZodTypeAny, ResultSchema extends z$1.ZodTypeAny, Transport extends HostDaemonCommandTransport, Retryable extends boolean> {
    type: Type;
    schema: Schema;
    resultSchema: ResultSchema;
    transport: Transport;
    retryable: Retryable;
    flushEventsBeforeResult: HostDaemonFlushEventsBeforeResult;
    envLane: HostDaemonCommandEnvironmentLane | null;
}
declare const hostDaemonCommandRegistry: {
    "thread.rewind.discard": HostDaemonCommandDescriptor<"thread.rewind.discard", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        threadId: z$1.ZodString;
        type: z$1.ZodLiteral<"thread.rewind.discard">;
        leaseId: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{}, z$1.core.$strip>, "settled", false>;
    "thread.rewind.prepare": HostDaemonCommandDescriptor<"thread.rewind.prepare", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        threadId: z$1.ZodString;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                unmanaged: "unmanaged";
                "managed-worktree": "managed-worktree";
                personal: "personal";
            }>;
        }, z$1.core.$strip>;
        projectId: z$1.ZodString;
        providerId: z$1.ZodString;
        acpLaunchSpec: z$1.ZodOptional<z$1.ZodObject<{
            displayName: z$1.ZodString;
            command: z$1.ZodString;
            args: z$1.ZodArray<z$1.ZodString>;
            env: z$1.ZodRecord<z$1.ZodString, z$1.ZodString>;
            cwd: z$1.ZodOptional<z$1.ZodString>;
            modelCli: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodObject<{
                listArgs: z$1.ZodArray<z$1.ZodString>;
                selectFlag: z$1.ZodOptional<z$1.ZodString>;
                primaryModels: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strict>, z$1.ZodTransform<{
                listArgs: string[];
                primaryModels: string[];
                selectFlag?: string | undefined;
            } | undefined, {
                listArgs: string[];
                primaryModels: string[];
                selectFlag?: string | undefined;
            }>>>;
            reasoningCli: z$1.ZodOptional<z$1.ZodObject<{
                flag: z$1.ZodString;
                supportedLevels: z$1.ZodArray<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }>>;
                levelValues: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }> & z$1.core.$partial, z$1.ZodString>>;
                defaultLevel: z$1.ZodOptional<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }>>;
            }, z$1.core.$strict>>;
            nativeReasoning: z$1.ZodOptional<z$1.ZodObject<{
                configId: z$1.ZodString;
                supportedLevels: z$1.ZodArray<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }>>;
                levelValues: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }> & z$1.core.$partial, z$1.ZodString>>;
                defaultLevel: z$1.ZodOptional<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }>>;
            }, z$1.core.$strict>>;
            nativeSkillRoots: z$1.ZodOptional<z$1.ZodObject<{
                user: z$1.ZodDefault<z$1.ZodArray<z$1.ZodString>>;
                project: z$1.ZodDefault<z$1.ZodArray<z$1.ZodString>>;
            }, z$1.core.$strict>>;
            permissionCli: z$1.ZodOptional<z$1.ZodObject<{
                full: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
                workspaceWrite: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
                readonly: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
                insertAfterArgs: z$1.ZodOptional<z$1.ZodNumber>;
            }, z$1.core.$strict>>;
        }, z$1.core.$strict>>;
        options: z$1.ZodIntersection<z$1.ZodObject<{
            model: z$1.ZodString;
            serviceTier: z$1.ZodEnum<{
                default: "default";
                fast: "fast";
            }>;
            reasoningLevel: z$1.ZodEnum<{
                none: "none";
                low: "low";
                medium: "medium";
                high: "high";
                xhigh: "xhigh";
                ultracode: "ultracode";
                max: "max";
                ultra: "ultra";
            }>;
            claudeCodePermissionMode: z$1.ZodOptional<z$1.ZodLiteral<"plan">>;
            claudeCodeMockCliTraffic: z$1.ZodOptional<z$1.ZodObject<{
                enabled: z$1.ZodBoolean;
                endpoint: z$1.ZodString;
            }, z$1.core.$strict>>;
            workflowsEnabled: z$1.ZodBoolean;
            memoryEnabled: z$1.ZodOptional<z$1.ZodBoolean>;
            providerSubagentsEnabled: z$1.ZodOptional<z$1.ZodBoolean>;
            providerNetworkRestricted: z$1.ZodOptional<z$1.ZodBoolean>;
        }, z$1.core.$strip>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            permissionMode: z$1.ZodLiteral<"accept-edits">;
            permissionScope: z$1.ZodLiteral<"workspace">;
            approvalReviewer: z$1.ZodLiteral<"user">;
            permissionEscalation: z$1.ZodEnum<{
                ask: "ask";
                deny: "deny";
            }>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            permissionMode: z$1.ZodLiteral<"auto">;
            permissionScope: z$1.ZodLiteral<"workspace">;
            approvalReviewer: z$1.ZodLiteral<"automatic">;
            permissionEscalation: z$1.ZodEnum<{
                ask: "ask";
                deny: "deny";
            }>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            permissionMode: z$1.ZodLiteral<"full">;
            permissionScope: z$1.ZodLiteral<"full">;
            approvalReviewer: z$1.ZodNull;
            permissionEscalation: z$1.ZodNull;
        }, z$1.core.$strip>], "permissionMode">>;
        instructions: z$1.ZodString;
        dynamicTools: z$1.ZodArray<z$1.ZodObject<{
            name: z$1.ZodString;
            description: z$1.ZodString;
            inputSchema: z$1.ZodUnknown;
        }, z$1.core.$strip>>;
        injectedSkillSources: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            name: z$1.ZodString;
            description: z$1.ZodString;
            kind: z$1.ZodLiteral<"tree">;
            treeHash: z$1.ZodString;
            entryPath: z$1.ZodString;
            sourceType: z$1.ZodEnum<{
                builtin: "builtin";
                "data-dir": "data-dir";
            }>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            name: z$1.ZodString;
            description: z$1.ZodString;
            kind: z$1.ZodLiteral<"workspace-path">;
            sourceType: z$1.ZodLiteral<"project">;
            sourceRootPath: z$1.ZodString;
            skillFilePath: z$1.ZodString;
        }, z$1.core.$strict>, z$1.ZodObject<{
            name: z$1.ZodString;
            description: z$1.ZodString;
            kind: z$1.ZodLiteral<"host-path">;
            sourceType: z$1.ZodEnum<{
                "shared-user": "shared-user";
                "shared-project": "shared-project";
            }>;
            sourceRootPath: z$1.ZodString;
            skillFilePath: z$1.ZodString;
        }, z$1.core.$strict>], "kind">>;
        disallowedTools: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
        instructionMode: z$1.ZodEnum<{
            append: "append";
            replace: "replace";
        }>;
        type: z$1.ZodLiteral<"thread.rewind.prepare">;
        leaseId: z$1.ZodString;
        sourceProviderThreadId: z$1.ZodString;
        retainThroughProviderCheckpoint: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        providerThreadId: z$1.ZodString;
    }, z$1.core.$strip>, "settled", false>;
    "thread.start": HostDaemonCommandDescriptor<"thread.start", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        threadId: z$1.ZodString;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                unmanaged: "unmanaged";
                "managed-worktree": "managed-worktree";
                personal: "personal";
            }>;
        }, z$1.core.$strip>;
        projectId: z$1.ZodString;
        providerId: z$1.ZodString;
        acpLaunchSpec: z$1.ZodOptional<z$1.ZodObject<{
            displayName: z$1.ZodString;
            command: z$1.ZodString;
            args: z$1.ZodArray<z$1.ZodString>;
            env: z$1.ZodRecord<z$1.ZodString, z$1.ZodString>;
            cwd: z$1.ZodOptional<z$1.ZodString>;
            modelCli: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodObject<{
                listArgs: z$1.ZodArray<z$1.ZodString>;
                selectFlag: z$1.ZodOptional<z$1.ZodString>;
                primaryModels: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strict>, z$1.ZodTransform<{
                listArgs: string[];
                primaryModels: string[];
                selectFlag?: string | undefined;
            } | undefined, {
                listArgs: string[];
                primaryModels: string[];
                selectFlag?: string | undefined;
            }>>>;
            reasoningCli: z$1.ZodOptional<z$1.ZodObject<{
                flag: z$1.ZodString;
                supportedLevels: z$1.ZodArray<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }>>;
                levelValues: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }> & z$1.core.$partial, z$1.ZodString>>;
                defaultLevel: z$1.ZodOptional<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }>>;
            }, z$1.core.$strict>>;
            nativeReasoning: z$1.ZodOptional<z$1.ZodObject<{
                configId: z$1.ZodString;
                supportedLevels: z$1.ZodArray<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }>>;
                levelValues: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }> & z$1.core.$partial, z$1.ZodString>>;
                defaultLevel: z$1.ZodOptional<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }>>;
            }, z$1.core.$strict>>;
            nativeSkillRoots: z$1.ZodOptional<z$1.ZodObject<{
                user: z$1.ZodDefault<z$1.ZodArray<z$1.ZodString>>;
                project: z$1.ZodDefault<z$1.ZodArray<z$1.ZodString>>;
            }, z$1.core.$strict>>;
            permissionCli: z$1.ZodOptional<z$1.ZodObject<{
                full: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
                workspaceWrite: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
                readonly: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
                insertAfterArgs: z$1.ZodOptional<z$1.ZodNumber>;
            }, z$1.core.$strict>>;
        }, z$1.core.$strict>>;
        options: z$1.ZodIntersection<z$1.ZodObject<{
            model: z$1.ZodString;
            serviceTier: z$1.ZodEnum<{
                default: "default";
                fast: "fast";
            }>;
            reasoningLevel: z$1.ZodEnum<{
                none: "none";
                low: "low";
                medium: "medium";
                high: "high";
                xhigh: "xhigh";
                ultracode: "ultracode";
                max: "max";
                ultra: "ultra";
            }>;
            claudeCodePermissionMode: z$1.ZodOptional<z$1.ZodLiteral<"plan">>;
            claudeCodeMockCliTraffic: z$1.ZodOptional<z$1.ZodObject<{
                enabled: z$1.ZodBoolean;
                endpoint: z$1.ZodString;
            }, z$1.core.$strict>>;
            workflowsEnabled: z$1.ZodBoolean;
            memoryEnabled: z$1.ZodOptional<z$1.ZodBoolean>;
            providerSubagentsEnabled: z$1.ZodOptional<z$1.ZodBoolean>;
            providerNetworkRestricted: z$1.ZodOptional<z$1.ZodBoolean>;
        }, z$1.core.$strip>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            permissionMode: z$1.ZodLiteral<"accept-edits">;
            permissionScope: z$1.ZodLiteral<"workspace">;
            approvalReviewer: z$1.ZodLiteral<"user">;
            permissionEscalation: z$1.ZodEnum<{
                ask: "ask";
                deny: "deny";
            }>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            permissionMode: z$1.ZodLiteral<"auto">;
            permissionScope: z$1.ZodLiteral<"workspace">;
            approvalReviewer: z$1.ZodLiteral<"automatic">;
            permissionEscalation: z$1.ZodEnum<{
                ask: "ask";
                deny: "deny";
            }>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            permissionMode: z$1.ZodLiteral<"full">;
            permissionScope: z$1.ZodLiteral<"full">;
            approvalReviewer: z$1.ZodNull;
            permissionEscalation: z$1.ZodNull;
        }, z$1.core.$strip>], "permissionMode">>;
        instructions: z$1.ZodString;
        dynamicTools: z$1.ZodArray<z$1.ZodObject<{
            name: z$1.ZodString;
            description: z$1.ZodString;
            inputSchema: z$1.ZodUnknown;
        }, z$1.core.$strip>>;
        injectedSkillSources: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            name: z$1.ZodString;
            description: z$1.ZodString;
            kind: z$1.ZodLiteral<"tree">;
            treeHash: z$1.ZodString;
            entryPath: z$1.ZodString;
            sourceType: z$1.ZodEnum<{
                builtin: "builtin";
                "data-dir": "data-dir";
            }>;
        }, z$1.core.$strict>, z$1.ZodObject<{
            name: z$1.ZodString;
            description: z$1.ZodString;
            kind: z$1.ZodLiteral<"workspace-path">;
            sourceType: z$1.ZodLiteral<"project">;
            sourceRootPath: z$1.ZodString;
            skillFilePath: z$1.ZodString;
        }, z$1.core.$strict>, z$1.ZodObject<{
            name: z$1.ZodString;
            description: z$1.ZodString;
            kind: z$1.ZodLiteral<"host-path">;
            sourceType: z$1.ZodEnum<{
                "shared-user": "shared-user";
                "shared-project": "shared-project";
            }>;
            sourceRootPath: z$1.ZodString;
            skillFilePath: z$1.ZodString;
        }, z$1.core.$strict>], "kind">>;
        disallowedTools: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
        instructionMode: z$1.ZodEnum<{
            append: "append";
            replace: "replace";
        }>;
        type: z$1.ZodLiteral<"thread.start">;
        requestId: z$1.ZodString;
        input: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"text">;
            text: z$1.ZodString;
            mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
                start: z$1.ZodNumber;
                end: z$1.ZodNumber;
                resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"thread">;
                    threadId: z$1.ZodString;
                    projectId: z$1.ZodOptional<z$1.ZodString>;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"project">;
                    projectId: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"section">;
                    sectionId: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"path">;
                    source: z$1.ZodEnum<{
                        workspace: "workspace";
                        "thread-storage": "thread-storage";
                    }>;
                    entryKind: z$1.ZodEnum<{
                        file: "file";
                        directory: "directory";
                    }>;
                    path: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"command">;
                    trigger: z$1.ZodEnum<{
                        "/": "/";
                    }>;
                    name: z$1.ZodString;
                    source: z$1.ZodEnum<{
                        command: "command";
                        skill: "skill";
                    }>;
                    origin: z$1.ZodEnum<{
                        builtin: "builtin";
                        project: "project";
                        user: "user";
                    }>;
                    label: z$1.ZodString;
                    argumentHint: z$1.ZodNullable<z$1.ZodString>;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"plugin">;
                    pluginId: z$1.ZodString;
                    icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                    itemId: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>], "kind">>;
            }, z$1.core.$strip>>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"image">;
            url: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"localImage">;
            path: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"localFile">;
            path: z$1.ZodString;
            name: z$1.ZodOptional<z$1.ZodString>;
            sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
            mimeType: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>], "type">>;
        inputGroups: z$1.ZodOptional<z$1.ZodArray<z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"text">;
            text: z$1.ZodString;
            mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
                start: z$1.ZodNumber;
                end: z$1.ZodNumber;
                resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"thread">;
                    threadId: z$1.ZodString;
                    projectId: z$1.ZodOptional<z$1.ZodString>;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"project">;
                    projectId: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"section">;
                    sectionId: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"path">;
                    source: z$1.ZodEnum<{
                        workspace: "workspace";
                        "thread-storage": "thread-storage";
                    }>;
                    entryKind: z$1.ZodEnum<{
                        file: "file";
                        directory: "directory";
                    }>;
                    path: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"command">;
                    trigger: z$1.ZodEnum<{
                        "/": "/";
                    }>;
                    name: z$1.ZodString;
                    source: z$1.ZodEnum<{
                        command: "command";
                        skill: "skill";
                    }>;
                    origin: z$1.ZodEnum<{
                        builtin: "builtin";
                        project: "project";
                        user: "user";
                    }>;
                    label: z$1.ZodString;
                    argumentHint: z$1.ZodNullable<z$1.ZodString>;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"plugin">;
                    pluginId: z$1.ZodString;
                    icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                    itemId: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>], "kind">>;
            }, z$1.core.$strip>>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"image">;
            url: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"localImage">;
            path: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"localFile">;
            path: z$1.ZodString;
            name: z$1.ZodOptional<z$1.ZodString>;
            sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
            mimeType: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>], "type">>>>;
        threadStoragePath: z$1.ZodOptional<z$1.ZodString>;
        fork: z$1.ZodOptional<z$1.ZodObject<{
            sourceProviderThreadId: z$1.ZodString;
        }, z$1.core.$strip>>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        providerThreadId: z$1.ZodString;
    }, z$1.core.$strip>, "settled", false>;
    "turn.submit": HostDaemonCommandDescriptor<"turn.submit", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        threadId: z$1.ZodString;
        type: z$1.ZodLiteral<"turn.submit">;
        requestId: z$1.ZodString;
        input: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"text">;
            text: z$1.ZodString;
            mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
                start: z$1.ZodNumber;
                end: z$1.ZodNumber;
                resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"thread">;
                    threadId: z$1.ZodString;
                    projectId: z$1.ZodOptional<z$1.ZodString>;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"project">;
                    projectId: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"section">;
                    sectionId: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"path">;
                    source: z$1.ZodEnum<{
                        workspace: "workspace";
                        "thread-storage": "thread-storage";
                    }>;
                    entryKind: z$1.ZodEnum<{
                        file: "file";
                        directory: "directory";
                    }>;
                    path: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"command">;
                    trigger: z$1.ZodEnum<{
                        "/": "/";
                    }>;
                    name: z$1.ZodString;
                    source: z$1.ZodEnum<{
                        command: "command";
                        skill: "skill";
                    }>;
                    origin: z$1.ZodEnum<{
                        builtin: "builtin";
                        project: "project";
                        user: "user";
                    }>;
                    label: z$1.ZodString;
                    argumentHint: z$1.ZodNullable<z$1.ZodString>;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"plugin">;
                    pluginId: z$1.ZodString;
                    icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                    itemId: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>], "kind">>;
            }, z$1.core.$strip>>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"image">;
            url: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"localImage">;
            path: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"localFile">;
            path: z$1.ZodString;
            name: z$1.ZodOptional<z$1.ZodString>;
            sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
            mimeType: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>], "type">>;
        inputGroups: z$1.ZodOptional<z$1.ZodArray<z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"text">;
            text: z$1.ZodString;
            mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
                start: z$1.ZodNumber;
                end: z$1.ZodNumber;
                resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"thread">;
                    threadId: z$1.ZodString;
                    projectId: z$1.ZodOptional<z$1.ZodString>;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"project">;
                    projectId: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"section">;
                    sectionId: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"path">;
                    source: z$1.ZodEnum<{
                        workspace: "workspace";
                        "thread-storage": "thread-storage";
                    }>;
                    entryKind: z$1.ZodEnum<{
                        file: "file";
                        directory: "directory";
                    }>;
                    path: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"command">;
                    trigger: z$1.ZodEnum<{
                        "/": "/";
                    }>;
                    name: z$1.ZodString;
                    source: z$1.ZodEnum<{
                        command: "command";
                        skill: "skill";
                    }>;
                    origin: z$1.ZodEnum<{
                        builtin: "builtin";
                        project: "project";
                        user: "user";
                    }>;
                    label: z$1.ZodString;
                    argumentHint: z$1.ZodNullable<z$1.ZodString>;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"plugin">;
                    pluginId: z$1.ZodString;
                    icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                    itemId: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>], "kind">>;
            }, z$1.core.$strip>>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"image">;
            url: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"localImage">;
            path: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"localFile">;
            path: z$1.ZodString;
            name: z$1.ZodOptional<z$1.ZodString>;
            sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
            mimeType: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>], "type">>>>;
        options: z$1.ZodIntersection<z$1.ZodObject<{
            model: z$1.ZodString;
            serviceTier: z$1.ZodEnum<{
                default: "default";
                fast: "fast";
            }>;
            reasoningLevel: z$1.ZodEnum<{
                none: "none";
                low: "low";
                medium: "medium";
                high: "high";
                xhigh: "xhigh";
                ultracode: "ultracode";
                max: "max";
                ultra: "ultra";
            }>;
            claudeCodePermissionMode: z$1.ZodOptional<z$1.ZodLiteral<"plan">>;
            claudeCodeMockCliTraffic: z$1.ZodOptional<z$1.ZodObject<{
                enabled: z$1.ZodBoolean;
                endpoint: z$1.ZodString;
            }, z$1.core.$strict>>;
            workflowsEnabled: z$1.ZodBoolean;
            memoryEnabled: z$1.ZodOptional<z$1.ZodBoolean>;
            providerSubagentsEnabled: z$1.ZodOptional<z$1.ZodBoolean>;
            providerNetworkRestricted: z$1.ZodOptional<z$1.ZodBoolean>;
        }, z$1.core.$strip>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            permissionMode: z$1.ZodLiteral<"accept-edits">;
            permissionScope: z$1.ZodLiteral<"workspace">;
            approvalReviewer: z$1.ZodLiteral<"user">;
            permissionEscalation: z$1.ZodEnum<{
                ask: "ask";
                deny: "deny";
            }>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            permissionMode: z$1.ZodLiteral<"auto">;
            permissionScope: z$1.ZodLiteral<"workspace">;
            approvalReviewer: z$1.ZodLiteral<"automatic">;
            permissionEscalation: z$1.ZodEnum<{
                ask: "ask";
                deny: "deny";
            }>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            permissionMode: z$1.ZodLiteral<"full">;
            permissionScope: z$1.ZodLiteral<"full">;
            approvalReviewer: z$1.ZodNull;
            permissionEscalation: z$1.ZodNull;
        }, z$1.core.$strip>], "permissionMode">>;
        acpLaunchSpec: z$1.ZodOptional<z$1.ZodObject<{
            displayName: z$1.ZodString;
            command: z$1.ZodString;
            args: z$1.ZodArray<z$1.ZodString>;
            env: z$1.ZodRecord<z$1.ZodString, z$1.ZodString>;
            cwd: z$1.ZodOptional<z$1.ZodString>;
            modelCli: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodObject<{
                listArgs: z$1.ZodArray<z$1.ZodString>;
                selectFlag: z$1.ZodOptional<z$1.ZodString>;
                primaryModels: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strict>, z$1.ZodTransform<{
                listArgs: string[];
                primaryModels: string[];
                selectFlag?: string | undefined;
            } | undefined, {
                listArgs: string[];
                primaryModels: string[];
                selectFlag?: string | undefined;
            }>>>;
            reasoningCli: z$1.ZodOptional<z$1.ZodObject<{
                flag: z$1.ZodString;
                supportedLevels: z$1.ZodArray<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }>>;
                levelValues: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }> & z$1.core.$partial, z$1.ZodString>>;
                defaultLevel: z$1.ZodOptional<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }>>;
            }, z$1.core.$strict>>;
            nativeReasoning: z$1.ZodOptional<z$1.ZodObject<{
                configId: z$1.ZodString;
                supportedLevels: z$1.ZodArray<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }>>;
                levelValues: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }> & z$1.core.$partial, z$1.ZodString>>;
                defaultLevel: z$1.ZodOptional<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }>>;
            }, z$1.core.$strict>>;
            nativeSkillRoots: z$1.ZodOptional<z$1.ZodObject<{
                user: z$1.ZodDefault<z$1.ZodArray<z$1.ZodString>>;
                project: z$1.ZodDefault<z$1.ZodArray<z$1.ZodString>>;
            }, z$1.core.$strict>>;
            permissionCli: z$1.ZodOptional<z$1.ZodObject<{
                full: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
                workspaceWrite: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
                readonly: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
                insertAfterArgs: z$1.ZodOptional<z$1.ZodNumber>;
            }, z$1.core.$strict>>;
        }, z$1.core.$strict>>;
        resumeContext: z$1.ZodObject<{
            workspaceContext: z$1.ZodObject<{
                workspacePath: z$1.ZodString;
                workspaceProvisionType: z$1.ZodEnum<{
                    unmanaged: "unmanaged";
                    "managed-worktree": "managed-worktree";
                    personal: "personal";
                }>;
            }, z$1.core.$strip>;
            instructionMode: z$1.ZodEnum<{
                append: "append";
                replace: "replace";
            }>;
            projectId: z$1.ZodString;
            providerId: z$1.ZodString;
            acpLaunchSpec: z$1.ZodOptional<z$1.ZodObject<{
                displayName: z$1.ZodString;
                command: z$1.ZodString;
                args: z$1.ZodArray<z$1.ZodString>;
                env: z$1.ZodRecord<z$1.ZodString, z$1.ZodString>;
                cwd: z$1.ZodOptional<z$1.ZodString>;
                modelCli: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodObject<{
                    listArgs: z$1.ZodArray<z$1.ZodString>;
                    selectFlag: z$1.ZodOptional<z$1.ZodString>;
                    primaryModels: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strict>, z$1.ZodTransform<{
                    listArgs: string[];
                    primaryModels: string[];
                    selectFlag?: string | undefined;
                } | undefined, {
                    listArgs: string[];
                    primaryModels: string[];
                    selectFlag?: string | undefined;
                }>>>;
                reasoningCli: z$1.ZodOptional<z$1.ZodObject<{
                    flag: z$1.ZodString;
                    supportedLevels: z$1.ZodArray<z$1.ZodEnum<{
                        none: "none";
                        low: "low";
                        medium: "medium";
                        high: "high";
                        xhigh: "xhigh";
                        ultracode: "ultracode";
                        max: "max";
                        ultra: "ultra";
                    }>>;
                    levelValues: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodEnum<{
                        none: "none";
                        low: "low";
                        medium: "medium";
                        high: "high";
                        xhigh: "xhigh";
                        ultracode: "ultracode";
                        max: "max";
                        ultra: "ultra";
                    }> & z$1.core.$partial, z$1.ZodString>>;
                    defaultLevel: z$1.ZodOptional<z$1.ZodEnum<{
                        none: "none";
                        low: "low";
                        medium: "medium";
                        high: "high";
                        xhigh: "xhigh";
                        ultracode: "ultracode";
                        max: "max";
                        ultra: "ultra";
                    }>>;
                }, z$1.core.$strict>>;
                nativeReasoning: z$1.ZodOptional<z$1.ZodObject<{
                    configId: z$1.ZodString;
                    supportedLevels: z$1.ZodArray<z$1.ZodEnum<{
                        none: "none";
                        low: "low";
                        medium: "medium";
                        high: "high";
                        xhigh: "xhigh";
                        ultracode: "ultracode";
                        max: "max";
                        ultra: "ultra";
                    }>>;
                    levelValues: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodEnum<{
                        none: "none";
                        low: "low";
                        medium: "medium";
                        high: "high";
                        xhigh: "xhigh";
                        ultracode: "ultracode";
                        max: "max";
                        ultra: "ultra";
                    }> & z$1.core.$partial, z$1.ZodString>>;
                    defaultLevel: z$1.ZodOptional<z$1.ZodEnum<{
                        none: "none";
                        low: "low";
                        medium: "medium";
                        high: "high";
                        xhigh: "xhigh";
                        ultracode: "ultracode";
                        max: "max";
                        ultra: "ultra";
                    }>>;
                }, z$1.core.$strict>>;
                nativeSkillRoots: z$1.ZodOptional<z$1.ZodObject<{
                    user: z$1.ZodDefault<z$1.ZodArray<z$1.ZodString>>;
                    project: z$1.ZodDefault<z$1.ZodArray<z$1.ZodString>>;
                }, z$1.core.$strict>>;
                permissionCli: z$1.ZodOptional<z$1.ZodObject<{
                    full: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
                    workspaceWrite: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
                    readonly: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
                    insertAfterArgs: z$1.ZodOptional<z$1.ZodNumber>;
                }, z$1.core.$strict>>;
            }, z$1.core.$strict>>;
            instructions: z$1.ZodString;
            dynamicTools: z$1.ZodArray<z$1.ZodObject<{
                name: z$1.ZodString;
                description: z$1.ZodString;
                inputSchema: z$1.ZodUnknown;
            }, z$1.core.$strip>>;
            injectedSkillSources: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                name: z$1.ZodString;
                description: z$1.ZodString;
                kind: z$1.ZodLiteral<"tree">;
                treeHash: z$1.ZodString;
                entryPath: z$1.ZodString;
                sourceType: z$1.ZodEnum<{
                    builtin: "builtin";
                    "data-dir": "data-dir";
                }>;
            }, z$1.core.$strict>, z$1.ZodObject<{
                name: z$1.ZodString;
                description: z$1.ZodString;
                kind: z$1.ZodLiteral<"workspace-path">;
                sourceType: z$1.ZodLiteral<"project">;
                sourceRootPath: z$1.ZodString;
                skillFilePath: z$1.ZodString;
            }, z$1.core.$strict>, z$1.ZodObject<{
                name: z$1.ZodString;
                description: z$1.ZodString;
                kind: z$1.ZodLiteral<"host-path">;
                sourceType: z$1.ZodEnum<{
                    "shared-user": "shared-user";
                    "shared-project": "shared-project";
                }>;
                sourceRootPath: z$1.ZodString;
                skillFilePath: z$1.ZodString;
            }, z$1.core.$strict>], "kind">>;
            disallowedTools: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
            providerThreadId: z$1.ZodString;
        }, z$1.core.$strict>;
        target: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            mode: z$1.ZodLiteral<"start">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            mode: z$1.ZodLiteral<"auto">;
            expectedTurnId: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            mode: z$1.ZodLiteral<"steer">;
            expectedTurnId: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>], "mode">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        appliedAs: z$1.ZodEnum<{
            steer: "steer";
            "new-turn": "new-turn";
        }>;
    }, z$1.core.$strip>, "settled", false>;
    "thread.stop": HostDaemonCommandDescriptor<"thread.stop", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        threadId: z$1.ZodString;
        type: z$1.ZodLiteral<"thread.stop">;
    }, z$1.core.$strict>, z$1.ZodObject<{}, z$1.core.$strip>, "settled", false>;
    "thread.goal.clear": HostDaemonCommandDescriptor<"thread.goal.clear", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        threadId: z$1.ZodString;
        type: z$1.ZodLiteral<"thread.goal.clear">;
        options: z$1.ZodIntersection<z$1.ZodObject<{
            model: z$1.ZodString;
            serviceTier: z$1.ZodEnum<{
                default: "default";
                fast: "fast";
            }>;
            reasoningLevel: z$1.ZodEnum<{
                none: "none";
                low: "low";
                medium: "medium";
                high: "high";
                xhigh: "xhigh";
                ultracode: "ultracode";
                max: "max";
                ultra: "ultra";
            }>;
            claudeCodePermissionMode: z$1.ZodOptional<z$1.ZodLiteral<"plan">>;
            claudeCodeMockCliTraffic: z$1.ZodOptional<z$1.ZodObject<{
                enabled: z$1.ZodBoolean;
                endpoint: z$1.ZodString;
            }, z$1.core.$strict>>;
            workflowsEnabled: z$1.ZodBoolean;
            memoryEnabled: z$1.ZodOptional<z$1.ZodBoolean>;
            providerSubagentsEnabled: z$1.ZodOptional<z$1.ZodBoolean>;
            providerNetworkRestricted: z$1.ZodOptional<z$1.ZodBoolean>;
        }, z$1.core.$strip>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            permissionMode: z$1.ZodLiteral<"accept-edits">;
            permissionScope: z$1.ZodLiteral<"workspace">;
            approvalReviewer: z$1.ZodLiteral<"user">;
            permissionEscalation: z$1.ZodEnum<{
                ask: "ask";
                deny: "deny";
            }>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            permissionMode: z$1.ZodLiteral<"auto">;
            permissionScope: z$1.ZodLiteral<"workspace">;
            approvalReviewer: z$1.ZodLiteral<"automatic">;
            permissionEscalation: z$1.ZodEnum<{
                ask: "ask";
                deny: "deny";
            }>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            permissionMode: z$1.ZodLiteral<"full">;
            permissionScope: z$1.ZodLiteral<"full">;
            approvalReviewer: z$1.ZodNull;
            permissionEscalation: z$1.ZodNull;
        }, z$1.core.$strip>], "permissionMode">>;
        acpLaunchSpec: z$1.ZodOptional<z$1.ZodObject<{
            displayName: z$1.ZodString;
            command: z$1.ZodString;
            args: z$1.ZodArray<z$1.ZodString>;
            env: z$1.ZodRecord<z$1.ZodString, z$1.ZodString>;
            cwd: z$1.ZodOptional<z$1.ZodString>;
            modelCli: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodObject<{
                listArgs: z$1.ZodArray<z$1.ZodString>;
                selectFlag: z$1.ZodOptional<z$1.ZodString>;
                primaryModels: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strict>, z$1.ZodTransform<{
                listArgs: string[];
                primaryModels: string[];
                selectFlag?: string | undefined;
            } | undefined, {
                listArgs: string[];
                primaryModels: string[];
                selectFlag?: string | undefined;
            }>>>;
            reasoningCli: z$1.ZodOptional<z$1.ZodObject<{
                flag: z$1.ZodString;
                supportedLevels: z$1.ZodArray<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }>>;
                levelValues: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }> & z$1.core.$partial, z$1.ZodString>>;
                defaultLevel: z$1.ZodOptional<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }>>;
            }, z$1.core.$strict>>;
            nativeReasoning: z$1.ZodOptional<z$1.ZodObject<{
                configId: z$1.ZodString;
                supportedLevels: z$1.ZodArray<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }>>;
                levelValues: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }> & z$1.core.$partial, z$1.ZodString>>;
                defaultLevel: z$1.ZodOptional<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }>>;
            }, z$1.core.$strict>>;
            nativeSkillRoots: z$1.ZodOptional<z$1.ZodObject<{
                user: z$1.ZodDefault<z$1.ZodArray<z$1.ZodString>>;
                project: z$1.ZodDefault<z$1.ZodArray<z$1.ZodString>>;
            }, z$1.core.$strict>>;
            permissionCli: z$1.ZodOptional<z$1.ZodObject<{
                full: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
                workspaceWrite: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
                readonly: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
                insertAfterArgs: z$1.ZodOptional<z$1.ZodNumber>;
            }, z$1.core.$strict>>;
        }, z$1.core.$strict>>;
        resumeContext: z$1.ZodObject<{
            workspaceContext: z$1.ZodObject<{
                workspacePath: z$1.ZodString;
                workspaceProvisionType: z$1.ZodEnum<{
                    unmanaged: "unmanaged";
                    "managed-worktree": "managed-worktree";
                    personal: "personal";
                }>;
            }, z$1.core.$strip>;
            instructionMode: z$1.ZodEnum<{
                append: "append";
                replace: "replace";
            }>;
            projectId: z$1.ZodString;
            providerId: z$1.ZodString;
            acpLaunchSpec: z$1.ZodOptional<z$1.ZodObject<{
                displayName: z$1.ZodString;
                command: z$1.ZodString;
                args: z$1.ZodArray<z$1.ZodString>;
                env: z$1.ZodRecord<z$1.ZodString, z$1.ZodString>;
                cwd: z$1.ZodOptional<z$1.ZodString>;
                modelCli: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodObject<{
                    listArgs: z$1.ZodArray<z$1.ZodString>;
                    selectFlag: z$1.ZodOptional<z$1.ZodString>;
                    primaryModels: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strict>, z$1.ZodTransform<{
                    listArgs: string[];
                    primaryModels: string[];
                    selectFlag?: string | undefined;
                } | undefined, {
                    listArgs: string[];
                    primaryModels: string[];
                    selectFlag?: string | undefined;
                }>>>;
                reasoningCli: z$1.ZodOptional<z$1.ZodObject<{
                    flag: z$1.ZodString;
                    supportedLevels: z$1.ZodArray<z$1.ZodEnum<{
                        none: "none";
                        low: "low";
                        medium: "medium";
                        high: "high";
                        xhigh: "xhigh";
                        ultracode: "ultracode";
                        max: "max";
                        ultra: "ultra";
                    }>>;
                    levelValues: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodEnum<{
                        none: "none";
                        low: "low";
                        medium: "medium";
                        high: "high";
                        xhigh: "xhigh";
                        ultracode: "ultracode";
                        max: "max";
                        ultra: "ultra";
                    }> & z$1.core.$partial, z$1.ZodString>>;
                    defaultLevel: z$1.ZodOptional<z$1.ZodEnum<{
                        none: "none";
                        low: "low";
                        medium: "medium";
                        high: "high";
                        xhigh: "xhigh";
                        ultracode: "ultracode";
                        max: "max";
                        ultra: "ultra";
                    }>>;
                }, z$1.core.$strict>>;
                nativeReasoning: z$1.ZodOptional<z$1.ZodObject<{
                    configId: z$1.ZodString;
                    supportedLevels: z$1.ZodArray<z$1.ZodEnum<{
                        none: "none";
                        low: "low";
                        medium: "medium";
                        high: "high";
                        xhigh: "xhigh";
                        ultracode: "ultracode";
                        max: "max";
                        ultra: "ultra";
                    }>>;
                    levelValues: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodEnum<{
                        none: "none";
                        low: "low";
                        medium: "medium";
                        high: "high";
                        xhigh: "xhigh";
                        ultracode: "ultracode";
                        max: "max";
                        ultra: "ultra";
                    }> & z$1.core.$partial, z$1.ZodString>>;
                    defaultLevel: z$1.ZodOptional<z$1.ZodEnum<{
                        none: "none";
                        low: "low";
                        medium: "medium";
                        high: "high";
                        xhigh: "xhigh";
                        ultracode: "ultracode";
                        max: "max";
                        ultra: "ultra";
                    }>>;
                }, z$1.core.$strict>>;
                nativeSkillRoots: z$1.ZodOptional<z$1.ZodObject<{
                    user: z$1.ZodDefault<z$1.ZodArray<z$1.ZodString>>;
                    project: z$1.ZodDefault<z$1.ZodArray<z$1.ZodString>>;
                }, z$1.core.$strict>>;
                permissionCli: z$1.ZodOptional<z$1.ZodObject<{
                    full: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
                    workspaceWrite: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
                    readonly: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
                    insertAfterArgs: z$1.ZodOptional<z$1.ZodNumber>;
                }, z$1.core.$strict>>;
            }, z$1.core.$strict>>;
            instructions: z$1.ZodString;
            dynamicTools: z$1.ZodArray<z$1.ZodObject<{
                name: z$1.ZodString;
                description: z$1.ZodString;
                inputSchema: z$1.ZodUnknown;
            }, z$1.core.$strip>>;
            injectedSkillSources: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                name: z$1.ZodString;
                description: z$1.ZodString;
                kind: z$1.ZodLiteral<"tree">;
                treeHash: z$1.ZodString;
                entryPath: z$1.ZodString;
                sourceType: z$1.ZodEnum<{
                    builtin: "builtin";
                    "data-dir": "data-dir";
                }>;
            }, z$1.core.$strict>, z$1.ZodObject<{
                name: z$1.ZodString;
                description: z$1.ZodString;
                kind: z$1.ZodLiteral<"workspace-path">;
                sourceType: z$1.ZodLiteral<"project">;
                sourceRootPath: z$1.ZodString;
                skillFilePath: z$1.ZodString;
            }, z$1.core.$strict>, z$1.ZodObject<{
                name: z$1.ZodString;
                description: z$1.ZodString;
                kind: z$1.ZodLiteral<"host-path">;
                sourceType: z$1.ZodEnum<{
                    "shared-user": "shared-user";
                    "shared-project": "shared-project";
                }>;
                sourceRootPath: z$1.ZodString;
                skillFilePath: z$1.ZodString;
            }, z$1.core.$strict>], "kind">>;
            disallowedTools: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
            providerThreadId: z$1.ZodString;
        }, z$1.core.$strict>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        cleared: z$1.ZodBoolean;
    }, z$1.core.$strict>, "settled", false>;
    "thread.plan.cancel": HostDaemonCommandDescriptor<"thread.plan.cancel", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        threadId: z$1.ZodString;
        type: z$1.ZodLiteral<"thread.plan.cancel">;
        expectedTurnId: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        cancelled: z$1.ZodBoolean;
    }, z$1.core.$strict>, "settled", false>;
    "thread.rename": HostDaemonCommandDescriptor<"thread.rename", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        threadId: z$1.ZodString;
        type: z$1.ZodLiteral<"thread.rename">;
        title: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{}, z$1.core.$strip>, "settled", false>;
    "thread.archive": HostDaemonCommandDescriptor<"thread.archive", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        threadId: z$1.ZodString;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                unmanaged: "unmanaged";
                "managed-worktree": "managed-worktree";
                personal: "personal";
            }>;
        }, z$1.core.$strip>;
        type: z$1.ZodLiteral<"thread.archive">;
        providerId: z$1.ZodString;
        providerThreadId: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{}, z$1.core.$strip>, "settled", false>;
    "thread.unarchive": HostDaemonCommandDescriptor<"thread.unarchive", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        threadId: z$1.ZodString;
        type: z$1.ZodLiteral<"thread.unarchive">;
        providerId: z$1.ZodString;
        providerThreadId: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{}, z$1.core.$strip>, "settled", false>;
    "interactive.resolve": HostDaemonCommandDescriptor<"interactive.resolve", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        threadId: z$1.ZodString;
        type: z$1.ZodLiteral<"interactive.resolve">;
        interactionId: z$1.ZodString;
        providerId: z$1.ZodString;
        providerThreadId: z$1.ZodString;
        providerRequestId: z$1.ZodString;
        resolution: z$1.ZodUnion<readonly [z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            decision: z$1.ZodLiteral<"allow_once">;
            grantedPermissions: z$1.ZodNullable<z$1.ZodObject<{
                network: z$1.ZodNullable<z$1.ZodObject<{
                    enabled: z$1.ZodNullable<z$1.ZodBoolean>;
                }, z$1.core.$strip>>;
                fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                    read: z$1.ZodArray<z$1.ZodString>;
                    write: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strip>>;
            }, z$1.core.$strict>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            decision: z$1.ZodLiteral<"allow_for_session">;
            grantedPermissions: z$1.ZodNullable<z$1.ZodObject<{
                network: z$1.ZodNullable<z$1.ZodObject<{
                    enabled: z$1.ZodNullable<z$1.ZodBoolean>;
                }, z$1.core.$strip>>;
                fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                    read: z$1.ZodArray<z$1.ZodString>;
                    write: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strip>>;
            }, z$1.core.$strict>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            decision: z$1.ZodLiteral<"deny">;
        }, z$1.core.$strip>], "decision">, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"user_answer">;
            answers: z$1.ZodRecord<z$1.ZodString, z$1.ZodObject<{
                selected: z$1.ZodArray<z$1.ZodString>;
                freeText: z$1.ZodOptional<z$1.ZodString>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"plugin_submitted">;
        }, z$1.core.$strip>]>;
    }, z$1.core.$strict>, z$1.ZodObject<{}, z$1.core.$strip>, "settled", false>;
    "codex.inference.complete": HostDaemonCommandDescriptor<"codex.inference.complete", z$1.ZodObject<{
        type: z$1.ZodLiteral<"codex.inference.complete">;
        model: z$1.ZodString;
        reasoningEffort: z$1.ZodLiteral<"none">;
        prompt: z$1.ZodString;
        outputSchema: z$1.ZodType<JsonObject, unknown, z$1.core.$ZodTypeInternals<JsonObject, unknown>>;
        timeoutMs: z$1.ZodNumber;
    }, z$1.core.$strict>, z$1.ZodObject<{
        model: z$1.ZodString;
        value: z$1.ZodType<JsonObject, unknown, z$1.core.$ZodTypeInternals<JsonObject, unknown>>;
    }, z$1.core.$strip>, "settled", false>;
    "codex.voice.transcribe": HostDaemonCommandDescriptor<"codex.voice.transcribe", z$1.ZodObject<{
        type: z$1.ZodLiteral<"codex.voice.transcribe">;
        model: z$1.ZodString;
        audioBase64: z$1.ZodString;
        mimeType: z$1.ZodString;
        filename: z$1.ZodString;
        prompt: z$1.ZodNullable<z$1.ZodString>;
        timeoutMs: z$1.ZodNumber;
    }, z$1.core.$strict>, z$1.ZodObject<{
        model: z$1.ZodString;
        text: z$1.ZodString;
    }, z$1.core.$strip>, "settled", false>;
    "environment.provision": HostDaemonCommandDescriptor<"environment.provision", z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        environmentId: z$1.ZodString;
        type: z$1.ZodLiteral<"environment.provision">;
        initiator: z$1.ZodNullable<z$1.ZodObject<{
            threadId: z$1.ZodString;
            provisioningId: z$1.ZodString;
        }, z$1.core.$strict>>;
        workspaceProvisionType: z$1.ZodLiteral<"unmanaged">;
        path: z$1.ZodString;
        checkout: z$1.ZodOptional<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"existing">;
            name: z$1.ZodString;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"new">;
            name: z$1.ZodString;
            baseBranch: z$1.ZodString;
        }, z$1.core.$strict>], "kind">>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        environmentId: z$1.ZodString;
        type: z$1.ZodLiteral<"environment.provision">;
        initiator: z$1.ZodNullable<z$1.ZodObject<{
            threadId: z$1.ZodString;
            provisioningId: z$1.ZodString;
        }, z$1.core.$strict>>;
        sourcePath: z$1.ZodString;
        targetPath: z$1.ZodString;
        branchName: z$1.ZodString;
        baseBranch: z$1.ZodNullable<z$1.ZodString>;
        setupTimeoutMs: z$1.ZodNumber;
        workspaceProvisionType: z$1.ZodLiteral<"managed-worktree">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        environmentId: z$1.ZodString;
        type: z$1.ZodLiteral<"environment.provision">;
        initiator: z$1.ZodNullable<z$1.ZodObject<{
            threadId: z$1.ZodString;
            provisioningId: z$1.ZodString;
        }, z$1.core.$strict>>;
        workspaceProvisionType: z$1.ZodLiteral<"personal">;
        targetPath: z$1.ZodString;
    }, z$1.core.$strict>], "workspaceProvisionType">, z$1.ZodObject<{
        path: z$1.ZodString;
        isGitRepo: z$1.ZodBoolean;
        isWorktree: z$1.ZodBoolean;
        branchName: z$1.ZodNullable<z$1.ZodString>;
        defaultBranch: z$1.ZodNullable<z$1.ZodString>;
        transcript: z$1.ZodArray<z$1.ZodObject<{
            type: z$1.ZodEnum<{
                output: "output";
                step: "step";
            }>;
            key: z$1.ZodString;
            text: z$1.ZodString;
            startedAt: z$1.ZodOptional<z$1.ZodNumber>;
            status: z$1.ZodOptional<z$1.ZodEnum<{
                started: "started";
                completed: "completed";
                failed: "failed";
            }>>;
            metadata: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodString, z$1.ZodUnknown>>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>, "settled", false>;
    "project.clone": HostDaemonCommandDescriptor<"project.clone", z$1.ZodObject<{
        type: z$1.ZodLiteral<"project.clone">;
        remoteUrl: z$1.ZodString;
        projectSlug: z$1.ZodString;
        targetPath: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        path: z$1.ZodString;
        gitRemoteUrl: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strict>, "settled", false>;
    "environment.provision.cancel": HostDaemonCommandDescriptor<"environment.provision.cancel", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        type: z$1.ZodLiteral<"environment.provision.cancel">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        aborted: z$1.ZodBoolean;
    }, z$1.core.$strip>, "settled", false>;
    "environment.destroy": HostDaemonCommandDescriptor<"environment.destroy", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                unmanaged: "unmanaged";
                "managed-worktree": "managed-worktree";
                personal: "personal";
            }>;
        }, z$1.core.$strip>;
        type: z$1.ZodLiteral<"environment.destroy">;
    }, z$1.core.$strict>, z$1.ZodObject<{}, z$1.core.$strip>, "settled", false>;
    "workspace.commit": HostDaemonCommandDescriptor<"workspace.commit", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                unmanaged: "unmanaged";
                "managed-worktree": "managed-worktree";
                personal: "personal";
            }>;
        }, z$1.core.$strip>;
        type: z$1.ZodLiteral<"workspace.commit">;
        message: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        commitSha: z$1.ZodString;
        commitSubject: z$1.ZodString;
    }, z$1.core.$strip>, "settled", false>;
    "workspace.squash_merge": HostDaemonCommandDescriptor<"workspace.squash_merge", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                unmanaged: "unmanaged";
                "managed-worktree": "managed-worktree";
                personal: "personal";
            }>;
        }, z$1.core.$strip>;
        type: z$1.ZodLiteral<"workspace.squash_merge">;
        targetBranch: z$1.ZodString;
        commitMessage: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        commitSha: z$1.ZodString;
        commitSubject: z$1.ZodString;
        merged: z$1.ZodBoolean;
    }, z$1.core.$strip>, "settled", false>;
    "workspace.pull_request_action": HostDaemonCommandDescriptor<"workspace.pull_request_action", z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        environmentId: z$1.ZodString;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                unmanaged: "unmanaged";
                "managed-worktree": "managed-worktree";
                personal: "personal";
            }>;
        }, z$1.core.$strip>;
        type: z$1.ZodLiteral<"workspace.pull_request_action">;
        operation: z$1.ZodLiteral<"ready">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        environmentId: z$1.ZodString;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                unmanaged: "unmanaged";
                "managed-worktree": "managed-worktree";
                personal: "personal";
            }>;
        }, z$1.core.$strip>;
        type: z$1.ZodLiteral<"workspace.pull_request_action">;
        operation: z$1.ZodLiteral<"draft">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        environmentId: z$1.ZodString;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                unmanaged: "unmanaged";
                "managed-worktree": "managed-worktree";
                personal: "personal";
            }>;
        }, z$1.core.$strip>;
        type: z$1.ZodLiteral<"workspace.pull_request_action">;
        operation: z$1.ZodLiteral<"merge">;
        method: z$1.ZodEnum<{
            merge: "merge";
            squash: "squash";
            rebase: "rebase";
        }>;
    }, z$1.core.$strict>], "operation">, z$1.ZodObject<{}, z$1.core.$strict>, "settled", false>;
    "host.list_files": HostDaemonCommandDescriptor<"host.list_files", z$1.ZodObject<{
        type: z$1.ZodLiteral<"host.list_files">;
        path: z$1.ZodString;
        query: z$1.ZodOptional<z$1.ZodString>;
        limit: z$1.ZodNumber;
    }, z$1.core.$strip>, z$1.ZodObject<{
        files: z$1.ZodArray<z$1.ZodObject<{
            path: z$1.ZodString;
            name: z$1.ZodString;
        }, z$1.core.$strip>>;
        truncated: z$1.ZodBoolean;
    }, z$1.core.$strip>, "onlineRpc", true>;
    "host.list_paths": HostDaemonCommandDescriptor<"host.list_paths", z$1.ZodObject<{
        type: z$1.ZodLiteral<"host.list_paths">;
        path: z$1.ZodString;
        query: z$1.ZodOptional<z$1.ZodString>;
        limit: z$1.ZodNumber;
        includeFiles: z$1.ZodBoolean;
        includeDirectories: z$1.ZodBoolean;
    }, z$1.core.$strip>, z$1.ZodObject<{
        paths: z$1.ZodArray<z$1.ZodObject<{
            kind: z$1.ZodEnum<{
                file: "file";
                directory: "directory";
            }>;
            path: z$1.ZodString;
            name: z$1.ZodString;
            score: z$1.ZodNumber;
            positions: z$1.ZodArray<z$1.ZodNumber>;
        }, z$1.core.$strip>>;
        truncated: z$1.ZodBoolean;
    }, z$1.core.$strip>, "onlineRpc", true>;
    "host.mkdir": HostDaemonCommandDescriptor<"host.mkdir", z$1.ZodObject<{
        type: z$1.ZodLiteral<"host.mkdir">;
        path: z$1.ZodString;
        rootPath: z$1.ZodOptional<z$1.ZodString>;
        recursive: z$1.ZodBoolean;
    }, z$1.core.$strict>, z$1.ZodObject<{
        ok: z$1.ZodLiteral<true>;
    }, z$1.core.$strict>, "onlineRpc", false>;
    "host.move_path": HostDaemonCommandDescriptor<"host.move_path", z$1.ZodObject<{
        type: z$1.ZodLiteral<"host.move_path">;
        sourcePath: z$1.ZodString;
        destinationPath: z$1.ZodString;
        rootPath: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        ok: z$1.ZodLiteral<true>;
    }, z$1.core.$strict>, "onlineRpc", false>;
    "host.remove_path": HostDaemonCommandDescriptor<"host.remove_path", z$1.ZodObject<{
        type: z$1.ZodLiteral<"host.remove_path">;
        path: z$1.ZodString;
        rootPath: z$1.ZodOptional<z$1.ZodString>;
        recursive: z$1.ZodBoolean;
    }, z$1.core.$strict>, z$1.ZodObject<{
        ok: z$1.ZodLiteral<true>;
    }, z$1.core.$strict>, "onlineRpc", false>;
    "host.browse_directory": HostDaemonCommandDescriptor<"host.browse_directory", z$1.ZodObject<{
        type: z$1.ZodLiteral<"host.browse_directory">;
        path: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        directory: z$1.ZodString;
        parent: z$1.ZodNullable<z$1.ZodString>;
        entries: z$1.ZodArray<z$1.ZodObject<{
            kind: z$1.ZodEnum<{
                file: "file";
                directory: "directory";
            }>;
            name: z$1.ZodString;
            path: z$1.ZodString;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>, "onlineRpc", true>;
    "host.paths_exist": HostDaemonCommandDescriptor<"host.paths_exist", z$1.ZodObject<{
        paths: z$1.ZodPipe<z$1.ZodArray<z$1.ZodString>, z$1.ZodTransform<string[], string[]>>;
        type: z$1.ZodLiteral<"host.paths_exist">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        existence: z$1.ZodRecord<z$1.ZodString, z$1.ZodBoolean>;
    }, z$1.core.$strip>, "onlineRpc", true>;
    "project.inspect": HostDaemonCommandDescriptor<"project.inspect", z$1.ZodObject<{
        type: z$1.ZodLiteral<"project.inspect">;
        path: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        path: z$1.ZodString;
        gitRemoteUrl: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strict>, "onlineRpc", true>;
    "project.clone_default_path": HostDaemonCommandDescriptor<"project.clone_default_path", z$1.ZodObject<{
        type: z$1.ZodLiteral<"project.clone_default_path">;
        projectSlug: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        path: z$1.ZodString;
    }, z$1.core.$strict>, "onlineRpc", true>;
    "host.pick_folder": HostDaemonCommandDescriptor<"host.pick_folder", z$1.ZodObject<{
        type: z$1.ZodLiteral<"host.pick_folder">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        path: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>, "onlineRpc", false>;
    "host.caffeinate": HostDaemonCommandDescriptor<"host.caffeinate", z$1.ZodObject<{
        type: z$1.ZodLiteral<"host.caffeinate">;
        enabled: z$1.ZodBoolean;
    }, z$1.core.$strict>, z$1.ZodObject<{
        enabled: z$1.ZodBoolean;
        supported: z$1.ZodBoolean;
    }, z$1.core.$strict>, "onlineRpc", false>;
    "host.list_commands": HostDaemonCommandDescriptor<"host.list_commands", z$1.ZodObject<{
        type: z$1.ZodLiteral<"host.list_commands">;
        providerId: z$1.ZodString;
        cwd: z$1.ZodNullable<z$1.ZodString>;
        nativeSkillRoots: z$1.ZodOptional<z$1.ZodObject<{
            user: z$1.ZodDefault<z$1.ZodArray<z$1.ZodString>>;
            project: z$1.ZodDefault<z$1.ZodArray<z$1.ZodString>>;
        }, z$1.core.$strict>>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        commands: z$1.ZodArray<z$1.ZodObject<{
            name: z$1.ZodString;
            source: z$1.ZodEnum<{
                command: "command";
                skill: "skill";
            }>;
            origin: z$1.ZodEnum<{
                project: "project";
                user: "user";
            }>;
            description: z$1.ZodNullable<z$1.ZodString>;
            argumentHint: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>, "onlineRpc", true>;
    "host.list_skills": HostDaemonCommandDescriptor<"host.list_skills", z$1.ZodObject<{
        type: z$1.ZodLiteral<"host.list_skills">;
        providerId: z$1.ZodString;
        cwd: z$1.ZodNullable<z$1.ZodString>;
        nativeSkillRoots: z$1.ZodOptional<z$1.ZodObject<{
            user: z$1.ZodDefault<z$1.ZodArray<z$1.ZodString>>;
            project: z$1.ZodDefault<z$1.ZodArray<z$1.ZodString>>;
        }, z$1.core.$strict>>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        skills: z$1.ZodArray<z$1.ZodObject<{
            id: z$1.ZodString;
            name: z$1.ZodString;
            description: z$1.ZodNullable<z$1.ZodString>;
            filePath: z$1.ZodString;
            rootKind: z$1.ZodEnum<{
                "shared-user": "shared-user";
                "shared-project": "shared-project";
                plugin: "plugin";
                "patcher-project": "patcher-project";
                "patcher-data-dir": "patcher-data-dir";
                "patcher-builtin": "patcher-builtin";
                "provider-project": "provider-project";
                "provider-user": "provider-user";
            }>;
            linked: z$1.ZodBoolean;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>, "onlineRpc", true>;
    "host.delete_skill": HostDaemonCommandDescriptor<"host.delete_skill", z$1.ZodObject<{
        type: z$1.ZodLiteral<"host.delete_skill">;
        scope: z$1.ZodEnum<{
            "patcher-project": "patcher-project";
            "patcher-user": "patcher-user";
            "claude-user": "claude-user";
            "claude-project": "claude-project";
            "codex-user": "codex-user";
            "codex-project": "codex-project";
            "cursor-user": "cursor-user";
            "cursor-project": "cursor-project";
        }>;
        name: z$1.ZodString;
        cwd: z$1.ZodNullable<z$1.ZodString>;
        rootPath: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        deletedPath: z$1.ZodString;
    }, z$1.core.$strip>, "onlineRpc", false>;
    "host.write_skill": HostDaemonCommandDescriptor<"host.write_skill", z$1.ZodObject<{
        type: z$1.ZodLiteral<"host.write_skill">;
        scope: z$1.ZodEnum<{
            "patcher-project": "patcher-project";
            "patcher-user": "patcher-user";
        }>;
        name: z$1.ZodString;
        cwd: z$1.ZodNullable<z$1.ZodString>;
        content: z$1.ZodString;
        expectedSha256: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        outcome: z$1.ZodLiteral<"written">;
        filePath: z$1.ZodString;
        sha256: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        outcome: z$1.ZodLiteral<"conflict">;
        currentSha256: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>], "outcome">, "onlineRpc", false>;
    "host.install_global_skills": HostDaemonCommandDescriptor<"host.install_global_skills", z$1.ZodObject<{
        type: z$1.ZodLiteral<"host.install_global_skills">;
        skills: z$1.ZodArray<z$1.ZodObject<{
            name: z$1.ZodString;
            treeHash: z$1.ZodString;
            entryPath: z$1.ZodString;
        }, z$1.core.$strict>>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        installations: z$1.ZodArray<z$1.ZodObject<{
            name: z$1.ZodString;
            path: z$1.ZodString;
        }, z$1.core.$strict>>;
    }, z$1.core.$strict>, "onlineRpc", false>;
    "host.global_skills_status": HostDaemonCommandDescriptor<"host.global_skills_status", z$1.ZodObject<{
        type: z$1.ZodLiteral<"host.global_skills_status">;
        names: z$1.ZodArray<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        entries: z$1.ZodArray<z$1.ZodObject<{
            name: z$1.ZodString;
            path: z$1.ZodString;
            treeHash: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strict>>;
    }, z$1.core.$strict>, "onlineRpc", true>;
    "host.list_branches": HostDaemonCommandDescriptor<"host.list_branches", z$1.ZodObject<{
        type: z$1.ZodLiteral<"host.list_branches">;
        path: z$1.ZodString;
        query: z$1.ZodOptional<z$1.ZodString>;
        selectedBranch: z$1.ZodOptional<z$1.ZodString>;
        limit: z$1.ZodNumber;
    }, z$1.core.$strip>, z$1.ZodObject<{
        branches: z$1.ZodArray<z$1.ZodString>;
        branchesTruncated: z$1.ZodBoolean;
        checkout: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"branch">;
            branchName: z$1.ZodString;
            headSha: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"detached">;
            headSha: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"unborn">;
            branchName: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"unknown">;
            reason: z$1.ZodString;
        }, z$1.core.$strip>], "kind">;
        defaultBranch: z$1.ZodNullable<z$1.ZodString>;
        defaultBranchRelation: z$1.ZodNullable<z$1.ZodEnum<{
            unknown: "unknown";
            equal: "equal";
            "local-behind": "local-behind";
            "local-ahead": "local-ahead";
            diverged: "diverged";
        }>>;
        hasUncommittedChanges: z$1.ZodBoolean;
        operation: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"none">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"merge">;
            hasConflicts: z$1.ZodBoolean;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"rebase">;
            hasConflicts: z$1.ZodBoolean;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"cherry-pick">;
            hasConflicts: z$1.ZodBoolean;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"revert">;
            hasConflicts: z$1.ZodBoolean;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"unknown">;
            reason: z$1.ZodString;
            hasConflicts: z$1.ZodBoolean;
        }, z$1.core.$strip>], "kind">;
        originDefaultBranch: z$1.ZodNullable<z$1.ZodString>;
        remoteBranches: z$1.ZodArray<z$1.ZodString>;
        remoteBranchesTruncated: z$1.ZodBoolean;
        selectedBranch: z$1.ZodNullable<z$1.ZodObject<{
            name: z$1.ZodString;
            kind: z$1.ZodEnum<{
                local: "local";
                remote: "remote";
                missing: "missing";
            }>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>, "onlineRpc", true>;
    "host.file_metadata": HostDaemonCommandDescriptor<"host.file_metadata", z$1.ZodObject<{
        type: z$1.ZodLiteral<"host.file_metadata">;
        path: z$1.ZodString;
        rootPath: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        path: z$1.ZodString;
        modifiedAtMs: z$1.ZodNumber;
        sizeBytes: z$1.ZodNumber;
    }, z$1.core.$strip>, "onlineRpc", true>;
    "host.read_file": HostDaemonCommandDescriptor<"host.read_file", z$1.ZodObject<{
        type: z$1.ZodLiteral<"host.read_file">;
        path: z$1.ZodString;
        rootPath: z$1.ZodOptional<z$1.ZodString>;
        ref: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        path: z$1.ZodString;
        content: z$1.ZodString;
        contentEncoding: z$1.ZodEnum<{
            base64: "base64";
            utf8: "utf8";
        }>;
        mimeType: z$1.ZodOptional<z$1.ZodString>;
        sizeBytes: z$1.ZodNumber;
        modifiedAtMs: z$1.ZodOptional<z$1.ZodNumber>;
        sha256: z$1.ZodString;
    }, z$1.core.$strip>, "onlineRpc", true>;
    "host.read_file_relative": HostDaemonCommandDescriptor<"host.read_file_relative", z$1.ZodObject<{
        type: z$1.ZodLiteral<"host.read_file_relative">;
        rootPath: z$1.ZodString;
        path: z$1.ZodString;
        dotfiles: z$1.ZodEnum<{
            deny: "deny";
            allow: "allow";
        }>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        path: z$1.ZodString;
        content: z$1.ZodString;
        contentEncoding: z$1.ZodEnum<{
            base64: "base64";
            utf8: "utf8";
        }>;
        mimeType: z$1.ZodOptional<z$1.ZodString>;
        sizeBytes: z$1.ZodNumber;
        modifiedAtMs: z$1.ZodOptional<z$1.ZodNumber>;
        sha256: z$1.ZodString;
    }, z$1.core.$strip>, "onlineRpc", true>;
    "host.write_file": HostDaemonCommandDescriptor<"host.write_file", z$1.ZodObject<{
        type: z$1.ZodLiteral<"host.write_file">;
        path: z$1.ZodString;
        rootPath: z$1.ZodOptional<z$1.ZodString>;
        content: z$1.ZodString;
        contentEncoding: z$1.ZodEnum<{
            base64: "base64";
            utf8: "utf8";
        }>;
        createParents: z$1.ZodBoolean;
        expectedSha256: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
        mode: z$1.ZodOptional<z$1.ZodNumber>;
    }, z$1.core.$strict>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        outcome: z$1.ZodLiteral<"written">;
        sha256: z$1.ZodString;
        sizeBytes: z$1.ZodNumber;
    }, z$1.core.$strict>, z$1.ZodObject<{
        outcome: z$1.ZodLiteral<"conflict">;
        currentSha256: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strict>], "outcome">, "onlineRpc", false>;
    "provider.list_models": HostDaemonCommandDescriptor<"provider.list_models", z$1.ZodObject<{
        type: z$1.ZodLiteral<"provider.list_models">;
        providerId: z$1.ZodString;
        acpLaunchSpec: z$1.ZodOptional<z$1.ZodObject<{
            displayName: z$1.ZodString;
            command: z$1.ZodString;
            args: z$1.ZodArray<z$1.ZodString>;
            env: z$1.ZodRecord<z$1.ZodString, z$1.ZodString>;
            cwd: z$1.ZodOptional<z$1.ZodString>;
            modelCli: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodObject<{
                listArgs: z$1.ZodArray<z$1.ZodString>;
                selectFlag: z$1.ZodOptional<z$1.ZodString>;
                primaryModels: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strict>, z$1.ZodTransform<{
                listArgs: string[];
                primaryModels: string[];
                selectFlag?: string | undefined;
            } | undefined, {
                listArgs: string[];
                primaryModels: string[];
                selectFlag?: string | undefined;
            }>>>;
            reasoningCli: z$1.ZodOptional<z$1.ZodObject<{
                flag: z$1.ZodString;
                supportedLevels: z$1.ZodArray<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }>>;
                levelValues: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }> & z$1.core.$partial, z$1.ZodString>>;
                defaultLevel: z$1.ZodOptional<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }>>;
            }, z$1.core.$strict>>;
            nativeReasoning: z$1.ZodOptional<z$1.ZodObject<{
                configId: z$1.ZodString;
                supportedLevels: z$1.ZodArray<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }>>;
                levelValues: z$1.ZodOptional<z$1.ZodRecord<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }> & z$1.core.$partial, z$1.ZodString>>;
                defaultLevel: z$1.ZodOptional<z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }>>;
            }, z$1.core.$strict>>;
            nativeSkillRoots: z$1.ZodOptional<z$1.ZodObject<{
                user: z$1.ZodDefault<z$1.ZodArray<z$1.ZodString>>;
                project: z$1.ZodDefault<z$1.ZodArray<z$1.ZodString>>;
            }, z$1.core.$strict>>;
            permissionCli: z$1.ZodOptional<z$1.ZodObject<{
                full: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
                workspaceWrite: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
                readonly: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
                insertAfterArgs: z$1.ZodOptional<z$1.ZodNumber>;
            }, z$1.core.$strict>>;
        }, z$1.core.$strict>>;
        cwd: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        models: z$1.ZodArray<z$1.ZodObject<{
            id: z$1.ZodString;
            model: z$1.ZodString;
            displayName: z$1.ZodString;
            routeProviderId: z$1.ZodOptional<z$1.ZodString>;
            description: z$1.ZodString;
            supportedReasoningEfforts: z$1.ZodArray<z$1.ZodObject<{
                reasoningEffort: z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }>;
                description: z$1.ZodString;
            }, z$1.core.$strip>>;
            defaultReasoningEffort: z$1.ZodEnum<{
                none: "none";
                low: "low";
                medium: "medium";
                high: "high";
                xhigh: "xhigh";
                ultracode: "ultracode";
                max: "max";
                ultra: "ultra";
            }>;
            isDefault: z$1.ZodBoolean;
        }, z$1.core.$strip>>;
        selectedOnlyModels: z$1.ZodArray<z$1.ZodObject<{
            id: z$1.ZodString;
            model: z$1.ZodString;
            displayName: z$1.ZodString;
            routeProviderId: z$1.ZodOptional<z$1.ZodString>;
            description: z$1.ZodString;
            supportedReasoningEfforts: z$1.ZodArray<z$1.ZodObject<{
                reasoningEffort: z$1.ZodEnum<{
                    none: "none";
                    low: "low";
                    medium: "medium";
                    high: "high";
                    xhigh: "xhigh";
                    ultracode: "ultracode";
                    max: "max";
                    ultra: "ultra";
                }>;
                description: z$1.ZodString;
            }, z$1.core.$strip>>;
            defaultReasoningEffort: z$1.ZodEnum<{
                none: "none";
                low: "low";
                medium: "medium";
                high: "high";
                xhigh: "xhigh";
                ultracode: "ultracode";
                max: "max";
                ultra: "ultra";
            }>;
            isDefault: z$1.ZodBoolean;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>, "onlineRpc", true>;
    "known_acp_agents.status": HostDaemonCommandDescriptor<"known_acp_agents.status", z$1.ZodObject<{
        type: z$1.ZodLiteral<"known_acp_agents.status">;
        agents: z$1.ZodArray<z$1.ZodObject<{
            id: z$1.ZodString;
            executableName: z$1.ZodString;
        }, z$1.core.$strict>>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        agents: z$1.ZodArray<z$1.ZodObject<{
            id: z$1.ZodString;
            executableName: z$1.ZodString;
            installed: z$1.ZodBoolean;
            executablePath: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strict>>;
    }, z$1.core.$strict>, "onlineRpc", true>;
    "provider.usage": HostDaemonCommandDescriptor<"provider.usage", z$1.ZodObject<{
        type: z$1.ZodLiteral<"provider.usage">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        codex: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            status: z$1.ZodLiteral<"ok">;
            accountEmail: z$1.ZodNullable<z$1.ZodString>;
            planLabel: z$1.ZodNullable<z$1.ZodString>;
            windows: z$1.ZodArray<z$1.ZodObject<{
                label: z$1.ZodString;
                usedPercent: z$1.ZodNumber;
                resetsAt: z$1.ZodNullable<z$1.ZodString>;
                cost: z$1.ZodOptional<z$1.ZodObject<{
                    usedUsdCents: z$1.ZodNumber;
                    limitUsdCents: z$1.ZodNumber;
                }, z$1.core.$strip>>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            status: z$1.ZodLiteral<"not_installed">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            status: z$1.ZodLiteral<"unauthenticated">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            status: z$1.ZodLiteral<"expired">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            status: z$1.ZodLiteral<"error">;
            message: z$1.ZodString;
            planLabel: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodString>>;
            accountEmail: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodString>>;
        }, z$1.core.$strip>], "status">;
        claudeCode: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            status: z$1.ZodLiteral<"ok">;
            accountEmail: z$1.ZodNullable<z$1.ZodString>;
            planLabel: z$1.ZodNullable<z$1.ZodString>;
            windows: z$1.ZodArray<z$1.ZodObject<{
                label: z$1.ZodString;
                usedPercent: z$1.ZodNumber;
                resetsAt: z$1.ZodNullable<z$1.ZodString>;
                cost: z$1.ZodOptional<z$1.ZodObject<{
                    usedUsdCents: z$1.ZodNumber;
                    limitUsdCents: z$1.ZodNumber;
                }, z$1.core.$strip>>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            status: z$1.ZodLiteral<"not_installed">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            status: z$1.ZodLiteral<"unauthenticated">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            status: z$1.ZodLiteral<"expired">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            status: z$1.ZodLiteral<"error">;
            message: z$1.ZodString;
            planLabel: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodString>>;
            accountEmail: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodString>>;
        }, z$1.core.$strip>], "status">;
        cursor: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            status: z$1.ZodLiteral<"ok">;
            accountEmail: z$1.ZodNullable<z$1.ZodString>;
            planLabel: z$1.ZodNullable<z$1.ZodString>;
            windows: z$1.ZodArray<z$1.ZodObject<{
                label: z$1.ZodString;
                usedPercent: z$1.ZodNumber;
                resetsAt: z$1.ZodNullable<z$1.ZodString>;
                cost: z$1.ZodOptional<z$1.ZodObject<{
                    usedUsdCents: z$1.ZodNumber;
                    limitUsdCents: z$1.ZodNumber;
                }, z$1.core.$strip>>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            status: z$1.ZodLiteral<"not_installed">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            status: z$1.ZodLiteral<"unauthenticated">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            status: z$1.ZodLiteral<"expired">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            status: z$1.ZodLiteral<"error">;
            message: z$1.ZodString;
            planLabel: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodString>>;
            accountEmail: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodString>>;
        }, z$1.core.$strip>], "status">;
    }, z$1.core.$strip>, "onlineRpc", true>;
    "workspace.discover_repos": HostDaemonCommandDescriptor<"workspace.discover_repos", z$1.ZodObject<{
        type: z$1.ZodLiteral<"workspace.discover_repos">;
        maxDepth: z$1.ZodNumber;
        sinceDays: z$1.ZodNumber;
        limit: z$1.ZodNumber;
    }, z$1.core.$strict>, z$1.ZodObject<{
        repos: z$1.ZodArray<z$1.ZodObject<{
            path: z$1.ZodString;
            name: z$1.ZodString;
            lastActivityAt: z$1.ZodString;
            originUrl: z$1.ZodNullable<z$1.ZodString>;
            agentSeen: z$1.ZodBoolean;
            agentSeenAt: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strict>>;
        truncated: z$1.ZodBoolean;
    }, z$1.core.$strict>, "onlineRpc", true>;
    "provider_cli.status": HostDaemonCommandDescriptor<"provider_cli.status", z$1.ZodObject<{
        type: z$1.ZodLiteral<"provider_cli.status">;
    }, z$1.core.$strict>, z$1.ZodRecord<z$1.ZodEnum<{
        codex: "codex";
        claudeCode: "claudeCode";
        cursor: "cursor";
    }>, z$1.ZodObject<{
        displayName: z$1.ZodString;
        executableName: z$1.ZodString;
        executablePath: z$1.ZodNullable<z$1.ZodString>;
        installed: z$1.ZodBoolean;
        installSource: z$1.ZodEnum<{
            external: "external";
            notInstalled: "notInstalled";
            npmGlobal: "npmGlobal";
        }>;
        currentVersion: z$1.ZodNullable<z$1.ZodString>;
        latestVersion: z$1.ZodNullable<z$1.ZodString>;
        minimumSupportedVersion: z$1.ZodNullable<z$1.ZodString>;
        npmPackageName: z$1.ZodNullable<z$1.ZodString>;
        npmGlobalPackageVersion: z$1.ZodNullable<z$1.ZodString>;
        installAction: z$1.ZodNullable<z$1.ZodObject<{
            kind: z$1.ZodEnum<{
                install: "install";
                update: "update";
            }>;
            label: z$1.ZodEnum<{
                Install: "Install";
                Update: "Update";
            }>;
            commandKind: z$1.ZodEnum<{
                exec: "exec";
                shell: "shell";
            }>;
            command: z$1.ZodString;
        }, z$1.core.$strip>>;
        needsUpdate: z$1.ZodBoolean;
        versionUnsupported: z$1.ZodBoolean;
    }, z$1.core.$strip>>, "onlineRpc", true>;
    "provider_cli.install": HostDaemonCommandDescriptor<"provider_cli.install", z$1.ZodObject<{
        provider: z$1.ZodEnum<{
            codex: "codex";
            claudeCode: "claudeCode";
            cursor: "cursor";
        }>;
        actionKind: z$1.ZodEnum<{
            install: "install";
            update: "update";
        }>;
        type: z$1.ZodLiteral<"provider_cli.install">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        events: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            type: z$1.ZodLiteral<"started">;
            provider: z$1.ZodEnum<{
                codex: "codex";
                claudeCode: "claudeCode";
                cursor: "cursor";
            }>;
            command: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"output">;
            provider: z$1.ZodEnum<{
                codex: "codex";
                claudeCode: "claudeCode";
                cursor: "cursor";
            }>;
            stream: z$1.ZodEnum<{
                stdout: "stdout";
                stderr: "stderr";
            }>;
            text: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"completed">;
            provider: z$1.ZodEnum<{
                codex: "codex";
                claudeCode: "claudeCode";
                cursor: "cursor";
            }>;
            exitCode: z$1.ZodNullable<z$1.ZodNumber>;
            signal: z$1.ZodNullable<z$1.ZodString>;
            success: z$1.ZodBoolean;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"error">;
            provider: z$1.ZodEnum<{
                codex: "codex";
                claudeCode: "claudeCode";
                cursor: "cursor";
            }>;
            message: z$1.ZodString;
        }, z$1.core.$strip>], "type">>;
    }, z$1.core.$strict>, "onlineRpc", false>;
    "workspace.status": HostDaemonCommandDescriptor<"workspace.status", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                unmanaged: "unmanaged";
                "managed-worktree": "managed-worktree";
                personal: "personal";
            }>;
        }, z$1.core.$strip>;
        type: z$1.ZodLiteral<"workspace.status">;
        mergeBaseBranch: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        outcome: z$1.ZodLiteral<"available">;
        workspaceStatus: z$1.ZodObject<{
            workingTree: z$1.ZodObject<{
                insertions: z$1.ZodNumber;
                deletions: z$1.ZodNumber;
                files: z$1.ZodArray<z$1.ZodObject<{
                    path: z$1.ZodString;
                    status: z$1.ZodEnum<{
                        M: "M";
                        A: "A";
                        D: "D";
                        R: "R";
                        C: "C";
                        U: "U";
                        "??": "??";
                        "?": "?";
                    }>;
                    insertions: z$1.ZodNullable<z$1.ZodNumber>;
                    deletions: z$1.ZodNullable<z$1.ZodNumber>;
                }, z$1.core.$strip>>;
                hasUncommittedChanges: z$1.ZodBoolean;
                state: z$1.ZodEnum<{
                    clean: "clean";
                    untracked: "untracked";
                    dirty_uncommitted: "dirty_uncommitted";
                    committed_unmerged: "committed_unmerged";
                    dirty_and_committed_unmerged: "dirty_and_committed_unmerged";
                }>;
            }, z$1.core.$strip>;
            checkout: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"branch">;
                branchName: z$1.ZodString;
                headSha: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"detached">;
                headSha: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"unborn">;
                branchName: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"unknown">;
                reason: z$1.ZodString;
            }, z$1.core.$strip>], "kind">;
            branch: z$1.ZodObject<{
                currentBranch: z$1.ZodNullable<z$1.ZodString>;
                defaultBranch: z$1.ZodString;
            }, z$1.core.$strip>;
            mergeBase: z$1.ZodNullable<z$1.ZodObject<{
                insertions: z$1.ZodNumber;
                deletions: z$1.ZodNumber;
                files: z$1.ZodArray<z$1.ZodObject<{
                    path: z$1.ZodString;
                    status: z$1.ZodEnum<{
                        M: "M";
                        A: "A";
                        D: "D";
                        R: "R";
                        C: "C";
                        U: "U";
                        "??": "??";
                        "?": "?";
                    }>;
                    insertions: z$1.ZodNullable<z$1.ZodNumber>;
                    deletions: z$1.ZodNullable<z$1.ZodNumber>;
                }, z$1.core.$strip>>;
                mergeBaseBranch: z$1.ZodString;
                baseRef: z$1.ZodNullable<z$1.ZodString>;
                aheadCount: z$1.ZodNumber;
                behindCount: z$1.ZodNumber;
                hasCommittedUnmergedChanges: z$1.ZodBoolean;
                commits: z$1.ZodArray<z$1.ZodObject<{
                    sha: z$1.ZodString;
                    shortSha: z$1.ZodString;
                    subject: z$1.ZodString;
                    authorName: z$1.ZodString;
                    authoredAt: z$1.ZodNumber;
                }, z$1.core.$strip>>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        outcome: z$1.ZodLiteral<"unavailable">;
        failure: z$1.ZodObject<{
            code: z$1.ZodEnum<{
                path_not_found: "path_not_found";
                not_git_repo: "not_git_repo";
                not_worktree: "not_worktree";
                workspace_type_mismatch: "workspace_type_mismatch";
                permission_denied: "permission_denied";
                unknown_environment: "unknown_environment";
                unknown: "unknown";
            }>;
            workspacePath: z$1.ZodString;
            message: z$1.ZodString;
        }, z$1.core.$strict>;
    }, z$1.core.$strict>], "outcome">, "onlineRpc", true>;
    "workspace.diff": HostDaemonCommandDescriptor<"workspace.diff", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                unmanaged: "unmanaged";
                "managed-worktree": "managed-worktree";
                personal: "personal";
            }>;
        }, z$1.core.$strip>;
        type: z$1.ZodLiteral<"workspace.diff">;
        target: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            type: z$1.ZodLiteral<"uncommitted">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"branch_committed">;
            mergeBaseBranch: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"all">;
            mergeBaseBranch: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"commit">;
            sha: z$1.ZodString;
        }, z$1.core.$strip>], "type">;
        maxDiffBytes: z$1.ZodNumber;
        maxFileListBytes: z$1.ZodNumber;
    }, z$1.core.$strict>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        outcome: z$1.ZodLiteral<"available">;
        diff: z$1.ZodObject<{
            diff: z$1.ZodString;
            truncated: z$1.ZodBoolean;
            shortstat: z$1.ZodString;
            files: z$1.ZodString;
            mergeBaseRef: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        outcome: z$1.ZodLiteral<"unavailable">;
        failure: z$1.ZodObject<{
            code: z$1.ZodEnum<{
                path_not_found: "path_not_found";
                not_git_repo: "not_git_repo";
                not_worktree: "not_worktree";
                workspace_type_mismatch: "workspace_type_mismatch";
                permission_denied: "permission_denied";
                unknown_environment: "unknown_environment";
                unknown: "unknown";
            }>;
            workspacePath: z$1.ZodString;
            message: z$1.ZodString;
        }, z$1.core.$strict>;
    }, z$1.core.$strict>], "outcome">, "onlineRpc", true>;
    "workspace.diffFiles": HostDaemonCommandDescriptor<"workspace.diffFiles", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                unmanaged: "unmanaged";
                "managed-worktree": "managed-worktree";
                personal: "personal";
            }>;
        }, z$1.core.$strip>;
        type: z$1.ZodLiteral<"workspace.diffFiles">;
        target: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            type: z$1.ZodLiteral<"uncommitted">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"branch_committed">;
            mergeBaseBranch: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"all">;
            mergeBaseBranch: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"commit">;
            sha: z$1.ZodString;
        }, z$1.core.$strip>], "type">;
    }, z$1.core.$strict>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        outcome: z$1.ZodLiteral<"available">;
        files: z$1.ZodArray<z$1.ZodObject<{
            path: z$1.ZodString;
            previousPath: z$1.ZodNullable<z$1.ZodString>;
            statusLetter: z$1.ZodEnum<{
                M: "M";
                A: "A";
                D: "D";
                R: "R";
                C: "C";
                T: "T";
            }>;
            additions: z$1.ZodNumber;
            deletions: z$1.ZodNumber;
            binary: z$1.ZodBoolean;
            origin: z$1.ZodEnum<{
                untracked: "untracked";
                tracked: "tracked";
            }>;
        }, z$1.core.$strip>>;
        shortstat: z$1.ZodString;
        mergeBaseRef: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        outcome: z$1.ZodLiteral<"unavailable">;
        failure: z$1.ZodObject<{
            code: z$1.ZodEnum<{
                path_not_found: "path_not_found";
                not_git_repo: "not_git_repo";
                not_worktree: "not_worktree";
                workspace_type_mismatch: "workspace_type_mismatch";
                permission_denied: "permission_denied";
                unknown_environment: "unknown_environment";
                unknown: "unknown";
            }>;
            workspacePath: z$1.ZodString;
            message: z$1.ZodString;
        }, z$1.core.$strict>;
    }, z$1.core.$strict>], "outcome">, "onlineRpc", true>;
    "workspace.diffPatch": HostDaemonCommandDescriptor<"workspace.diffPatch", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                unmanaged: "unmanaged";
                "managed-worktree": "managed-worktree";
                personal: "personal";
            }>;
        }, z$1.core.$strip>;
        type: z$1.ZodLiteral<"workspace.diffPatch">;
        target: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            type: z$1.ZodLiteral<"uncommitted">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"branch_committed">;
            mergeBaseBranch: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"all">;
            mergeBaseBranch: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"commit">;
            sha: z$1.ZodString;
        }, z$1.core.$strip>], "type">;
        paths: z$1.ZodArray<z$1.ZodString>;
        maxBytesPerFile: z$1.ZodNumber;
    }, z$1.core.$strict>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        outcome: z$1.ZodLiteral<"available">;
        patches: z$1.ZodArray<z$1.ZodObject<{
            path: z$1.ZodString;
            patch: z$1.ZodString;
            truncated: z$1.ZodBoolean;
        }, z$1.core.$strict>>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        outcome: z$1.ZodLiteral<"unavailable">;
        failure: z$1.ZodObject<{
            code: z$1.ZodEnum<{
                path_not_found: "path_not_found";
                not_git_repo: "not_git_repo";
                not_worktree: "not_worktree";
                workspace_type_mismatch: "workspace_type_mismatch";
                permission_denied: "permission_denied";
                unknown_environment: "unknown_environment";
                unknown: "unknown";
            }>;
            workspacePath: z$1.ZodString;
            message: z$1.ZodString;
        }, z$1.core.$strict>;
    }, z$1.core.$strict>], "outcome">, "onlineRpc", true>;
    "workspace.pull_request": HostDaemonCommandDescriptor<"workspace.pull_request", z$1.ZodObject<{
        environmentId: z$1.ZodString;
        workspaceContext: z$1.ZodObject<{
            workspacePath: z$1.ZodString;
            workspaceProvisionType: z$1.ZodEnum<{
                unmanaged: "unmanaged";
                "managed-worktree": "managed-worktree";
                personal: "personal";
            }>;
        }, z$1.core.$strip>;
        type: z$1.ZodLiteral<"workspace.pull_request">;
    }, z$1.core.$strict>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        outcome: z$1.ZodLiteral<"available">;
        pullRequest: z$1.ZodObject<{
            number: z$1.ZodNumber;
            title: z$1.ZodString;
            state: z$1.ZodEnum<{
                OPEN: "OPEN";
                CLOSED: "CLOSED";
                MERGED: "MERGED";
            }>;
            url: z$1.ZodString;
            isDraft: z$1.ZodBoolean;
            baseRefName: z$1.ZodString;
            headRefName: z$1.ZodString;
            updatedAt: z$1.ZodString;
            checks: z$1.ZodArray<z$1.ZodObject<{
                name: z$1.ZodString;
                status: z$1.ZodEnum<{
                    unknown: "unknown";
                    completed: "completed";
                    queued: "queued";
                    in_progress: "in_progress";
                }>;
                conclusion: z$1.ZodNullable<z$1.ZodEnum<{
                    unknown: "unknown";
                    success: "success";
                    cancelled: "cancelled";
                    failure: "failure";
                    skipped: "skipped";
                    neutral: "neutral";
                    timed_out: "timed_out";
                    action_required: "action_required";
                    startup_failure: "startup_failure";
                    stale: "stale";
                }>>;
                url: z$1.ZodNullable<z$1.ZodString>;
                startedAt: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strict>>;
            reviewDecision: z$1.ZodNullable<z$1.ZodEnum<{
                APPROVED: "APPROVED";
                CHANGES_REQUESTED: "CHANGES_REQUESTED";
                REVIEW_REQUIRED: "REVIEW_REQUIRED";
            }>>;
            reviewRequestCount: z$1.ZodNumber;
            mergeStateStatus: z$1.ZodNullable<z$1.ZodEnum<{
                BEHIND: "BEHIND";
                BLOCKED: "BLOCKED";
                CLEAN: "CLEAN";
                DIRTY: "DIRTY";
                DRAFT: "DRAFT";
                HAS_HOOKS: "HAS_HOOKS";
                UNKNOWN: "UNKNOWN";
                UNSTABLE: "UNSTABLE";
            }>>;
            mergeable: z$1.ZodNullable<z$1.ZodEnum<{
                UNKNOWN: "UNKNOWN";
                CONFLICTING: "CONFLICTING";
                MERGEABLE: "MERGEABLE";
            }>>;
        }, z$1.core.$strict>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        outcome: z$1.ZodLiteral<"absent">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        outcome: z$1.ZodLiteral<"unavailable">;
        message: z$1.ZodString;
    }, z$1.core.$strict>], "outcome">, "onlineRpc", true>;
};
type HostDaemonCommandRegistry = typeof hostDaemonCommandRegistry;
type AnyHostDaemonCommandDescriptor = HostDaemonCommandRegistry[keyof HostDaemonCommandRegistry];
type HostDaemonCommandDescriptorForTransport<Transport extends HostDaemonCommandTransport> = Extract<AnyHostDaemonCommandDescriptor, {
    transport: Transport;
}>;
type HostDaemonResultSchemaMapForTransport<Transport extends HostDaemonCommandTransport> = {
    [Descriptor in HostDaemonCommandDescriptorForTransport<Transport> as Descriptor["type"]]: Descriptor["resultSchema"];
};
type HostDaemonOnlineRpcResultSchemaMap = HostDaemonResultSchemaMapForTransport<"onlineRpc">;
type HostDaemonOnlineRpcResultByType = {
    [K in keyof HostDaemonOnlineRpcResultSchemaMap]: z$1.infer<HostDaemonOnlineRpcResultSchemaMap[K]>;
};

declare const pickFolderResponseSchema: z$1.ZodObject<{
    path: z$1.ZodNullable<z$1.ZodString>;
}, z$1.core.$strip>;
type PickFolderResponse = z$1.infer<typeof pickFolderResponseSchema>;
declare const pathsExistRequestSchema: z$1.ZodObject<{
    paths: z$1.ZodPipe<z$1.ZodArray<z$1.ZodString>, z$1.ZodTransform<string[], string[]>>;
}, z$1.core.$strip>;
type PathsExistRequest = z$1.infer<typeof pathsExistRequestSchema>;
declare const pathsExistResponseSchema: z$1.ZodObject<{
    existence: z$1.ZodRecord<z$1.ZodString, z$1.ZodBoolean>;
}, z$1.core.$strip>;
type PathsExistResponse = z$1.infer<typeof pathsExistResponseSchema>;
declare const providerCliStatusResponseSchema: z$1.ZodRecord<z$1.ZodEnum<{
    codex: "codex";
    claudeCode: "claudeCode";
    cursor: "cursor";
}>, z$1.ZodObject<{
    displayName: z$1.ZodString;
    executableName: z$1.ZodString;
    executablePath: z$1.ZodNullable<z$1.ZodString>;
    installed: z$1.ZodBoolean;
    installSource: z$1.ZodEnum<{
        external: "external";
        notInstalled: "notInstalled";
        npmGlobal: "npmGlobal";
    }>;
    currentVersion: z$1.ZodNullable<z$1.ZodString>;
    latestVersion: z$1.ZodNullable<z$1.ZodString>;
    minimumSupportedVersion: z$1.ZodNullable<z$1.ZodString>;
    npmPackageName: z$1.ZodNullable<z$1.ZodString>;
    npmGlobalPackageVersion: z$1.ZodNullable<z$1.ZodString>;
    installAction: z$1.ZodNullable<z$1.ZodObject<{
        kind: z$1.ZodEnum<{
            install: "install";
            update: "update";
        }>;
        label: z$1.ZodEnum<{
            Install: "Install";
            Update: "Update";
        }>;
        commandKind: z$1.ZodEnum<{
            exec: "exec";
            shell: "shell";
        }>;
        command: z$1.ZodString;
    }, z$1.core.$strip>>;
    needsUpdate: z$1.ZodBoolean;
    versionUnsupported: z$1.ZodBoolean;
}, z$1.core.$strip>>;
type ProviderCliStatusResponse = z$1.infer<typeof providerCliStatusResponseSchema>;
declare const providerCliInstallRequestSchema: z$1.ZodObject<{
    provider: z$1.ZodEnum<{
        codex: "codex";
        claudeCode: "claudeCode";
        cursor: "cursor";
    }>;
    actionKind: z$1.ZodEnum<{
        install: "install";
        update: "update";
    }>;
}, z$1.core.$strip>;
type ProviderCliInstallRequest = z$1.infer<typeof providerCliInstallRequestSchema>;
declare const providerCliInstallEventSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    type: z$1.ZodLiteral<"started">;
    provider: z$1.ZodEnum<{
        codex: "codex";
        claudeCode: "claudeCode";
        cursor: "cursor";
    }>;
    command: z$1.ZodString;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"output">;
    provider: z$1.ZodEnum<{
        codex: "codex";
        claudeCode: "claudeCode";
        cursor: "cursor";
    }>;
    stream: z$1.ZodEnum<{
        stdout: "stdout";
        stderr: "stderr";
    }>;
    text: z$1.ZodString;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"completed">;
    provider: z$1.ZodEnum<{
        codex: "codex";
        claudeCode: "claudeCode";
        cursor: "cursor";
    }>;
    exitCode: z$1.ZodNullable<z$1.ZodNumber>;
    signal: z$1.ZodNullable<z$1.ZodString>;
    success: z$1.ZodBoolean;
}, z$1.core.$strip>, z$1.ZodObject<{
    type: z$1.ZodLiteral<"error">;
    provider: z$1.ZodEnum<{
        codex: "codex";
        claudeCode: "claudeCode";
        cursor: "cursor";
    }>;
    message: z$1.ZodString;
}, z$1.core.$strip>], "type">;
type ProviderCliInstallEvent = z$1.infer<typeof providerCliInstallEventSchema>;

interface CreateFilePreviewResponse {
    baseUrl: string;
    expiresAtMs: number;
}
type HostFileReadResponse = HostDaemonOnlineRpcResultByType["host.read_file"];
type HostFileWriteResponse = HostDaemonOnlineRpcResultByType["host.write_file"];
type HostFileListResponse = HostDaemonOnlineRpcResultByType["host.list_files"];
type HostPathListResponse = HostDaemonOnlineRpcResultByType["host.list_paths"];
type HostMkdirResponse = HostDaemonOnlineRpcResultByType["host.mkdir"];
type HostMovePathResponse = HostDaemonOnlineRpcResultByType["host.move_path"];
type HostRemovePathResponse = HostDaemonOnlineRpcResultByType["host.remove_path"];

/**
 * Query for `GET /hosts/:id/directory`, the interactive path browser's
 * single-level directory read. `path` is an absolute directory on the host;
 * omitting it lists the host's home directory (the daemon resolves it, since a
 * remote caller cannot know the host's home).
 */
declare const hostDirectoryQuerySchema: z$1.ZodObject<{
    path: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type HostDirectoryQuery = z$1.infer<typeof hostDirectoryQuerySchema>;
declare const hostDirectoryListingSchema: z$1.ZodObject<{
    directory: z$1.ZodString;
    parent: z$1.ZodNullable<z$1.ZodString>;
    entries: z$1.ZodArray<z$1.ZodObject<{
        kind: z$1.ZodEnum<{
            file: "file";
            directory: "directory";
        }>;
        name: z$1.ZodString;
        path: z$1.ZodString;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type HostDirectoryListing = z$1.infer<typeof hostDirectoryListingSchema>;
/** Project name is sent so the daemon can derive its host-local checkout path. */
declare const hostCloneDefaultPathQuerySchema: z$1.ZodObject<{
    projectId: z$1.ZodString;
}, z$1.core.$strip>;
type HostCloneDefaultPathQuery = z$1.infer<typeof hostCloneDefaultPathQuerySchema>;
declare const hostCloneDefaultPathResponseSchema: z$1.ZodObject<{
    path: z$1.ZodString;
}, z$1.core.$strict>;
type HostCloneDefaultPathResponse = z$1.infer<typeof hostCloneDefaultPathResponseSchema>;
declare const createHostJoinCodeResponseSchema: z$1.ZodObject<{
    joinCode: z$1.ZodString;
    hostId: z$1.ZodString;
    expiresAt: z$1.ZodNumber;
}, z$1.core.$strip>;
type CreateHostJoinCodeResponse = z$1.infer<typeof createHostJoinCodeResponseSchema>;
declare const updateHostRequestSchema: z$1.ZodObject<{
    name: z$1.ZodString;
}, z$1.core.$strict>;
type UpdateHostRequest = z$1.infer<typeof updateHostRequestSchema>;
declare const hostRetryUpdateResponseSchema: z$1.ZodObject<{
    ok: z$1.ZodLiteral<true>;
}, z$1.core.$strict>;
type HostRetryUpdateResponse = z$1.infer<typeof hostRetryUpdateResponseSchema>;
type HostPathsExistRequest = PathsExistRequest;
type HostPathsExistResponse = PathsExistResponse;
declare const hostPickFolderRequestSchema: z$1.ZodObject<{
    clientHostId: z$1.ZodString;
}, z$1.core.$strict>;
type HostPickFolderRequest = z$1.infer<typeof hostPickFolderRequestSchema>;
type HostPickFolderResponse = PickFolderResponse;
type HostProviderCliStatusResponse = ProviderCliStatusResponse;
type HostProviderCliInstallRequest = ProviderCliInstallRequest;
type HostProviderCliInstallEvent = ProviderCliInstallEvent;

declare const pluginUpdateCheckEntrySchema: z$1.ZodObject<{
    id: z$1.ZodString;
    outcome: z$1.ZodEnum<{
        unavailable: "unavailable";
        pinned: "pinned";
        incompatible: "incompatible";
        current: "current";
        "update-available": "update-available";
    }>;
    devMode: z$1.ZodOptional<z$1.ZodLiteral<true>>;
    installed: z$1.ZodObject<{
        version: z$1.ZodString;
        display: z$1.ZodString;
    }, z$1.core.$strip>;
    candidate: z$1.ZodOptional<z$1.ZodObject<{
        version: z$1.ZodString;
        display: z$1.ZodString;
    }, z$1.core.$strip>>;
    blocked: z$1.ZodOptional<z$1.ZodObject<{
        version: z$1.ZodString;
        reasons: z$1.ZodArray<z$1.ZodString>;
    }, z$1.core.$strip>>;
    detail: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type PluginUpdateCheckEntry = z$1.infer<typeof pluginUpdateCheckEntrySchema>;
declare const pluginApplyUpdateResultSchema: z$1.ZodObject<{
    applied: z$1.ZodBoolean;
    from: z$1.ZodObject<{
        version: z$1.ZodString;
        display: z$1.ZodString;
    }, z$1.core.$strip>;
    to: z$1.ZodOptional<z$1.ZodObject<{
        version: z$1.ZodString;
        display: z$1.ZodString;
    }, z$1.core.$strip>>;
    outcome: z$1.ZodEnum<{
        current: "current";
        updated: "updated";
        "rolled-back": "rolled-back";
    }>;
    detail: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type PluginApplyUpdateResult$1 = z$1.infer<typeof pluginApplyUpdateResultSchema>;
declare const pluginSourceDetailSchema: z$1.ZodObject<{
    requested: z$1.ZodString;
    resolved: z$1.ZodString;
    integrity: z$1.ZodOptional<z$1.ZodString>;
    registry: z$1.ZodOptional<z$1.ZodString>;
    engines: z$1.ZodObject<{
        patcher: z$1.ZodOptional<z$1.ZodString>;
        patcherPluginSdk: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>;
    installedAt: z$1.ZodOptional<z$1.ZodNumber>;
    history: z$1.ZodArray<z$1.ZodObject<{
        version: z$1.ZodString;
        activatedAt: z$1.ZodNumber;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type PluginSourceDetail = z$1.infer<typeof pluginSourceDetailSchema>;
declare const installedPluginSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    source: z$1.ZodString;
    rootDir: z$1.ZodString;
    version: z$1.ZodString;
    provenance: z$1.ZodEnum<{
        builtin: "builtin";
        direct: "direct";
        catalog: "catalog";
    }>;
    isOrphanedBuiltin: z$1.ZodBoolean;
    catalogEntryId: z$1.ZodOptional<z$1.ZodString>;
    sourceDisplay: z$1.ZodString;
    updateState: z$1.ZodObject<{
        outcome: z$1.ZodOptional<z$1.ZodEnum<{
            unavailable: "unavailable";
            pinned: "pinned";
            incompatible: "incompatible";
            current: "current";
            "update-available": "update-available";
        }>>;
        availableVersion: z$1.ZodOptional<z$1.ZodString>;
        blockedVersion: z$1.ZodOptional<z$1.ZodString>;
        blockedReasons: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
        lastCheckAt: z$1.ZodOptional<z$1.ZodNumber>;
        lastFailure: z$1.ZodOptional<z$1.ZodObject<{
            version: z$1.ZodString;
            at: z$1.ZodNumber;
            detail: z$1.ZodString;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>;
    enabled: z$1.ZodBoolean;
    description: z$1.ZodNullable<z$1.ZodString>;
    name: z$1.ZodNullable<z$1.ZodString>;
    icon: z$1.ZodNullable<z$1.ZodString>;
    iconUrl: z$1.ZodNullable<z$1.ZodString>;
    status: z$1.ZodEnum<{
        error: "error";
        running: "running";
        missing: "missing";
        incompatible: "incompatible";
        disabled: "disabled";
        degraded: "degraded";
        "needs-configuration": "needs-configuration";
    }>;
    statusDetail: z$1.ZodNullable<z$1.ZodString>;
    placement: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodEnum<{
        server: "server";
        process: "process";
    }>>>;
    handlerStats: z$1.ZodObject<{
        count: z$1.ZodNumber;
        totalMs: z$1.ZodNumber;
        maxMs: z$1.ZodNumber;
        errorCount: z$1.ZodNumber;
    }, z$1.core.$strip>;
    services: z$1.ZodArray<z$1.ZodObject<{
        name: z$1.ZodString;
        state: z$1.ZodEnum<{
            running: "running";
            stopped: "stopped";
            backoff: "backoff";
        }>;
    }, z$1.core.$strip>>;
    schedules: z$1.ZodArray<z$1.ZodObject<{
        name: z$1.ZodString;
        cron: z$1.ZodString;
        nextRunAt: z$1.ZodNumber;
        lastRunAt: z$1.ZodNullable<z$1.ZodNumber>;
        lastStatus: z$1.ZodNullable<z$1.ZodEnum<{
            error: "error";
            running: "running";
            ok: "ok";
        }>>;
        lastError: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>>;
    cliCommand: z$1.ZodNullable<z$1.ZodObject<{
        name: z$1.ZodString;
        summary: z$1.ZodString;
    }, z$1.core.$strip>>;
    capabilities: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
        kind: z$1.ZodEnum<{
            skill: "skill";
            theme: "theme";
            "agent-tool": "agent-tool";
            "thread-integration": "thread-integration";
        }>;
        id: z$1.ZodString;
        label: z$1.ZodString;
        detail: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>>>;
    permissions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodEnum<{
        workspace: "workspace";
        "page.interact": "page.interact";
        "page.record": "page.record";
        threads: "threads";
        shell: "shell";
        history: "history";
        "tabs.read": "tabs.read";
        "page.read": "page.read";
        "network.observe": "network.observe";
        "tabs.modify": "tabs.modify";
        "page.inject": "page.inject";
        "network.intercept": "network.intercept";
        "page.credentials": "page.credentials";
        "omnibox.register": "omnibox.register";
        "contextMenu.register": "contextMenu.register";
        "tabMenu.register": "tabMenu.register";
        "find.register": "find.register";
        "siteInfo.register": "siteInfo.register";
        "toolbar.register": "toolbar.register";
        "newTab.register": "newTab.register";
        "pageStyle.register": "pageStyle.register";
        "pageScript.register": "pageScript.register";
        "searchEngine.register": "searchEngine.register";
        "downloads.handle": "downloads.handle";
        "auth.provide": "auth.provide";
        "externalLink.handle": "externalLink.handle";
        "pdf.provide": "pdf.provide";
        filesystem: "filesystem";
        plugins: "plugins";
    }>>>;
    sites: z$1.ZodDefault<z$1.ZodArray<z$1.ZodString>>;
    hasSettings: z$1.ZodBoolean;
    app: z$1.ZodObject<{
        hasApp: z$1.ZodBoolean;
        bundle: z$1.ZodNullable<z$1.ZodObject<{
            jsUrl: z$1.ZodString;
            cssUrl: z$1.ZodNullable<z$1.ZodString>;
            hash: z$1.ZodString;
            sdkMajor: z$1.ZodNumber;
            sdkVersion: z$1.ZodString;
            compatible: z$1.ZodBoolean;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>;
    logoUrl: z$1.ZodNullable<z$1.ZodString>;
    logoDarkUrl: z$1.ZodNullable<z$1.ZodString>;
}, z$1.core.$strip>;
type InstalledPlugin = z$1.infer<typeof installedPluginSchema>;
declare const pluginListResponseSchema: z$1.ZodObject<{
    plugins: z$1.ZodArray<z$1.ZodObject<{
        id: z$1.ZodString;
        source: z$1.ZodString;
        rootDir: z$1.ZodString;
        version: z$1.ZodString;
        provenance: z$1.ZodEnum<{
            builtin: "builtin";
            direct: "direct";
            catalog: "catalog";
        }>;
        isOrphanedBuiltin: z$1.ZodBoolean;
        catalogEntryId: z$1.ZodOptional<z$1.ZodString>;
        sourceDisplay: z$1.ZodString;
        updateState: z$1.ZodObject<{
            outcome: z$1.ZodOptional<z$1.ZodEnum<{
                unavailable: "unavailable";
                pinned: "pinned";
                incompatible: "incompatible";
                current: "current";
                "update-available": "update-available";
            }>>;
            availableVersion: z$1.ZodOptional<z$1.ZodString>;
            blockedVersion: z$1.ZodOptional<z$1.ZodString>;
            blockedReasons: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
            lastCheckAt: z$1.ZodOptional<z$1.ZodNumber>;
            lastFailure: z$1.ZodOptional<z$1.ZodObject<{
                version: z$1.ZodString;
                at: z$1.ZodNumber;
                detail: z$1.ZodString;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>;
        enabled: z$1.ZodBoolean;
        description: z$1.ZodNullable<z$1.ZodString>;
        name: z$1.ZodNullable<z$1.ZodString>;
        icon: z$1.ZodNullable<z$1.ZodString>;
        iconUrl: z$1.ZodNullable<z$1.ZodString>;
        status: z$1.ZodEnum<{
            error: "error";
            running: "running";
            missing: "missing";
            incompatible: "incompatible";
            disabled: "disabled";
            degraded: "degraded";
            "needs-configuration": "needs-configuration";
        }>;
        statusDetail: z$1.ZodNullable<z$1.ZodString>;
        placement: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodEnum<{
            server: "server";
            process: "process";
        }>>>;
        handlerStats: z$1.ZodObject<{
            count: z$1.ZodNumber;
            totalMs: z$1.ZodNumber;
            maxMs: z$1.ZodNumber;
            errorCount: z$1.ZodNumber;
        }, z$1.core.$strip>;
        services: z$1.ZodArray<z$1.ZodObject<{
            name: z$1.ZodString;
            state: z$1.ZodEnum<{
                running: "running";
                stopped: "stopped";
                backoff: "backoff";
            }>;
        }, z$1.core.$strip>>;
        schedules: z$1.ZodArray<z$1.ZodObject<{
            name: z$1.ZodString;
            cron: z$1.ZodString;
            nextRunAt: z$1.ZodNumber;
            lastRunAt: z$1.ZodNullable<z$1.ZodNumber>;
            lastStatus: z$1.ZodNullable<z$1.ZodEnum<{
                error: "error";
                running: "running";
                ok: "ok";
            }>>;
            lastError: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>>;
        cliCommand: z$1.ZodNullable<z$1.ZodObject<{
            name: z$1.ZodString;
            summary: z$1.ZodString;
        }, z$1.core.$strip>>;
        capabilities: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            kind: z$1.ZodEnum<{
                skill: "skill";
                theme: "theme";
                "agent-tool": "agent-tool";
                "thread-integration": "thread-integration";
            }>;
            id: z$1.ZodString;
            label: z$1.ZodString;
            detail: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>>>;
        permissions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodEnum<{
            workspace: "workspace";
            "page.interact": "page.interact";
            "page.record": "page.record";
            threads: "threads";
            shell: "shell";
            history: "history";
            "tabs.read": "tabs.read";
            "page.read": "page.read";
            "network.observe": "network.observe";
            "tabs.modify": "tabs.modify";
            "page.inject": "page.inject";
            "network.intercept": "network.intercept";
            "page.credentials": "page.credentials";
            "omnibox.register": "omnibox.register";
            "contextMenu.register": "contextMenu.register";
            "tabMenu.register": "tabMenu.register";
            "find.register": "find.register";
            "siteInfo.register": "siteInfo.register";
            "toolbar.register": "toolbar.register";
            "newTab.register": "newTab.register";
            "pageStyle.register": "pageStyle.register";
            "pageScript.register": "pageScript.register";
            "searchEngine.register": "searchEngine.register";
            "downloads.handle": "downloads.handle";
            "auth.provide": "auth.provide";
            "externalLink.handle": "externalLink.handle";
            "pdf.provide": "pdf.provide";
            filesystem: "filesystem";
            plugins: "plugins";
        }>>>;
        sites: z$1.ZodDefault<z$1.ZodArray<z$1.ZodString>>;
        hasSettings: z$1.ZodBoolean;
        app: z$1.ZodObject<{
            hasApp: z$1.ZodBoolean;
            bundle: z$1.ZodNullable<z$1.ZodObject<{
                jsUrl: z$1.ZodString;
                cssUrl: z$1.ZodNullable<z$1.ZodString>;
                hash: z$1.ZodString;
                sdkMajor: z$1.ZodNumber;
                sdkVersion: z$1.ZodString;
                compatible: z$1.ZodBoolean;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>;
        logoUrl: z$1.ZodNullable<z$1.ZodString>;
        logoDarkUrl: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type PluginListResponse = z$1.infer<typeof pluginListResponseSchema>;
declare const pluginReloadResponseSchema: z$1.ZodObject<{
    ok: z$1.ZodLiteral<true>;
    plugins: z$1.ZodArray<z$1.ZodObject<{
        id: z$1.ZodString;
        source: z$1.ZodString;
        rootDir: z$1.ZodString;
        version: z$1.ZodString;
        provenance: z$1.ZodEnum<{
            builtin: "builtin";
            direct: "direct";
            catalog: "catalog";
        }>;
        isOrphanedBuiltin: z$1.ZodBoolean;
        catalogEntryId: z$1.ZodOptional<z$1.ZodString>;
        sourceDisplay: z$1.ZodString;
        updateState: z$1.ZodObject<{
            outcome: z$1.ZodOptional<z$1.ZodEnum<{
                unavailable: "unavailable";
                pinned: "pinned";
                incompatible: "incompatible";
                current: "current";
                "update-available": "update-available";
            }>>;
            availableVersion: z$1.ZodOptional<z$1.ZodString>;
            blockedVersion: z$1.ZodOptional<z$1.ZodString>;
            blockedReasons: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
            lastCheckAt: z$1.ZodOptional<z$1.ZodNumber>;
            lastFailure: z$1.ZodOptional<z$1.ZodObject<{
                version: z$1.ZodString;
                at: z$1.ZodNumber;
                detail: z$1.ZodString;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>;
        enabled: z$1.ZodBoolean;
        description: z$1.ZodNullable<z$1.ZodString>;
        name: z$1.ZodNullable<z$1.ZodString>;
        icon: z$1.ZodNullable<z$1.ZodString>;
        iconUrl: z$1.ZodNullable<z$1.ZodString>;
        status: z$1.ZodEnum<{
            error: "error";
            running: "running";
            missing: "missing";
            incompatible: "incompatible";
            disabled: "disabled";
            degraded: "degraded";
            "needs-configuration": "needs-configuration";
        }>;
        statusDetail: z$1.ZodNullable<z$1.ZodString>;
        placement: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodEnum<{
            server: "server";
            process: "process";
        }>>>;
        handlerStats: z$1.ZodObject<{
            count: z$1.ZodNumber;
            totalMs: z$1.ZodNumber;
            maxMs: z$1.ZodNumber;
            errorCount: z$1.ZodNumber;
        }, z$1.core.$strip>;
        services: z$1.ZodArray<z$1.ZodObject<{
            name: z$1.ZodString;
            state: z$1.ZodEnum<{
                running: "running";
                stopped: "stopped";
                backoff: "backoff";
            }>;
        }, z$1.core.$strip>>;
        schedules: z$1.ZodArray<z$1.ZodObject<{
            name: z$1.ZodString;
            cron: z$1.ZodString;
            nextRunAt: z$1.ZodNumber;
            lastRunAt: z$1.ZodNullable<z$1.ZodNumber>;
            lastStatus: z$1.ZodNullable<z$1.ZodEnum<{
                error: "error";
                running: "running";
                ok: "ok";
            }>>;
            lastError: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>>;
        cliCommand: z$1.ZodNullable<z$1.ZodObject<{
            name: z$1.ZodString;
            summary: z$1.ZodString;
        }, z$1.core.$strip>>;
        capabilities: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            kind: z$1.ZodEnum<{
                skill: "skill";
                theme: "theme";
                "agent-tool": "agent-tool";
                "thread-integration": "thread-integration";
            }>;
            id: z$1.ZodString;
            label: z$1.ZodString;
            detail: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>>>;
        permissions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodEnum<{
            workspace: "workspace";
            "page.interact": "page.interact";
            "page.record": "page.record";
            threads: "threads";
            shell: "shell";
            history: "history";
            "tabs.read": "tabs.read";
            "page.read": "page.read";
            "network.observe": "network.observe";
            "tabs.modify": "tabs.modify";
            "page.inject": "page.inject";
            "network.intercept": "network.intercept";
            "page.credentials": "page.credentials";
            "omnibox.register": "omnibox.register";
            "contextMenu.register": "contextMenu.register";
            "tabMenu.register": "tabMenu.register";
            "find.register": "find.register";
            "siteInfo.register": "siteInfo.register";
            "toolbar.register": "toolbar.register";
            "newTab.register": "newTab.register";
            "pageStyle.register": "pageStyle.register";
            "pageScript.register": "pageScript.register";
            "searchEngine.register": "searchEngine.register";
            "downloads.handle": "downloads.handle";
            "auth.provide": "auth.provide";
            "externalLink.handle": "externalLink.handle";
            "pdf.provide": "pdf.provide";
            filesystem: "filesystem";
            plugins: "plugins";
        }>>>;
        sites: z$1.ZodDefault<z$1.ZodArray<z$1.ZodString>>;
        hasSettings: z$1.ZodBoolean;
        app: z$1.ZodObject<{
            hasApp: z$1.ZodBoolean;
            bundle: z$1.ZodNullable<z$1.ZodObject<{
                jsUrl: z$1.ZodString;
                cssUrl: z$1.ZodNullable<z$1.ZodString>;
                hash: z$1.ZodString;
                sdkMajor: z$1.ZodNumber;
                sdkVersion: z$1.ZodString;
                compatible: z$1.ZodBoolean;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>;
        logoUrl: z$1.ZodNullable<z$1.ZodString>;
        logoDarkUrl: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type PluginReloadResponse = z$1.infer<typeof pluginReloadResponseSchema>;
declare const pluginRemoveResponseSchema: z$1.ZodObject<{
    ok: z$1.ZodLiteral<true>;
}, z$1.core.$strip>;
type PluginRemoveResponse = z$1.infer<typeof pluginRemoveResponseSchema>;
declare const pluginSettingsResponseSchema: z$1.ZodObject<{
    ok: z$1.ZodLiteral<true>;
    schema: z$1.ZodRecord<z$1.ZodString, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        type: z$1.ZodLiteral<"string">;
        secret: z$1.ZodOptional<z$1.ZodLiteral<true>>;
        default: z$1.ZodOptional<z$1.ZodString>;
        label: z$1.ZodString;
        description: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"boolean">;
        default: z$1.ZodOptional<z$1.ZodBoolean>;
        label: z$1.ZodString;
        description: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"select">;
        options: z$1.ZodArray<z$1.ZodString>;
        default: z$1.ZodOptional<z$1.ZodString>;
        label: z$1.ZodString;
        description: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"project">;
        default: z$1.ZodOptional<z$1.ZodString>;
        label: z$1.ZodString;
        description: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strict>], "type">>;
    values: z$1.ZodRecord<z$1.ZodString, z$1.ZodType<JsonValue$1, unknown, z$1.core.$ZodTypeInternals<JsonValue$1, unknown>>>;
}, z$1.core.$strip>;
type PluginSettingsResponse = z$1.infer<typeof pluginSettingsResponseSchema>;
declare const pluginTokenResponseSchema: z$1.ZodObject<{
    ok: z$1.ZodLiteral<true>;
    token: z$1.ZodString;
}, z$1.core.$strip>;
type PluginTokenResponse = z$1.infer<typeof pluginTokenResponseSchema>;
declare const pluginCatalogStatusSchema: z$1.ZodObject<{
    pluginCount: z$1.ZodNumber;
    includedPluginCount: z$1.ZodNumber;
    optionalPluginCount: z$1.ZodNumber;
}, z$1.core.$strip>;
type PluginCatalogStatus = z$1.infer<typeof pluginCatalogStatusSchema>;
declare const pluginCatalogSearchResultSchema: z$1.ZodObject<{
    entryId: z$1.ZodString;
    pluginId: z$1.ZodString;
    displayName: z$1.ZodString;
    description: z$1.ZodString;
    icon: z$1.ZodNullable<z$1.ZodString>;
    category: z$1.ZodString;
    source: z$1.ZodString;
    installed: z$1.ZodBoolean;
    compatible: z$1.ZodBoolean;
    incompatibleReason: z$1.ZodNullable<z$1.ZodString>;
}, z$1.core.$strip>;
type PluginCatalogSearchResult$1 = z$1.infer<typeof pluginCatalogSearchResultSchema>;

declare const systemExecutionOptionsResponseSchema: z$1.ZodObject<{
    providers: z$1.ZodArray<z$1.ZodObject<{
        id: z$1.ZodString;
        displayName: z$1.ZodString;
        logoUrl: z$1.ZodNullable<z$1.ZodString>;
        capabilities: z$1.ZodObject<{
            supportsArchive: z$1.ZodBoolean;
            supportsRename: z$1.ZodBoolean;
            supportsServiceTier: z$1.ZodBoolean;
            supportsUserQuestion: z$1.ZodBoolean;
            supportsFork: z$1.ZodBoolean;
            supportedPermissionModes: z$1.ZodArray<z$1.ZodEnum<{
                auto: "auto";
                "accept-edits": "accept-edits";
                full: "full";
            }>>;
        }, z$1.core.$strip>;
        composerActions: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"skills">;
            trigger: z$1.ZodEnum<{
                "/": "/";
            }>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"plan">;
            command: z$1.ZodObject<{
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
                name: z$1.ZodString;
                trailingText: z$1.ZodString;
            }, z$1.core.$strip>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"goal">;
            command: z$1.ZodObject<{
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
                name: z$1.ZodString;
                trailingText: z$1.ZodString;
            }, z$1.core.$strip>;
        }, z$1.core.$strip>], "kind">>;
        available: z$1.ZodBoolean;
    }, z$1.core.$strip>>;
    permissionCeiling: z$1.ZodEnum<{
        auto: "auto";
        "accept-edits": "accept-edits";
        full: "full";
    }>;
    models: z$1.ZodArray<z$1.ZodObject<{
        id: z$1.ZodString;
        model: z$1.ZodString;
        displayName: z$1.ZodString;
        routeProviderId: z$1.ZodOptional<z$1.ZodString>;
        description: z$1.ZodString;
        supportedReasoningEfforts: z$1.ZodArray<z$1.ZodObject<{
            reasoningEffort: z$1.ZodEnum<{
                none: "none";
                low: "low";
                medium: "medium";
                high: "high";
                xhigh: "xhigh";
                ultracode: "ultracode";
                max: "max";
                ultra: "ultra";
            }>;
            description: z$1.ZodString;
        }, z$1.core.$strip>>;
        defaultReasoningEffort: z$1.ZodEnum<{
            none: "none";
            low: "low";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            ultracode: "ultracode";
            max: "max";
            ultra: "ultra";
        }>;
        isDefault: z$1.ZodBoolean;
    }, z$1.core.$strip>>;
    selectedOnlyModels: z$1.ZodArray<z$1.ZodObject<{
        id: z$1.ZodString;
        model: z$1.ZodString;
        displayName: z$1.ZodString;
        routeProviderId: z$1.ZodOptional<z$1.ZodString>;
        description: z$1.ZodString;
        supportedReasoningEfforts: z$1.ZodArray<z$1.ZodObject<{
            reasoningEffort: z$1.ZodEnum<{
                none: "none";
                low: "low";
                medium: "medium";
                high: "high";
                xhigh: "xhigh";
                ultracode: "ultracode";
                max: "max";
                ultra: "ultra";
            }>;
            description: z$1.ZodString;
        }, z$1.core.$strip>>;
        defaultReasoningEffort: z$1.ZodEnum<{
            none: "none";
            low: "low";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            ultracode: "ultracode";
            max: "max";
            ultra: "ultra";
        }>;
        isDefault: z$1.ZodBoolean;
    }, z$1.core.$strip>>;
    modelLoadError: z$1.ZodNullable<z$1.ZodObject<{
        providerId: z$1.ZodString;
        code: z$1.ZodEnum<{
            failed: "failed";
            missing_executable: "missing_executable";
            auth_required: "auth_required";
            timeout: "timeout";
        }>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type SystemExecutionOptionsResponse = z$1.infer<typeof systemExecutionOptionsResponseSchema>;
/**
 * Routes provider discovery through an environment's host or an explicit
 * host. Omitting both preserves the primary-host fallback.
 */
declare const systemProvidersQuerySchema: z$1.ZodObject<{
    hostId: z$1.ZodOptional<z$1.ZodString>;
    environmentId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type SystemProvidersQuery = z$1.infer<typeof systemProvidersQuerySchema>;
declare const systemExecutionOptionsQuerySchema: z$1.ZodObject<{
    providerId: z$1.ZodOptional<z$1.ZodString>;
    hostId: z$1.ZodOptional<z$1.ZodString>;
    environmentId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type SystemExecutionOptionsQuery = z$1.infer<typeof systemExecutionOptionsQuerySchema>;
/** Omission preserves the existing behavior of reading the primary machine. */
declare const systemUsageLimitsQuerySchema: z$1.ZodObject<{
    hostId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type SystemUsageLimitsQuery = z$1.infer<typeof systemUsageLimitsQuerySchema>;
declare const systemVoiceTranscriptionResponseSchema: z$1.ZodObject<{
    text: z$1.ZodString;
}, z$1.core.$strip>;
type SystemVoiceTranscriptionResponse = z$1.infer<typeof systemVoiceTranscriptionResponseSchema>;
declare const onboardingAgentOverviewSchema: z$1.ZodObject<{
    agents: z$1.ZodArray<z$1.ZodObject<{
        providerId: z$1.ZodString;
        displayName: z$1.ZodString;
        status: z$1.ZodEnum<{
            connected: "connected";
            unauthenticated: "unauthenticated";
            expired: "expired";
            not_installed: "not_installed";
        }>;
        planLabel: z$1.ZodNullable<z$1.ZodString>;
        accountEmail: z$1.ZodNullable<z$1.ZodString>;
        canInstall: z$1.ZodBoolean;
        loginCommand: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type OnboardingAgentOverview = z$1.infer<typeof onboardingAgentOverviewSchema>;
/** Omission reads the primary machine, matching the usage-limits route. */
declare const systemOnboardingReposQuerySchema: z$1.ZodObject<{
    hostId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type SystemOnboardingReposQuery = z$1.infer<typeof systemOnboardingReposQuerySchema>;
/**
 * Onboarding funnel events, reported by the app and forwarded to the server's
 * anonymous telemetry. Categorical or counts only — never paths, project names,
 * or account emails.
 */
declare const onboardingTelemetryEventSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    name: z$1.ZodLiteral<"onboarding_started">;
    agentState: z$1.ZodEnum<{
        connected: "connected";
        none: "none";
        signed_out: "signed_out";
    }>;
    detectedAgentCount: z$1.ZodNumber;
}, z$1.core.$strip>, z$1.ZodObject<{
    name: z$1.ZodLiteral<"onboarding_step_completed">;
    step: z$1.ZodEnum<{
        agents: "agents";
        projects: "projects";
    }>;
}, z$1.core.$strip>, z$1.ZodObject<{
    name: z$1.ZodLiteral<"onboarding_step_skipped">;
    step: z$1.ZodEnum<{
        agents: "agents";
        projects: "projects";
    }>;
}, z$1.core.$strip>, z$1.ZodObject<{
    name: z$1.ZodLiteral<"onboarding_completed">;
    agentState: z$1.ZodEnum<{
        connected: "connected";
        none: "none";
        signed_out: "signed_out";
    }>;
    projectsAdded: z$1.ZodNumber;
    durationMs: z$1.ZodNumber;
}, z$1.core.$strip>, z$1.ZodObject<{
    name: z$1.ZodLiteral<"onboarding_dismissed">;
    step: z$1.ZodEnum<{
        agents: "agents";
        projects: "projects";
    }>;
}, z$1.core.$strip>], "name">;
type OnboardingTelemetryEvent = z$1.infer<typeof onboardingTelemetryEventSchema>;
declare const systemConfigResponseSchema: z$1.ZodObject<{
    generalSettings: z$1.ZodObject<{
        caffeinate: z$1.ZodBoolean;
        showKeyboardHints: z$1.ZodBoolean;
        steerActiveThreadOnEnter: z$1.ZodBoolean;
        showUnhandledProviderEvents: z$1.ZodBoolean;
        codexMemoryEnabled: z$1.ZodBoolean;
        claudeCodeMemoryEnabled: z$1.ZodBoolean;
        codexSubagentsDisabled: z$1.ZodBoolean;
        claudeCodeSubagentsDisabled: z$1.ZodBoolean;
        claudeCodeWorkflowsDisabled: z$1.ZodBoolean;
        codexNetworkDisabled: z$1.ZodBoolean;
        onboardingCompletedAt: z$1.ZodNullable<z$1.ZodString>;
        browserSearchEngineId: z$1.ZodString;
    }, z$1.core.$strict>;
    keybindings: z$1.ZodArray<z$1.ZodObject<{
        command: z$1.ZodEnum<{
            "thread.new": "thread.new";
            "thread.search": "thread.search";
            "thread.rename": "thread.rename";
            "thread.archive": "thread.archive";
            "thread.previous": "thread.previous";
            "thread.next": "thread.next";
            "thread.jump.1": "thread.jump.1";
            "thread.jump.2": "thread.jump.2";
            "thread.jump.3": "thread.jump.3";
            "thread.jump.4": "thread.jump.4";
            "thread.jump.5": "thread.jump.5";
            "thread.jump.6": "thread.jump.6";
            "thread.jump.7": "thread.jump.7";
            "thread.jump.8": "thread.jump.8";
            "thread.jump.9": "thread.jump.9";
            "pane.focus.previous": "pane.focus.previous";
            "pane.focus.next": "pane.focus.next";
            "pane.focus.1": "pane.focus.1";
            "pane.focus.2": "pane.focus.2";
            "pane.focus.3": "pane.focus.3";
            "pane.focus.4": "pane.focus.4";
            "pane.focus.5": "pane.focus.5";
            "pane.focus.6": "pane.focus.6";
            "pane.focus.7": "pane.focus.7";
            "pane.focus.8": "pane.focus.8";
            "pane.maximize.toggle": "pane.maximize.toggle";
            "pane.close": "pane.close";
            "window.new": "window.new";
            "settings.open": "settings.open";
            "settings.openServers": "settings.openServers";
            "sidebar.toggle": "sidebar.toggle";
            "panel.newTab": "panel.newTab";
            "panel.close": "panel.close";
            "panel.toggle": "panel.toggle";
            "diff.toggle": "diff.toggle";
            "terminal.open": "terminal.open";
            "composer.focus": "composer.focus";
            "modelPicker.toggle": "modelPicker.toggle";
            "modelPicker.cycleModel": "modelPicker.cycleModel";
            "modelPicker.cycleReasoning": "modelPicker.cycleReasoning";
            "browser.focusLocation": "browser.focusLocation";
            "browser.reload": "browser.reload";
            "browser.find": "browser.find";
            "browser.fullscreen.toggle": "browser.fullscreen.toggle";
            "browser.devTools.toggle": "browser.devTools.toggle";
            "browser.newTab": "browser.newTab";
            "browser.closeTab": "browser.closeTab";
            "browser.reopenClosedTab": "browser.reopenClosedTab";
            "browser.selectTab.1": "browser.selectTab.1";
            "browser.selectTab.2": "browser.selectTab.2";
            "browser.selectTab.3": "browser.selectTab.3";
            "browser.selectTab.4": "browser.selectTab.4";
            "browser.selectTab.5": "browser.selectTab.5";
            "browser.selectTab.6": "browser.selectTab.6";
            "browser.selectTab.7": "browser.selectTab.7";
            "browser.selectTab.8": "browser.selectTab.8";
            "browser.selectLastTab": "browser.selectLastTab";
            "browser.recentTab.next": "browser.recentTab.next";
            "browser.recentTab.previous": "browser.recentTab.previous";
            "browser.goBack": "browser.goBack";
            "browser.goForward": "browser.goForward";
            "browser.zoomIn": "browser.zoomIn";
            "browser.zoomOut": "browser.zoomOut";
            "browser.zoomReset": "browser.zoomReset";
            "browser.print": "browser.print";
            "workspace.openPreferred": "workspace.openPreferred";
            "question.select.1": "question.select.1";
            "question.select.2": "question.select.2";
            "question.select.3": "question.select.3";
            "question.select.4": "question.select.4";
            "question.select.5": "question.select.5";
            "question.select.6": "question.select.6";
            "question.select.7": "question.select.7";
            "question.select.8": "question.select.8";
            "question.select.9": "question.select.9";
        }>;
        desktopOnly: z$1.ZodBoolean;
        shortcut: z$1.ZodObject<{
            key: z$1.ZodString;
            mod: z$1.ZodBoolean;
            meta: z$1.ZodBoolean;
            control: z$1.ZodBoolean;
            alt: z$1.ZodBoolean;
            shift: z$1.ZodBoolean;
        }, z$1.core.$strict>;
        when: z$1.ZodObject<{
            all: z$1.ZodArray<z$1.ZodEnum<{
                mainSurface: "mainSurface";
                modalOpen: "modalOpen";
                editableFocus: "editableFocus";
                terminalFocus: "terminalFocus";
                browserFocus: "browserFocus";
                modelPickerOpen: "modelPickerOpen";
                questionOpen: "questionOpen";
                promptAvailable: "promptAvailable";
                splitActive: "splitActive";
                webSurface: "webSurface";
                macPlatform: "macPlatform";
            }>>;
            none: z$1.ZodArray<z$1.ZodEnum<{
                mainSurface: "mainSurface";
                modalOpen: "modalOpen";
                editableFocus: "editableFocus";
                terminalFocus: "terminalFocus";
                browserFocus: "browserFocus";
                modelPickerOpen: "modelPickerOpen";
                questionOpen: "questionOpen";
                promptAvailable: "promptAvailable";
                splitActive: "splitActive";
                webSurface: "webSurface";
                macPlatform: "macPlatform";
            }>>;
        }, z$1.core.$strict>;
    }, z$1.core.$strict>>;
    defaultKeybindings: z$1.ZodArray<z$1.ZodObject<{
        command: z$1.ZodEnum<{
            "thread.new": "thread.new";
            "thread.search": "thread.search";
            "thread.rename": "thread.rename";
            "thread.archive": "thread.archive";
            "thread.previous": "thread.previous";
            "thread.next": "thread.next";
            "thread.jump.1": "thread.jump.1";
            "thread.jump.2": "thread.jump.2";
            "thread.jump.3": "thread.jump.3";
            "thread.jump.4": "thread.jump.4";
            "thread.jump.5": "thread.jump.5";
            "thread.jump.6": "thread.jump.6";
            "thread.jump.7": "thread.jump.7";
            "thread.jump.8": "thread.jump.8";
            "thread.jump.9": "thread.jump.9";
            "pane.focus.previous": "pane.focus.previous";
            "pane.focus.next": "pane.focus.next";
            "pane.focus.1": "pane.focus.1";
            "pane.focus.2": "pane.focus.2";
            "pane.focus.3": "pane.focus.3";
            "pane.focus.4": "pane.focus.4";
            "pane.focus.5": "pane.focus.5";
            "pane.focus.6": "pane.focus.6";
            "pane.focus.7": "pane.focus.7";
            "pane.focus.8": "pane.focus.8";
            "pane.maximize.toggle": "pane.maximize.toggle";
            "pane.close": "pane.close";
            "window.new": "window.new";
            "settings.open": "settings.open";
            "settings.openServers": "settings.openServers";
            "sidebar.toggle": "sidebar.toggle";
            "panel.newTab": "panel.newTab";
            "panel.close": "panel.close";
            "panel.toggle": "panel.toggle";
            "diff.toggle": "diff.toggle";
            "terminal.open": "terminal.open";
            "composer.focus": "composer.focus";
            "modelPicker.toggle": "modelPicker.toggle";
            "modelPicker.cycleModel": "modelPicker.cycleModel";
            "modelPicker.cycleReasoning": "modelPicker.cycleReasoning";
            "browser.focusLocation": "browser.focusLocation";
            "browser.reload": "browser.reload";
            "browser.find": "browser.find";
            "browser.fullscreen.toggle": "browser.fullscreen.toggle";
            "browser.devTools.toggle": "browser.devTools.toggle";
            "browser.newTab": "browser.newTab";
            "browser.closeTab": "browser.closeTab";
            "browser.reopenClosedTab": "browser.reopenClosedTab";
            "browser.selectTab.1": "browser.selectTab.1";
            "browser.selectTab.2": "browser.selectTab.2";
            "browser.selectTab.3": "browser.selectTab.3";
            "browser.selectTab.4": "browser.selectTab.4";
            "browser.selectTab.5": "browser.selectTab.5";
            "browser.selectTab.6": "browser.selectTab.6";
            "browser.selectTab.7": "browser.selectTab.7";
            "browser.selectTab.8": "browser.selectTab.8";
            "browser.selectLastTab": "browser.selectLastTab";
            "browser.recentTab.next": "browser.recentTab.next";
            "browser.recentTab.previous": "browser.recentTab.previous";
            "browser.goBack": "browser.goBack";
            "browser.goForward": "browser.goForward";
            "browser.zoomIn": "browser.zoomIn";
            "browser.zoomOut": "browser.zoomOut";
            "browser.zoomReset": "browser.zoomReset";
            "browser.print": "browser.print";
            "workspace.openPreferred": "workspace.openPreferred";
            "question.select.1": "question.select.1";
            "question.select.2": "question.select.2";
            "question.select.3": "question.select.3";
            "question.select.4": "question.select.4";
            "question.select.5": "question.select.5";
            "question.select.6": "question.select.6";
            "question.select.7": "question.select.7";
            "question.select.8": "question.select.8";
            "question.select.9": "question.select.9";
        }>;
        desktopOnly: z$1.ZodBoolean;
        when: z$1.ZodObject<{
            all: z$1.ZodArray<z$1.ZodEnum<{
                mainSurface: "mainSurface";
                modalOpen: "modalOpen";
                editableFocus: "editableFocus";
                terminalFocus: "terminalFocus";
                browserFocus: "browserFocus";
                modelPickerOpen: "modelPickerOpen";
                questionOpen: "questionOpen";
                promptAvailable: "promptAvailable";
                splitActive: "splitActive";
                webSurface: "webSurface";
                macPlatform: "macPlatform";
            }>>;
            none: z$1.ZodArray<z$1.ZodEnum<{
                mainSurface: "mainSurface";
                modalOpen: "modalOpen";
                editableFocus: "editableFocus";
                terminalFocus: "terminalFocus";
                browserFocus: "browserFocus";
                modelPickerOpen: "modelPickerOpen";
                questionOpen: "questionOpen";
                promptAvailable: "promptAvailable";
                splitActive: "splitActive";
                webSurface: "webSurface";
                macPlatform: "macPlatform";
            }>>;
        }, z$1.core.$strict>;
        shortcut: z$1.ZodNullable<z$1.ZodObject<{
            key: z$1.ZodString;
            mod: z$1.ZodBoolean;
            meta: z$1.ZodBoolean;
            control: z$1.ZodBoolean;
            alt: z$1.ZodBoolean;
            shift: z$1.ZodBoolean;
        }, z$1.core.$strict>>;
    }, z$1.core.$strict>>;
    keybindingOverrides: z$1.ZodArray<z$1.ZodObject<{
        command: z$1.ZodEnum<{
            "thread.new": "thread.new";
            "thread.search": "thread.search";
            "thread.rename": "thread.rename";
            "thread.archive": "thread.archive";
            "thread.previous": "thread.previous";
            "thread.next": "thread.next";
            "thread.jump.1": "thread.jump.1";
            "thread.jump.2": "thread.jump.2";
            "thread.jump.3": "thread.jump.3";
            "thread.jump.4": "thread.jump.4";
            "thread.jump.5": "thread.jump.5";
            "thread.jump.6": "thread.jump.6";
            "thread.jump.7": "thread.jump.7";
            "thread.jump.8": "thread.jump.8";
            "thread.jump.9": "thread.jump.9";
            "pane.focus.previous": "pane.focus.previous";
            "pane.focus.next": "pane.focus.next";
            "pane.focus.1": "pane.focus.1";
            "pane.focus.2": "pane.focus.2";
            "pane.focus.3": "pane.focus.3";
            "pane.focus.4": "pane.focus.4";
            "pane.focus.5": "pane.focus.5";
            "pane.focus.6": "pane.focus.6";
            "pane.focus.7": "pane.focus.7";
            "pane.focus.8": "pane.focus.8";
            "pane.maximize.toggle": "pane.maximize.toggle";
            "pane.close": "pane.close";
            "window.new": "window.new";
            "settings.open": "settings.open";
            "settings.openServers": "settings.openServers";
            "sidebar.toggle": "sidebar.toggle";
            "panel.newTab": "panel.newTab";
            "panel.close": "panel.close";
            "panel.toggle": "panel.toggle";
            "diff.toggle": "diff.toggle";
            "terminal.open": "terminal.open";
            "composer.focus": "composer.focus";
            "modelPicker.toggle": "modelPicker.toggle";
            "modelPicker.cycleModel": "modelPicker.cycleModel";
            "modelPicker.cycleReasoning": "modelPicker.cycleReasoning";
            "browser.focusLocation": "browser.focusLocation";
            "browser.reload": "browser.reload";
            "browser.find": "browser.find";
            "browser.fullscreen.toggle": "browser.fullscreen.toggle";
            "browser.devTools.toggle": "browser.devTools.toggle";
            "browser.newTab": "browser.newTab";
            "browser.closeTab": "browser.closeTab";
            "browser.reopenClosedTab": "browser.reopenClosedTab";
            "browser.selectTab.1": "browser.selectTab.1";
            "browser.selectTab.2": "browser.selectTab.2";
            "browser.selectTab.3": "browser.selectTab.3";
            "browser.selectTab.4": "browser.selectTab.4";
            "browser.selectTab.5": "browser.selectTab.5";
            "browser.selectTab.6": "browser.selectTab.6";
            "browser.selectTab.7": "browser.selectTab.7";
            "browser.selectTab.8": "browser.selectTab.8";
            "browser.selectLastTab": "browser.selectLastTab";
            "browser.recentTab.next": "browser.recentTab.next";
            "browser.recentTab.previous": "browser.recentTab.previous";
            "browser.goBack": "browser.goBack";
            "browser.goForward": "browser.goForward";
            "browser.zoomIn": "browser.zoomIn";
            "browser.zoomOut": "browser.zoomOut";
            "browser.zoomReset": "browser.zoomReset";
            "browser.print": "browser.print";
            "workspace.openPreferred": "workspace.openPreferred";
            "question.select.1": "question.select.1";
            "question.select.2": "question.select.2";
            "question.select.3": "question.select.3";
            "question.select.4": "question.select.4";
            "question.select.5": "question.select.5";
            "question.select.6": "question.select.6";
            "question.select.7": "question.select.7";
            "question.select.8": "question.select.8";
            "question.select.9": "question.select.9";
        }>;
        shortcut: z$1.ZodNullable<z$1.ZodObject<{
            key: z$1.ZodString;
            mod: z$1.ZodBoolean;
            meta: z$1.ZodBoolean;
            control: z$1.ZodBoolean;
            alt: z$1.ZodBoolean;
            shift: z$1.ZodBoolean;
        }, z$1.core.$strict>>;
    }, z$1.core.$strict>>;
    experiments: z$1.ZodRecord<z$1.ZodEnum<{
        claudeCodeMockCliTraffic: "claudeCodeMockCliTraffic";
        editMessages: "editMessages";
        newOnboarding: "newOnboarding";
        toolsHub: "toolsHub";
    }>, z$1.ZodBoolean>;
    appearance: z$1.ZodObject<{
        themeId: z$1.ZodString;
        customCss: z$1.ZodNullable<z$1.ZodString>;
        faviconColor: z$1.ZodEnum<{
            default: "default";
            red: "red";
            orange: "orange";
            yellow: "yellow";
            green: "green";
            teal: "teal";
            blue: "blue";
            purple: "purple";
            pink: "pink";
        }>;
    }, z$1.core.$strip>;
    customThemes: z$1.ZodArray<z$1.ZodString>;
    pluginThemes: z$1.ZodArray<z$1.ZodObject<{
        id: z$1.ZodString;
        pluginId: z$1.ZodString;
        name: z$1.ZodString;
        description: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>>;
    featureFlags: z$1.ZodObject<{
        placeholder: z$1.ZodBoolean;
        timelineWindowEventBudget: z$1.ZodNumber;
    }, z$1.core.$strip>;
    hostDaemonPort: z$1.ZodNullable<z$1.ZodNumber>;
    serverUrl: z$1.ZodString;
    primaryHostId: z$1.ZodNullable<z$1.ZodString>;
    primaryHostPlatform: z$1.ZodNullable<z$1.ZodEnum<{
        unknown: "unknown";
        darwin: "darwin";
        linux: "linux";
        wsl: "wsl";
    }>>;
    voiceTranscriptionEnabled: z$1.ZodBoolean;
    dataDir: z$1.ZodString;
}, z$1.core.$strip>;
type SystemConfigResponse = z$1.infer<typeof systemConfigResponseSchema>;
declare const systemAttentionResponseSchema: z$1.ZodObject<{
    hasAttention: z$1.ZodBoolean;
}, z$1.core.$strip>;
type SystemAttentionResponse = z$1.infer<typeof systemAttentionResponseSchema>;
/**
 * Theme catalog: the on-disk custom-theme directory plus the discovered custom
 * themes and the active palette. Drives `patcher theme list` / `patcher theme dir`.
 */
declare const themeCatalogResponseSchema: z$1.ZodObject<{
    dir: z$1.ZodString;
    custom: z$1.ZodArray<z$1.ZodString>;
    plugins: z$1.ZodArray<z$1.ZodObject<{
        id: z$1.ZodString;
        pluginId: z$1.ZodString;
        name: z$1.ZodString;
        description: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>>;
    active: z$1.ZodObject<{
        themeId: z$1.ZodString;
        customCss: z$1.ZodNullable<z$1.ZodString>;
        faviconColor: z$1.ZodEnum<{
            default: "default";
            red: "red";
            orange: "orange";
            yellow: "yellow";
            green: "green";
            teal: "teal";
            blue: "blue";
            purple: "purple";
            pink: "pink";
        }>;
    }, z$1.core.$strip>;
}, z$1.core.$strip>;
type ThemeCatalogResponse = z$1.infer<typeof themeCatalogResponseSchema>;
declare const systemVersionResponseSchema: z$1.ZodObject<{
    currentVersion: z$1.ZodString;
    latestVersion: z$1.ZodNullable<z$1.ZodString>;
    source: z$1.ZodLiteral<"npm">;
    updateAvailable: z$1.ZodBoolean;
    isDevelopment: z$1.ZodBoolean;
    upgradeCommand: z$1.ZodString;
}, z$1.core.$strip>;
type SystemVersionResponse = z$1.infer<typeof systemVersionResponseSchema>;
declare const systemConfigReloadResponseSchema: z$1.ZodObject<{
    ok: z$1.ZodLiteral<true>;
}, z$1.core.$strip>;
declare const systemCliSkillsStatusResponseSchema: z$1.ZodObject<{
    machines: z$1.ZodArray<z$1.ZodObject<{
        hostId: z$1.ZodString;
        hostName: z$1.ZodString;
        status: z$1.ZodEnum<{
            unknown: "unknown";
            missing: "missing";
            installed: "installed";
            outdated: "outdated";
        }>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type SystemCliSkillsStatusResponse = z$1.infer<typeof systemCliSkillsStatusResponseSchema>;
/** The machines to copy the built-in Patcher CLI skills onto. */
declare const systemInstallCliSkillsRequestSchema: z$1.ZodObject<{
    hostIds: z$1.ZodArray<z$1.ZodString>;
}, z$1.core.$strip>;
type SystemInstallCliSkillsRequest = z$1.infer<typeof systemInstallCliSkillsRequestSchema>;
/**
 * One entry per requested machine. A machine that is offline or otherwise
 * refuses the install fails on its own without taking the others down, so the
 * caller can report exactly which machines got the skills.
 */
declare const systemInstallCliSkillsResponseSchema: z$1.ZodObject<{
    results: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        ok: z$1.ZodLiteral<true>;
        hostId: z$1.ZodString;
        hostName: z$1.ZodString;
        installations: z$1.ZodArray<z$1.ZodObject<{
            name: z$1.ZodString;
            path: z$1.ZodString;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        ok: z$1.ZodLiteral<false>;
        hostId: z$1.ZodString;
        hostName: z$1.ZodString;
        errorMessage: z$1.ZodString;
    }, z$1.core.$strip>], "ok">>;
}, z$1.core.$strip>;
type SystemInstallCliSkillsResponse = z$1.infer<typeof systemInstallCliSkillsResponseSchema>;
type SystemConfigReloadResponse = z$1.infer<typeof systemConfigReloadResponseSchema>;

declare const terminalSessionSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodNullable<z$1.ZodString>;
    environmentId: z$1.ZodNullable<z$1.ZodString>;
    hostId: z$1.ZodString;
    title: z$1.ZodString;
    initialCwd: z$1.ZodString;
    cols: z$1.ZodNumber;
    rows: z$1.ZodNumber;
    status: z$1.ZodEnum<{
        starting: "starting";
        disconnected: "disconnected";
        running: "running";
        exited: "exited";
    }>;
    sandboxed: z$1.ZodBoolean;
    exitCode: z$1.ZodNullable<z$1.ZodNumber>;
    closeReason: z$1.ZodNullable<z$1.ZodEnum<{
        user: "user";
        "thread-deleted": "thread-deleted";
        "process-exit": "process-exit";
        "daemon-disconnect": "daemon-disconnect";
        "environment-destroyed": "environment-destroyed";
        "thread-archived": "thread-archived";
        "open-timeout": "open-timeout";
    }>>;
    createdAt: z$1.ZodNumber;
    updatedAt: z$1.ZodNumber;
    lastUserInputAt: z$1.ZodNullable<z$1.ZodNumber>;
}, z$1.core.$strip>;
type TerminalSession = z$1.infer<typeof terminalSessionSchema>;
declare const terminalListResponseSchema: z$1.ZodObject<{
    sessions: z$1.ZodArray<z$1.ZodObject<{
        id: z$1.ZodString;
        threadId: z$1.ZodNullable<z$1.ZodString>;
        environmentId: z$1.ZodNullable<z$1.ZodString>;
        hostId: z$1.ZodString;
        title: z$1.ZodString;
        initialCwd: z$1.ZodString;
        cols: z$1.ZodNumber;
        rows: z$1.ZodNumber;
        status: z$1.ZodEnum<{
            starting: "starting";
            disconnected: "disconnected";
            running: "running";
            exited: "exited";
        }>;
        sandboxed: z$1.ZodBoolean;
        exitCode: z$1.ZodNullable<z$1.ZodNumber>;
        closeReason: z$1.ZodNullable<z$1.ZodEnum<{
            user: "user";
            "thread-deleted": "thread-deleted";
            "process-exit": "process-exit";
            "daemon-disconnect": "daemon-disconnect";
            "environment-destroyed": "environment-destroyed";
            "thread-archived": "thread-archived";
            "open-timeout": "open-timeout";
        }>>;
        createdAt: z$1.ZodNumber;
        updatedAt: z$1.ZodNumber;
        lastUserInputAt: z$1.ZodNullable<z$1.ZodNumber>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type TerminalListResponse = z$1.infer<typeof terminalListResponseSchema>;
declare const createTerminalRequestSchema: z$1.ZodObject<{
    cols: z$1.ZodNumber;
    rows: z$1.ZodNumber;
    start: z$1.ZodOptional<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        mode: z$1.ZodLiteral<"shell">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        mode: z$1.ZodLiteral<"command">;
        command: z$1.ZodString;
    }, z$1.core.$strict>], "mode">>;
    target: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"thread">;
        threadId: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"environment">;
        environmentId: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"host_path">;
        hostId: z$1.ZodString;
        cwd: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strict>], "kind">;
    title: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strict>;
type CreateTerminalRequest = z$1.infer<typeof createTerminalRequestSchema>;
declare const updateTerminalRequestSchema: z$1.ZodObject<{
    title: z$1.ZodString;
}, z$1.core.$strict>;
type UpdateTerminalRequest = z$1.infer<typeof updateTerminalRequestSchema>;
declare const terminalInputRequestSchema: z$1.ZodObject<{
    dataBase64: z$1.ZodString;
}, z$1.core.$strict>;
type TerminalInputRequest = z$1.infer<typeof terminalInputRequestSchema>;
declare const terminalResizeRequestSchema: z$1.ZodObject<{
    cols: z$1.ZodNumber;
    rows: z$1.ZodNumber;
}, z$1.core.$strict>;
type TerminalResizeRequest = z$1.infer<typeof terminalResizeRequestSchema>;
declare const terminalOutputQuerySchema: z$1.ZodObject<{
    sinceSeq: z$1.ZodOptional<z$1.ZodCoercedNumber<unknown>>;
    tailBytes: z$1.ZodOptional<z$1.ZodCoercedNumber<unknown>>;
    limitChunks: z$1.ZodOptional<z$1.ZodCoercedNumber<unknown>>;
}, z$1.core.$strict>;
type TerminalOutputQuery = z$1.infer<typeof terminalOutputQuerySchema>;
declare const terminalOutputResponseSchema: z$1.ZodObject<{
    chunks: z$1.ZodArray<z$1.ZodObject<{
        seq: z$1.ZodNumber;
        dataBase64: z$1.ZodString;
    }, z$1.core.$strict>>;
    nextSeq: z$1.ZodNumber;
    truncated: z$1.ZodBoolean;
}, z$1.core.$strict>;
type TerminalOutputResponse = z$1.infer<typeof terminalOutputResponseSchema>;

declare const timelineRowStatusSchema: z$1.ZodEnum<{
    error: "error";
    pending: "pending";
    completed: "completed";
    interrupted: "interrupted";
}>;
type TimelineRowStatus = z$1.infer<typeof timelineRowStatusSchema>;
declare const timelineRowBaseSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    sourceSeqStart: z$1.ZodNumber;
    sourceSeqEnd: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    createdAt: z$1.ZodNumber;
}, z$1.core.$strip>;
type TimelineRowBase = z$1.infer<typeof timelineRowBaseSchema>;
declare const timelineConversationRowSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    sourceSeqStart: z$1.ZodNumber;
    sourceSeqEnd: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    createdAt: z$1.ZodNumber;
    kind: z$1.ZodLiteral<"conversation">;
    text: z$1.ZodString;
    attachments: z$1.ZodNullable<z$1.ZodObject<{
        webImages: z$1.ZodNumber;
        localImages: z$1.ZodNumber;
        localFiles: z$1.ZodNumber;
        imageUrls: z$1.ZodArray<z$1.ZodString>;
        localImagePaths: z$1.ZodArray<z$1.ZodString>;
        localFilePaths: z$1.ZodArray<z$1.ZodString>;
    }, z$1.core.$strip>>;
    role: z$1.ZodLiteral<"user">;
    initiator: z$1.ZodEnum<{
        user: "user";
        agent: "agent";
        system: "system";
    }>;
    senderThreadId: z$1.ZodNullable<z$1.ZodString>;
    systemMessageKind: z$1.ZodEnum<{
        "ownership-assigned": "ownership-assigned";
        "ownership-removed": "ownership-removed";
        "child-needs-attention": "child-needs-attention";
        "child-completed": "child-completed";
        "child-failed": "child-failed";
        "child-interrupted": "child-interrupted";
        "child-outcome-batch": "child-outcome-batch";
        unlabeled: "unlabeled";
    }>;
    systemMessageSubject: z$1.ZodNullable<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        kind: z$1.ZodLiteral<"thread">;
        threadId: z$1.ZodString;
        threadName: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"thread-batch">;
        count: z$1.ZodNumber;
    }, z$1.core.$strip>], "kind">>;
    turnRequest: z$1.ZodObject<{
        isGrouped: z$1.ZodBoolean;
        kind: z$1.ZodEnum<{
            message: "message";
            steer: "steer";
        }>;
        status: z$1.ZodEnum<{
            pending: "pending";
            accepted: "accepted";
        }>;
    }, z$1.core.$strip>;
    mentions: z$1.ZodArray<z$1.ZodObject<{
        start: z$1.ZodNumber;
        end: z$1.ZodNumber;
        resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"thread">;
            threadId: z$1.ZodString;
            projectId: z$1.ZodOptional<z$1.ZodString>;
            label: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"project">;
            projectId: z$1.ZodString;
            label: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"section">;
            sectionId: z$1.ZodString;
            label: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"path">;
            source: z$1.ZodEnum<{
                workspace: "workspace";
                "thread-storage": "thread-storage";
            }>;
            entryKind: z$1.ZodEnum<{
                file: "file";
                directory: "directory";
            }>;
            path: z$1.ZodString;
            label: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"command">;
            trigger: z$1.ZodEnum<{
                "/": "/";
            }>;
            name: z$1.ZodString;
            source: z$1.ZodEnum<{
                command: "command";
                skill: "skill";
            }>;
            origin: z$1.ZodEnum<{
                user: "user";
                project: "project";
                builtin: "builtin";
            }>;
            label: z$1.ZodString;
            argumentHint: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"plugin">;
            pluginId: z$1.ZodString;
            icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
            itemId: z$1.ZodString;
            label: z$1.ZodString;
        }, z$1.core.$strip>], "kind">>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>, z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    sourceSeqStart: z$1.ZodNumber;
    sourceSeqEnd: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    createdAt: z$1.ZodNumber;
    kind: z$1.ZodLiteral<"conversation">;
    text: z$1.ZodString;
    attachments: z$1.ZodNullable<z$1.ZodObject<{
        webImages: z$1.ZodNumber;
        localImages: z$1.ZodNumber;
        localFiles: z$1.ZodNumber;
        imageUrls: z$1.ZodArray<z$1.ZodString>;
        localImagePaths: z$1.ZodArray<z$1.ZodString>;
        localFilePaths: z$1.ZodArray<z$1.ZodString>;
    }, z$1.core.$strip>>;
    role: z$1.ZodLiteral<"assistant">;
    turnRequest: z$1.ZodNull;
}, z$1.core.$strip>], "role">;
type TimelineConversationRow = z$1.infer<typeof timelineConversationRowSchema>;
declare const timelineSystemRowSchema: z$1.ZodUnion<readonly [z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    sourceSeqStart: z$1.ZodNumber;
    sourceSeqEnd: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    createdAt: z$1.ZodNumber;
    kind: z$1.ZodLiteral<"system">;
    title: z$1.ZodString;
    detail: z$1.ZodNullable<z$1.ZodString>;
    status: z$1.ZodNullable<z$1.ZodEnum<{
        error: "error";
        pending: "pending";
        completed: "completed";
        interrupted: "interrupted";
    }>>;
    systemKind: z$1.ZodEnum<{
        error: "error";
        debug: "debug";
        reconnect: "reconnect";
    }>;
}, z$1.core.$strip>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    sourceSeqStart: z$1.ZodNumber;
    sourceSeqEnd: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    createdAt: z$1.ZodNumber;
    kind: z$1.ZodLiteral<"system">;
    title: z$1.ZodString;
    detail: z$1.ZodNullable<z$1.ZodString>;
    status: z$1.ZodNullable<z$1.ZodEnum<{
        error: "error";
        pending: "pending";
        completed: "completed";
        interrupted: "interrupted";
    }>>;
    systemKind: z$1.ZodLiteral<"operation">;
    operationKind: z$1.ZodEnum<{
        generic: "generic";
        compaction: "compaction";
        "thread-provisioning": "thread-provisioning";
        "thread-interrupted": "thread-interrupted";
        "provider-unhandled": "provider-unhandled";
        warning: "warning";
        deprecation: "deprecation";
    }>;
    completedAt: z$1.ZodNullable<z$1.ZodNumber>;
}, z$1.core.$strip>, z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    sourceSeqStart: z$1.ZodNumber;
    sourceSeqEnd: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    createdAt: z$1.ZodNumber;
    kind: z$1.ZodLiteral<"system">;
    title: z$1.ZodString;
    detail: z$1.ZodNullable<z$1.ZodString>;
    systemKind: z$1.ZodLiteral<"operation">;
    operationKind: z$1.ZodLiteral<"parent-change">;
    status: z$1.ZodEnum<{
        error: "error";
        pending: "pending";
        completed: "completed";
        interrupted: "interrupted";
    }>;
    parentChange: z$1.ZodObject<{
        action: z$1.ZodEnum<{
            assign: "assign";
            release: "release";
            transfer: "transfer";
        }>;
        previousParentThreadId: z$1.ZodNullable<z$1.ZodString>;
        previousParentThreadTitle: z$1.ZodNullable<z$1.ZodString>;
        nextParentThreadId: z$1.ZodNullable<z$1.ZodString>;
        nextParentThreadTitle: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>;
    completedAt: z$1.ZodNullable<z$1.ZodNumber>;
}, z$1.core.$strip>], "operationKind">]>;
type TimelineSystemRow = z$1.infer<typeof timelineSystemRowSchema>;
interface TimelineWorkRowBase extends TimelineRowBase {
    kind: "work";
    status: TimelineRowStatus;
}
declare const timelineCommandWorkRowSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    sourceSeqStart: z$1.ZodNumber;
    sourceSeqEnd: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    createdAt: z$1.ZodNumber;
    kind: z$1.ZodLiteral<"work">;
    status: z$1.ZodEnum<{
        error: "error";
        pending: "pending";
        completed: "completed";
        interrupted: "interrupted";
    }>;
    workKind: z$1.ZodLiteral<"command">;
    callId: z$1.ZodString;
    command: z$1.ZodString;
    cwd: z$1.ZodNullable<z$1.ZodString>;
    source: z$1.ZodNullable<z$1.ZodString>;
    output: z$1.ZodString;
    exitCode: z$1.ZodNullable<z$1.ZodNumber>;
    completedAt: z$1.ZodNullable<z$1.ZodNumber>;
    approvalStatus: z$1.ZodNullable<z$1.ZodEnum<{
        waiting_for_approval: "waiting_for_approval";
        denied: "denied";
    }>>;
    activityIntents: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        type: z$1.ZodLiteral<"read">;
        command: z$1.ZodString;
        name: z$1.ZodString;
        path: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"list_files">;
        command: z$1.ZodString;
        path: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"search">;
        command: z$1.ZodString;
        query: z$1.ZodNullable<z$1.ZodString>;
        path: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"unknown">;
        command: z$1.ZodString;
    }, z$1.core.$strip>], "type">>;
}, z$1.core.$strip>;
type TimelineCommandWorkRow = z$1.infer<typeof timelineCommandWorkRowSchema>;
declare const timelineToolWorkRowSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    sourceSeqStart: z$1.ZodNumber;
    sourceSeqEnd: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    createdAt: z$1.ZodNumber;
    kind: z$1.ZodLiteral<"work">;
    status: z$1.ZodEnum<{
        error: "error";
        pending: "pending";
        completed: "completed";
        interrupted: "interrupted";
    }>;
    workKind: z$1.ZodLiteral<"tool">;
    callId: z$1.ZodString;
    toolName: z$1.ZodString;
    toolArgs: z$1.ZodNullable<z$1.ZodRecord<z$1.ZodString, z$1.ZodType<JsonValue$1, unknown, z$1.core.$ZodTypeInternals<JsonValue$1, unknown>>>>;
    statusLabels: z$1.ZodOptional<z$1.ZodObject<{
        pending: z$1.ZodString;
        completed: z$1.ZodString;
    }, z$1.core.$strip>>;
    output: z$1.ZodString;
    completedAt: z$1.ZodNullable<z$1.ZodNumber>;
    approvalStatus: z$1.ZodNullable<z$1.ZodEnum<{
        waiting_for_approval: "waiting_for_approval";
        denied: "denied";
    }>>;
    activityIntents: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        type: z$1.ZodLiteral<"read">;
        command: z$1.ZodString;
        name: z$1.ZodString;
        path: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"list_files">;
        command: z$1.ZodString;
        path: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"search">;
        command: z$1.ZodString;
        query: z$1.ZodNullable<z$1.ZodString>;
        path: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"unknown">;
        command: z$1.ZodString;
    }, z$1.core.$strip>], "type">>;
}, z$1.core.$strip>;
type TimelineToolWorkRow = z$1.infer<typeof timelineToolWorkRowSchema>;
declare const timelineFileChangeWorkRowSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    sourceSeqStart: z$1.ZodNumber;
    sourceSeqEnd: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    createdAt: z$1.ZodNumber;
    kind: z$1.ZodLiteral<"work">;
    status: z$1.ZodEnum<{
        error: "error";
        pending: "pending";
        completed: "completed";
        interrupted: "interrupted";
    }>;
    workKind: z$1.ZodLiteral<"file-change">;
    callId: z$1.ZodString;
    change: z$1.ZodObject<{
        path: z$1.ZodString;
        kind: z$1.ZodNullable<z$1.ZodString>;
        movePath: z$1.ZodNullable<z$1.ZodString>;
        diff: z$1.ZodNullable<z$1.ZodString>;
        diffStats: z$1.ZodObject<{
            added: z$1.ZodNumber;
            removed: z$1.ZodNumber;
        }, z$1.core.$strip>;
    }, z$1.core.$strip>;
    stdout: z$1.ZodNullable<z$1.ZodString>;
    stderr: z$1.ZodNullable<z$1.ZodString>;
    approvalStatus: z$1.ZodNullable<z$1.ZodEnum<{
        waiting_for_approval: "waiting_for_approval";
        denied: "denied";
    }>>;
}, z$1.core.$strip>;
type TimelineFileChangeWorkRow = z$1.infer<typeof timelineFileChangeWorkRowSchema>;
declare const timelineWebSearchWorkRowSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    sourceSeqStart: z$1.ZodNumber;
    sourceSeqEnd: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    createdAt: z$1.ZodNumber;
    kind: z$1.ZodLiteral<"work">;
    status: z$1.ZodEnum<{
        error: "error";
        pending: "pending";
        completed: "completed";
        interrupted: "interrupted";
    }>;
    workKind: z$1.ZodLiteral<"web-search">;
    callId: z$1.ZodString;
    queries: z$1.ZodArray<z$1.ZodString>;
    completedAt: z$1.ZodNullable<z$1.ZodNumber>;
}, z$1.core.$strip>;
type TimelineWebSearchWorkRow = z$1.infer<typeof timelineWebSearchWorkRowSchema>;
declare const timelineWebFetchWorkRowSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    sourceSeqStart: z$1.ZodNumber;
    sourceSeqEnd: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    createdAt: z$1.ZodNumber;
    kind: z$1.ZodLiteral<"work">;
    status: z$1.ZodEnum<{
        error: "error";
        pending: "pending";
        completed: "completed";
        interrupted: "interrupted";
    }>;
    workKind: z$1.ZodLiteral<"web-fetch">;
    callId: z$1.ZodString;
    url: z$1.ZodString;
    prompt: z$1.ZodNullable<z$1.ZodString>;
    pattern: z$1.ZodNullable<z$1.ZodString>;
    completedAt: z$1.ZodNullable<z$1.ZodNumber>;
}, z$1.core.$strip>;
type TimelineWebFetchWorkRow = z$1.infer<typeof timelineWebFetchWorkRowSchema>;
declare const timelineImageViewWorkRowSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    sourceSeqStart: z$1.ZodNumber;
    sourceSeqEnd: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    createdAt: z$1.ZodNumber;
    kind: z$1.ZodLiteral<"work">;
    status: z$1.ZodEnum<{
        error: "error";
        pending: "pending";
        completed: "completed";
        interrupted: "interrupted";
    }>;
    workKind: z$1.ZodLiteral<"image-view">;
    callId: z$1.ZodString;
    path: z$1.ZodString;
    completedAt: z$1.ZodNullable<z$1.ZodNumber>;
}, z$1.core.$strip>;
type TimelineImageViewWorkRow = z$1.infer<typeof timelineImageViewWorkRowSchema>;
declare const timelineApprovalWorkRowSchema: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    sourceSeqStart: z$1.ZodNumber;
    sourceSeqEnd: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    createdAt: z$1.ZodNumber;
    kind: z$1.ZodLiteral<"work">;
    status: z$1.ZodEnum<{
        error: "error";
        pending: "pending";
        completed: "completed";
        interrupted: "interrupted";
    }>;
    workKind: z$1.ZodLiteral<"approval">;
    interactionId: z$1.ZodString;
    target: z$1.ZodObject<{
        itemId: z$1.ZodString;
        toolName: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>;
    approvalKind: z$1.ZodLiteral<"file-edit">;
    lifecycle: z$1.ZodEnum<{
        denied: "denied";
        waiting: "waiting";
    }>;
}, z$1.core.$strip>, z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    sourceSeqStart: z$1.ZodNumber;
    sourceSeqEnd: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    createdAt: z$1.ZodNumber;
    kind: z$1.ZodLiteral<"work">;
    status: z$1.ZodEnum<{
        error: "error";
        pending: "pending";
        completed: "completed";
        interrupted: "interrupted";
    }>;
    workKind: z$1.ZodLiteral<"approval">;
    interactionId: z$1.ZodString;
    target: z$1.ZodObject<{
        itemId: z$1.ZodString;
        toolName: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>;
    approvalKind: z$1.ZodLiteral<"permission-grant">;
    lifecycle: z$1.ZodEnum<{
        pending: "pending";
        interrupted: "interrupted";
        denied: "denied";
        resolving: "resolving";
        granted: "granted";
    }>;
    grantScope: z$1.ZodNullable<z$1.ZodEnum<{
        turn: "turn";
        session: "session";
    }>>;
    statusReason: z$1.ZodNullable<z$1.ZodString>;
}, z$1.core.$strip>], "approvalKind">;
type TimelineApprovalWorkRow = z$1.infer<typeof timelineApprovalWorkRowSchema>;
declare const timelineQuestionWorkRowSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    sourceSeqStart: z$1.ZodNumber;
    sourceSeqEnd: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    createdAt: z$1.ZodNumber;
    kind: z$1.ZodLiteral<"work">;
    status: z$1.ZodEnum<{
        error: "error";
        pending: "pending";
        completed: "completed";
        interrupted: "interrupted";
    }>;
    workKind: z$1.ZodLiteral<"question">;
    interactionId: z$1.ZodString;
    lifecycle: z$1.ZodEnum<{
        pending: "pending";
        interrupted: "interrupted";
        resolving: "resolving";
        answered: "answered";
    }>;
    questions: z$1.ZodArray<z$1.ZodObject<{
        id: z$1.ZodString;
        prompt: z$1.ZodString;
        shortLabel: z$1.ZodOptional<z$1.ZodString>;
        multiSelect: z$1.ZodBoolean;
        options: z$1.ZodOptional<z$1.ZodArray<z$1.ZodObject<{
            value: z$1.ZodString;
            label: z$1.ZodString;
            description: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>>;
        allowFreeText: z$1.ZodBoolean;
    }, z$1.core.$strip>>;
    answers: z$1.ZodNullable<z$1.ZodRecord<z$1.ZodString, z$1.ZodObject<{
        selected: z$1.ZodArray<z$1.ZodString>;
        freeText: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>>>;
    statusReason: z$1.ZodNullable<z$1.ZodString>;
}, z$1.core.$strip>;
type TimelineQuestionWorkRow = z$1.infer<typeof timelineQuestionWorkRowSchema>;
interface TimelineDelegationWorkRow extends TimelineWorkRowBase {
    workKind: "delegation";
    callId: string;
    toolName: string;
    subagentType: string | null;
    description: string | null;
    output: string;
    completedAt: number | null;
    childRows: TimelineRow[];
}
/**
 * A provider background task — a dynamic workflow (Claude Code Workflow tool)
 * or a backgrounded shell command (Bash run_in_background), discriminated by
 * `taskType`. The row outlives its spawning turn: progress and terminal state
 * arrive via thread-scoped events folded into this single row. `workflow` is
 * the merged phase/agent tree, present only for workflows; null for shell
 * commands and for workflows the provider reported no progress records for
 * (degraded rendering falls back to description + summary).
 */
declare const timelineWorkflowWorkRowSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    sourceSeqStart: z$1.ZodNumber;
    sourceSeqEnd: z$1.ZodNumber;
    startedAt: z$1.ZodNumber;
    createdAt: z$1.ZodNumber;
    kind: z$1.ZodLiteral<"work">;
    status: z$1.ZodEnum<{
        error: "error";
        pending: "pending";
        completed: "completed";
        interrupted: "interrupted";
    }>;
    workKind: z$1.ZodLiteral<"workflow">;
    itemId: z$1.ZodString;
    taskType: z$1.ZodString;
    workflowName: z$1.ZodNullable<z$1.ZodString>;
    description: z$1.ZodString;
    taskStatus: z$1.ZodEnum<{
        pending: "pending";
        completed: "completed";
        running: "running";
        paused: "paused";
        failed: "failed";
        killed: "killed";
        stopped: "stopped";
    }>;
    workflow: z$1.ZodNullable<z$1.ZodObject<{
        phases: z$1.ZodArray<z$1.ZodObject<{
            index: z$1.ZodNumber;
            title: z$1.ZodString;
            kind: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
        agents: z$1.ZodArray<z$1.ZodObject<{
            index: z$1.ZodNumber;
            label: z$1.ZodString;
            state: z$1.ZodEnum<{
                running: "running";
                failed: "failed";
                queued: "queued";
                done: "done";
                skipped: "skipped";
            }>;
            model: z$1.ZodString;
            attempt: z$1.ZodNumber;
            cached: z$1.ZodBoolean;
            lastProgressAt: z$1.ZodNumber;
            phaseIndex: z$1.ZodOptional<z$1.ZodNumber>;
            phaseTitle: z$1.ZodOptional<z$1.ZodString>;
            agentType: z$1.ZodOptional<z$1.ZodString>;
            isolation: z$1.ZodOptional<z$1.ZodString>;
            queuedAt: z$1.ZodOptional<z$1.ZodNumber>;
            startedAt: z$1.ZodOptional<z$1.ZodNumber>;
            lastToolName: z$1.ZodOptional<z$1.ZodString>;
            lastToolSummary: z$1.ZodOptional<z$1.ZodString>;
            promptPreview: z$1.ZodOptional<z$1.ZodString>;
            resultPreview: z$1.ZodOptional<z$1.ZodString>;
            error: z$1.ZodOptional<z$1.ZodString>;
            tokens: z$1.ZodOptional<z$1.ZodNumber>;
            toolCalls: z$1.ZodOptional<z$1.ZodNumber>;
            durationMs: z$1.ZodOptional<z$1.ZodNumber>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>>;
    usage: z$1.ZodNullable<z$1.ZodObject<{
        totalTokens: z$1.ZodNumber;
        toolUses: z$1.ZodNumber;
        durationMs: z$1.ZodNumber;
    }, z$1.core.$strip>>;
    summary: z$1.ZodNullable<z$1.ZodString>;
    error: z$1.ZodNullable<z$1.ZodString>;
    completedAt: z$1.ZodNullable<z$1.ZodNumber>;
}, z$1.core.$strip>;
type TimelineWorkflowWorkRow = z$1.infer<typeof timelineWorkflowWorkRowSchema>;
type TimelineWorkRow = TimelineCommandWorkRow | TimelineToolWorkRow | TimelineFileChangeWorkRow | TimelineWebSearchWorkRow | TimelineWebFetchWorkRow | TimelineImageViewWorkRow | TimelineApprovalWorkRow | TimelineQuestionWorkRow | TimelineDelegationWorkRow | TimelineWorkflowWorkRow;
interface TimelineTurnRow extends TimelineRowBase {
    kind: "turn";
    turnId: string;
    status: TimelineRowStatus;
    summaryCount: number;
    completedAt: number | null;
    children: TimelineRow[] | null;
}
type TimelineSourceRow = TimelineConversationRow | TimelineWorkRow | TimelineSystemRow;
type TimelineRow = TimelineSourceRow | TimelineTurnRow;

declare const createExecutionInputSourcesSchema: z$1.ZodObject<{
    providerId: z$1.ZodOptional<z$1.ZodEnum<{
        explicit: "explicit";
        "client-preference": "client-preference";
    }>>;
    model: z$1.ZodOptional<z$1.ZodEnum<{
        explicit: "explicit";
        "client-preference": "client-preference";
    }>>;
    serviceTier: z$1.ZodOptional<z$1.ZodEnum<{
        explicit: "explicit";
        "client-preference": "client-preference";
    }>>;
    reasoningLevel: z$1.ZodOptional<z$1.ZodEnum<{
        explicit: "explicit";
        "client-preference": "client-preference";
    }>>;
    permissionMode: z$1.ZodOptional<z$1.ZodEnum<{
        explicit: "explicit";
        "client-preference": "client-preference";
    }>>;
}, z$1.core.$strict>;
type CreateExecutionInputSources = z$1.infer<typeof createExecutionInputSourcesSchema>;
declare const createThreadRequestSchema: z$1.ZodObject<{
    projectId: z$1.ZodString;
    providerId: z$1.ZodOptional<z$1.ZodString>;
    origin: z$1.ZodEnum<{
        plugin: "plugin";
        app: "app";
        cli: "cli";
        sdk: "sdk";
    }>;
    originPluginId: z$1.ZodOptional<z$1.ZodString>;
    visibility: z$1.ZodOptional<z$1.ZodEnum<{
        visible: "visible";
        hidden: "hidden";
    }>>;
    title: z$1.ZodOptional<z$1.ZodString>;
    input: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"text">;
        text: z$1.ZodString;
        mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            start: z$1.ZodNumber;
            end: z$1.ZodNumber;
            resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"thread">;
                threadId: z$1.ZodString;
                projectId: z$1.ZodOptional<z$1.ZodString>;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"project">;
                projectId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"section">;
                sectionId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"path">;
                source: z$1.ZodEnum<{
                    workspace: "workspace";
                    "thread-storage": "thread-storage";
                }>;
                entryKind: z$1.ZodEnum<{
                    file: "file";
                    directory: "directory";
                }>;
                path: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"command">;
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
                name: z$1.ZodString;
                source: z$1.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                origin: z$1.ZodEnum<{
                    user: "user";
                    project: "project";
                    builtin: "builtin";
                }>;
                label: z$1.ZodString;
                argumentHint: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"plugin">;
                pluginId: z$1.ZodString;
                icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                itemId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>], "kind">>;
        }, z$1.core.$strip>>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"image">;
        url: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localImage">;
        path: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localFile">;
        path: z$1.ZodString;
        name: z$1.ZodOptional<z$1.ZodString>;
        sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
        mimeType: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>], "type">>;
    model: z$1.ZodOptional<z$1.ZodString>;
    serviceTier: z$1.ZodOptional<z$1.ZodEnum<{
        default: "default";
        fast: "fast";
    }>>;
    reasoningLevel: z$1.ZodOptional<z$1.ZodEnum<{
        none: "none";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        ultracode: "ultracode";
        max: "max";
        ultra: "ultra";
    }>>;
    permissionMode: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodUnion<readonly [z$1.ZodEnum<{
        auto: "auto";
        "accept-edits": "accept-edits";
        full: "full";
    }>, z$1.ZodLiteral<"workspace-write">]>, z$1.ZodTransform<"auto" | "accept-edits" | "full", "auto" | "accept-edits" | "full" | "workspace-write">>>;
    executionInputSources: z$1.ZodOptional<z$1.ZodObject<{
        providerId: z$1.ZodOptional<z$1.ZodEnum<{
            explicit: "explicit";
            "client-preference": "client-preference";
        }>>;
        model: z$1.ZodOptional<z$1.ZodEnum<{
            explicit: "explicit";
            "client-preference": "client-preference";
        }>>;
        serviceTier: z$1.ZodOptional<z$1.ZodEnum<{
            explicit: "explicit";
            "client-preference": "client-preference";
        }>>;
        reasoningLevel: z$1.ZodOptional<z$1.ZodEnum<{
            explicit: "explicit";
            "client-preference": "client-preference";
        }>>;
        permissionMode: z$1.ZodOptional<z$1.ZodEnum<{
            explicit: "explicit";
            "client-preference": "client-preference";
        }>>;
    }, z$1.core.$strict>>;
    environment: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        type: z$1.ZodLiteral<"reuse">;
        environmentId: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"host">;
        hostId: z$1.ZodOptional<z$1.ZodString>;
        workspace: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            type: z$1.ZodLiteral<"unmanaged">;
            path: z$1.ZodNullable<z$1.ZodString>;
            branch: z$1.ZodOptional<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"existing">;
                name: z$1.ZodString;
            }, z$1.core.$strict>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"new">;
                baseBranch: z$1.ZodString;
            }, z$1.core.$strict>], "kind">>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"managed-worktree">;
            baseBranch: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"named">;
                name: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"default">;
            }, z$1.core.$strip>], "kind">;
        }, z$1.core.$strip>, z$1.ZodObject<{
            type: z$1.ZodLiteral<"personal">;
        }, z$1.core.$strip>], "type">;
    }, z$1.core.$strip>, z$1.ZodObject<{
        type: z$1.ZodLiteral<"project-default">;
    }, z$1.core.$strip>], "type">;
    parentThreadId: z$1.ZodOptional<z$1.ZodString>;
    sectionId: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
    sourceThreadId: z$1.ZodOptional<z$1.ZodString>;
    sourceSeqEnd: z$1.ZodOptional<z$1.ZodNumber>;
    startedOnBehalfOf: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodObject<{
        initiator: z$1.ZodEnum<{
            agent: "agent";
            system: "system";
        }>;
        senderThreadId: z$1.ZodString;
    }, z$1.core.$strip>>>;
    originKind: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodEnum<{
        fork: "fork";
    }>>>;
    childOrigin: z$1.ZodDefault<z$1.ZodNullable<z$1.ZodEnum<{
        fork: "fork";
    }>>>;
}, z$1.core.$strip>;
type CreateThreadRequest = z$1.infer<typeof createThreadRequestSchema>;
declare const forkThreadRequestSchema: z$1.ZodObject<{
    sourceThreadId: z$1.ZodString;
    sourceSeqEnd: z$1.ZodOptional<z$1.ZodNumber>;
    input: z$1.ZodOptional<z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"text">;
        text: z$1.ZodString;
        mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            start: z$1.ZodNumber;
            end: z$1.ZodNumber;
            resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"thread">;
                threadId: z$1.ZodString;
                projectId: z$1.ZodOptional<z$1.ZodString>;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"project">;
                projectId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"section">;
                sectionId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"path">;
                source: z$1.ZodEnum<{
                    workspace: "workspace";
                    "thread-storage": "thread-storage";
                }>;
                entryKind: z$1.ZodEnum<{
                    file: "file";
                    directory: "directory";
                }>;
                path: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"command">;
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
                name: z$1.ZodString;
                source: z$1.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                origin: z$1.ZodEnum<{
                    user: "user";
                    project: "project";
                    builtin: "builtin";
                }>;
                label: z$1.ZodString;
                argumentHint: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"plugin">;
                pluginId: z$1.ZodString;
                icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                itemId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>], "kind">>;
        }, z$1.core.$strip>>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"image">;
        url: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localImage">;
        path: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localFile">;
        path: z$1.ZodString;
        name: z$1.ZodOptional<z$1.ZodString>;
        sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
        mimeType: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>], "type">>>;
    agentContextSeed: z$1.ZodOptional<z$1.ZodArray<z$1.ZodIntersection<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"text">;
        text: z$1.ZodString;
        mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            start: z$1.ZodNumber;
            end: z$1.ZodNumber;
            resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"thread">;
                threadId: z$1.ZodString;
                projectId: z$1.ZodOptional<z$1.ZodString>;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"project">;
                projectId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"section">;
                sectionId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"path">;
                source: z$1.ZodEnum<{
                    workspace: "workspace";
                    "thread-storage": "thread-storage";
                }>;
                entryKind: z$1.ZodEnum<{
                    file: "file";
                    directory: "directory";
                }>;
                path: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"command">;
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
                name: z$1.ZodString;
                source: z$1.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                origin: z$1.ZodEnum<{
                    user: "user";
                    project: "project";
                    builtin: "builtin";
                }>;
                label: z$1.ZodString;
                argumentHint: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"plugin">;
                pluginId: z$1.ZodString;
                icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                itemId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>], "kind">>;
        }, z$1.core.$strip>>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"image">;
        url: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localImage">;
        path: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localFile">;
        path: z$1.ZodString;
        name: z$1.ZodOptional<z$1.ZodString>;
        sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
        mimeType: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>], "type">, z$1.ZodObject<{
        visibility: z$1.ZodLiteral<"agent-only">;
    }, z$1.core.$strip>>>>;
    title: z$1.ZodOptional<z$1.ZodString>;
    permissionMode: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodUnion<readonly [z$1.ZodEnum<{
        auto: "auto";
        "accept-edits": "accept-edits";
        full: "full";
    }>, z$1.ZodLiteral<"workspace-write">]>, z$1.ZodTransform<"auto" | "accept-edits" | "full", "auto" | "accept-edits" | "full" | "workspace-write">>>;
    visibility: z$1.ZodDefault<z$1.ZodEnum<{
        visible: "visible";
        hidden: "hidden";
    }>>;
    workspace: z$1.ZodDefault<z$1.ZodEnum<{
        reuse: "reuse";
        isolated: "isolated";
    }>>;
    origin: z$1.ZodDefault<z$1.ZodEnum<{
        plugin: "plugin";
        app: "app";
        cli: "cli";
        sdk: "sdk";
    }>>;
    originPluginId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type ForkThreadRequest = z$1.infer<typeof forkThreadRequestSchema>;
declare const sendMessageRequestSchema: z$1.ZodObject<{
    input: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"text">;
        text: z$1.ZodString;
        mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            start: z$1.ZodNumber;
            end: z$1.ZodNumber;
            resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"thread">;
                threadId: z$1.ZodString;
                projectId: z$1.ZodOptional<z$1.ZodString>;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"project">;
                projectId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"section">;
                sectionId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"path">;
                source: z$1.ZodEnum<{
                    workspace: "workspace";
                    "thread-storage": "thread-storage";
                }>;
                entryKind: z$1.ZodEnum<{
                    file: "file";
                    directory: "directory";
                }>;
                path: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"command">;
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
                name: z$1.ZodString;
                source: z$1.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                origin: z$1.ZodEnum<{
                    user: "user";
                    project: "project";
                    builtin: "builtin";
                }>;
                label: z$1.ZodString;
                argumentHint: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"plugin">;
                pluginId: z$1.ZodString;
                icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                itemId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>], "kind">>;
        }, z$1.core.$strip>>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"image">;
        url: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localImage">;
        path: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localFile">;
        path: z$1.ZodString;
        name: z$1.ZodOptional<z$1.ZodString>;
        sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
        mimeType: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>], "type">>;
    model: z$1.ZodOptional<z$1.ZodString>;
    serviceTier: z$1.ZodOptional<z$1.ZodEnum<{
        default: "default";
        fast: "fast";
    }>>;
    reasoningLevel: z$1.ZodOptional<z$1.ZodEnum<{
        none: "none";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        ultracode: "ultracode";
        max: "max";
        ultra: "ultra";
    }>>;
    permissionMode: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodUnion<readonly [z$1.ZodEnum<{
        auto: "auto";
        "accept-edits": "accept-edits";
        full: "full";
    }>, z$1.ZodLiteral<"workspace-write">]>, z$1.ZodTransform<"auto" | "accept-edits" | "full", "auto" | "accept-edits" | "full" | "workspace-write">>>;
    executionInputSources: z$1.ZodOptional<z$1.ZodObject<{
        model: z$1.ZodOptional<z$1.ZodEnum<{
            explicit: "explicit";
            "client-preference": "client-preference";
        }>>;
        serviceTier: z$1.ZodOptional<z$1.ZodEnum<{
            explicit: "explicit";
            "client-preference": "client-preference";
        }>>;
        reasoningLevel: z$1.ZodOptional<z$1.ZodEnum<{
            explicit: "explicit";
            "client-preference": "client-preference";
        }>>;
        permissionMode: z$1.ZodOptional<z$1.ZodEnum<{
            explicit: "explicit";
            "client-preference": "client-preference";
        }>>;
    }, z$1.core.$strict>>;
    mode: z$1.ZodEnum<{
        steer: "steer";
        start: "start";
        auto: "auto";
        "queue-if-active": "queue-if-active";
        "steer-if-active": "steer-if-active";
    }>;
    senderThreadId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type SendMessageRequest = z$1.infer<typeof sendMessageRequestSchema>;
declare const providerRateLimitRecoveryStatusSchema: z$1.ZodObject<{
    reason: z$1.ZodEnum<{
        eligible: "eligible";
        "thread-not-failed": "thread-not-failed";
        "no-failed-turn": "no-failed-turn";
        "input-not-accepted": "input-not-accepted";
        "no-rate-limit-state": "no-rate-limit-state";
        "no-terminal-rate-limit-error": "no-terminal-rate-limit-error";
        "provider-will-retry": "provider-will-retry";
        "manual-only": "manual-only";
        "output-or-side-effect-observed": "output-or-side-effect-observed";
        superseded: "superseded";
        "execution-unavailable": "execution-unavailable";
    }>;
    scopeKey: z$1.ZodString;
    hostId: z$1.ZodString;
    rateLimits: z$1.ZodNullable<z$1.ZodObject<{
        providerId: z$1.ZodString;
        status: z$1.ZodEnum<{
            unknown: "unknown";
            warning: "warning";
            allowed: "allowed";
            blocked: "blocked";
        }>;
        kind: z$1.ZodEnum<{
            unknown: "unknown";
            "subscription-window": "subscription-window";
            credits: "credits";
            "spend-control": "spend-control";
        }>;
        windows: z$1.ZodArray<z$1.ZodObject<{
            providerKey: z$1.ZodNullable<z$1.ZodString>;
            label: z$1.ZodNullable<z$1.ZodString>;
            status: z$1.ZodEnum<{
                unknown: "unknown";
                warning: "warning";
                allowed: "allowed";
                blocked: "blocked";
            }>;
            resetsAtMs: z$1.ZodNullable<z$1.ZodNumber>;
        }, z$1.core.$strip>>;
        reachedReason: z$1.ZodNullable<z$1.ZodString>;
        overageStatus: z$1.ZodNullable<z$1.ZodEnum<{
            warning: "warning";
            allowed: "allowed";
            rejected: "rejected";
            unavailable: "unavailable";
        }>>;
        overageReason: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>>;
    candidate: z$1.ZodNullable<z$1.ZodObject<{
        failedRequestId: z$1.ZodString;
        turnId: z$1.ZodString;
        automatic: z$1.ZodBoolean;
        resetsAtMs: z$1.ZodNullable<z$1.ZodNumber>;
        rateLimits: z$1.ZodObject<{
            providerId: z$1.ZodString;
            status: z$1.ZodEnum<{
                unknown: "unknown";
                warning: "warning";
                allowed: "allowed";
                blocked: "blocked";
            }>;
            kind: z$1.ZodEnum<{
                unknown: "unknown";
                "subscription-window": "subscription-window";
                credits: "credits";
                "spend-control": "spend-control";
            }>;
            windows: z$1.ZodArray<z$1.ZodObject<{
                providerKey: z$1.ZodNullable<z$1.ZodString>;
                label: z$1.ZodNullable<z$1.ZodString>;
                status: z$1.ZodEnum<{
                    unknown: "unknown";
                    warning: "warning";
                    allowed: "allowed";
                    blocked: "blocked";
                }>;
                resetsAtMs: z$1.ZodNullable<z$1.ZodNumber>;
            }, z$1.core.$strip>>;
            reachedReason: z$1.ZodNullable<z$1.ZodString>;
            overageStatus: z$1.ZodNullable<z$1.ZodEnum<{
                warning: "warning";
                allowed: "allowed";
                rejected: "rejected";
                unavailable: "unavailable";
            }>>;
            overageReason: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type ProviderRateLimitRecoveryStatus = z$1.infer<typeof providerRateLimitRecoveryStatusSchema>;
declare const continueAfterProviderRateLimitResponseSchema: z$1.ZodObject<{
    ok: z$1.ZodLiteral<true>;
    requestId: z$1.ZodString;
}, z$1.core.$strip>;
type ContinueAfterProviderRateLimitResponse = z$1.infer<typeof continueAfterProviderRateLimitResponseSchema>;
declare const editMessageRequestSchema: z$1.ZodObject<{
    input: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"text">;
        text: z$1.ZodString;
        mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            start: z$1.ZodNumber;
            end: z$1.ZodNumber;
            resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"thread">;
                threadId: z$1.ZodString;
                projectId: z$1.ZodOptional<z$1.ZodString>;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"project">;
                projectId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"section">;
                sectionId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"path">;
                source: z$1.ZodEnum<{
                    workspace: "workspace";
                    "thread-storage": "thread-storage";
                }>;
                entryKind: z$1.ZodEnum<{
                    file: "file";
                    directory: "directory";
                }>;
                path: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"command">;
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
                name: z$1.ZodString;
                source: z$1.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                origin: z$1.ZodEnum<{
                    user: "user";
                    project: "project";
                    builtin: "builtin";
                }>;
                label: z$1.ZodString;
                argumentHint: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"plugin">;
                pluginId: z$1.ZodString;
                icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                itemId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>], "kind">>;
        }, z$1.core.$strip>>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"image">;
        url: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localImage">;
        path: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localFile">;
        path: z$1.ZodString;
        name: z$1.ZodOptional<z$1.ZodString>;
        sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
        mimeType: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>], "type">>;
    senderThreadId: z$1.ZodOptional<z$1.ZodString>;
    model: z$1.ZodOptional<z$1.ZodString>;
    serviceTier: z$1.ZodOptional<z$1.ZodEnum<{
        default: "default";
        fast: "fast";
    }>>;
    reasoningLevel: z$1.ZodOptional<z$1.ZodEnum<{
        none: "none";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        ultracode: "ultracode";
        max: "max";
        ultra: "ultra";
    }>>;
    permissionMode: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodUnion<readonly [z$1.ZodEnum<{
        auto: "auto";
        "accept-edits": "accept-edits";
        full: "full";
    }>, z$1.ZodLiteral<"workspace-write">]>, z$1.ZodTransform<"auto" | "accept-edits" | "full", "auto" | "accept-edits" | "full" | "workspace-write">>>;
    executionInputSources: z$1.ZodOptional<z$1.ZodObject<{
        model: z$1.ZodOptional<z$1.ZodEnum<{
            explicit: "explicit";
            "client-preference": "client-preference";
        }>>;
        serviceTier: z$1.ZodOptional<z$1.ZodEnum<{
            explicit: "explicit";
            "client-preference": "client-preference";
        }>>;
        reasoningLevel: z$1.ZodOptional<z$1.ZodEnum<{
            explicit: "explicit";
            "client-preference": "client-preference";
        }>>;
        permissionMode: z$1.ZodOptional<z$1.ZodEnum<{
            explicit: "explicit";
            "client-preference": "client-preference";
        }>>;
    }, z$1.core.$strict>>;
    operationId: z$1.ZodString;
    expectedRequestSequence: z$1.ZodOptional<z$1.ZodNumber>;
}, z$1.core.$strict>;
type EditMessageRequest = z$1.infer<typeof editMessageRequestSchema>;
declare const editMessageResponseSchema: z$1.ZodObject<{
    ok: z$1.ZodLiteral<true>;
    operationId: z$1.ZodString;
    requestSequence: z$1.ZodNumber;
}, z$1.core.$strict>;
type EditMessageResponse = z$1.infer<typeof editMessageResponseSchema>;
declare const createQueuedMessageRequestSchema: z$1.ZodObject<{
    input: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"text">;
        text: z$1.ZodString;
        mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            start: z$1.ZodNumber;
            end: z$1.ZodNumber;
            resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"thread">;
                threadId: z$1.ZodString;
                projectId: z$1.ZodOptional<z$1.ZodString>;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"project">;
                projectId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"section">;
                sectionId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"path">;
                source: z$1.ZodEnum<{
                    workspace: "workspace";
                    "thread-storage": "thread-storage";
                }>;
                entryKind: z$1.ZodEnum<{
                    file: "file";
                    directory: "directory";
                }>;
                path: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"command">;
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
                name: z$1.ZodString;
                source: z$1.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                origin: z$1.ZodEnum<{
                    user: "user";
                    project: "project";
                    builtin: "builtin";
                }>;
                label: z$1.ZodString;
                argumentHint: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"plugin">;
                pluginId: z$1.ZodString;
                icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                itemId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>], "kind">>;
        }, z$1.core.$strip>>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"image">;
        url: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localImage">;
        path: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localFile">;
        path: z$1.ZodString;
        name: z$1.ZodOptional<z$1.ZodString>;
        sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
        mimeType: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>], "type">>;
    model: z$1.ZodOptional<z$1.ZodString>;
    serviceTier: z$1.ZodOptional<z$1.ZodEnum<{
        default: "default";
        fast: "fast";
    }>>;
    reasoningLevel: z$1.ZodOptional<z$1.ZodEnum<{
        none: "none";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        ultracode: "ultracode";
        max: "max";
        ultra: "ultra";
    }>>;
    permissionMode: z$1.ZodOptional<z$1.ZodPipe<z$1.ZodUnion<readonly [z$1.ZodEnum<{
        auto: "auto";
        "accept-edits": "accept-edits";
        full: "full";
    }>, z$1.ZodLiteral<"workspace-write">]>, z$1.ZodTransform<"auto" | "accept-edits" | "full", "auto" | "accept-edits" | "full" | "workspace-write">>>;
    executionInputSources: z$1.ZodOptional<z$1.ZodObject<{
        model: z$1.ZodOptional<z$1.ZodEnum<{
            explicit: "explicit";
            "client-preference": "client-preference";
        }>>;
        serviceTier: z$1.ZodOptional<z$1.ZodEnum<{
            explicit: "explicit";
            "client-preference": "client-preference";
        }>>;
        reasoningLevel: z$1.ZodOptional<z$1.ZodEnum<{
            explicit: "explicit";
            "client-preference": "client-preference";
        }>>;
        permissionMode: z$1.ZodOptional<z$1.ZodEnum<{
            explicit: "explicit";
            "client-preference": "client-preference";
        }>>;
    }, z$1.core.$strict>>;
    senderThreadId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type CreateQueuedMessageRequest = z$1.infer<typeof createQueuedMessageRequestSchema>;
declare const updateQueuedMessageRequestSchema: z$1.ZodObject<{
    expectedUpdatedAt: z$1.ZodNumber;
    input: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"text">;
        text: z$1.ZodString;
        mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            start: z$1.ZodNumber;
            end: z$1.ZodNumber;
            resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"thread">;
                threadId: z$1.ZodString;
                projectId: z$1.ZodOptional<z$1.ZodString>;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"project">;
                projectId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"section">;
                sectionId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"path">;
                source: z$1.ZodEnum<{
                    workspace: "workspace";
                    "thread-storage": "thread-storage";
                }>;
                entryKind: z$1.ZodEnum<{
                    file: "file";
                    directory: "directory";
                }>;
                path: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"command">;
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
                name: z$1.ZodString;
                source: z$1.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                origin: z$1.ZodEnum<{
                    user: "user";
                    project: "project";
                    builtin: "builtin";
                }>;
                label: z$1.ZodString;
                argumentHint: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"plugin">;
                pluginId: z$1.ZodString;
                icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                itemId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>], "kind">>;
        }, z$1.core.$strip>>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"image">;
        url: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localImage">;
        path: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localFile">;
        path: z$1.ZodString;
        name: z$1.ZodOptional<z$1.ZodString>;
        sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
        mimeType: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>], "type">>;
}, z$1.core.$strip>;
type UpdateQueuedMessageRequest = z$1.infer<typeof updateQueuedMessageRequestSchema>;
declare const sendQueuedMessageRequestSchema: z$1.ZodObject<{
    mode: z$1.ZodEnum<{
        steer: "steer";
        auto: "auto";
    }>;
}, z$1.core.$strip>;
type SendQueuedMessageRequest = z$1.infer<typeof sendQueuedMessageRequestSchema>;
declare const reorderQueuedMessageRequestSchema: z$1.ZodObject<{
    previousQueuedMessageId: z$1.ZodNullable<z$1.ZodString>;
    nextQueuedMessageId: z$1.ZodNullable<z$1.ZodString>;
    groupBoundaryQueuedMessageId: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type ReorderQueuedMessageRequest = z$1.infer<typeof reorderQueuedMessageRequestSchema>;
declare const setQueuedMessageGroupBoundaryRequestSchema: z$1.ZodObject<{
    expectedGroupedPrefixQueuedMessageIds: z$1.ZodArray<z$1.ZodString>;
    groupBoundaryQueuedMessageId: z$1.ZodString;
}, z$1.core.$strip>;
type SetQueuedMessageGroupBoundaryRequest = z$1.infer<typeof setQueuedMessageGroupBoundaryRequestSchema>;
declare const sendQueuedMessageResponseSchema: z$1.ZodObject<{
    ok: z$1.ZodLiteral<true>;
    queuedMessage: z$1.ZodObject<{
        id: z$1.ZodString;
        content: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"text">;
            text: z$1.ZodString;
            mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
                start: z$1.ZodNumber;
                end: z$1.ZodNumber;
                resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"thread">;
                    threadId: z$1.ZodString;
                    projectId: z$1.ZodOptional<z$1.ZodString>;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"project">;
                    projectId: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"section">;
                    sectionId: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"path">;
                    source: z$1.ZodEnum<{
                        workspace: "workspace";
                        "thread-storage": "thread-storage";
                    }>;
                    entryKind: z$1.ZodEnum<{
                        file: "file";
                        directory: "directory";
                    }>;
                    path: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"command">;
                    trigger: z$1.ZodEnum<{
                        "/": "/";
                    }>;
                    name: z$1.ZodString;
                    source: z$1.ZodEnum<{
                        command: "command";
                        skill: "skill";
                    }>;
                    origin: z$1.ZodEnum<{
                        user: "user";
                        project: "project";
                        builtin: "builtin";
                    }>;
                    label: z$1.ZodString;
                    argumentHint: z$1.ZodNullable<z$1.ZodString>;
                }, z$1.core.$strip>, z$1.ZodObject<{
                    kind: z$1.ZodLiteral<"plugin">;
                    pluginId: z$1.ZodString;
                    icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                    itemId: z$1.ZodString;
                    label: z$1.ZodString;
                }, z$1.core.$strip>], "kind">>;
            }, z$1.core.$strip>>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"image">;
            url: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"localImage">;
            path: z$1.ZodString;
        }, z$1.core.$strip>, z$1.ZodObject<{
            visibility: z$1.ZodOptional<z$1.ZodEnum<{
                "agent-only": "agent-only";
            }>>;
            type: z$1.ZodLiteral<"localFile">;
            path: z$1.ZodString;
            name: z$1.ZodOptional<z$1.ZodString>;
            sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
            mimeType: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>], "type">>;
        model: z$1.ZodString;
        reasoningLevel: z$1.ZodEnum<{
            none: "none";
            low: "low";
            medium: "medium";
            high: "high";
            xhigh: "xhigh";
            ultracode: "ultracode";
            max: "max";
            ultra: "ultra";
        }>;
        permissionMode: z$1.ZodEnum<{
            auto: "auto";
            "accept-edits": "accept-edits";
            full: "full";
        }>;
        serviceTier: z$1.ZodEnum<{
            default: "default";
            fast: "fast";
        }>;
        groupWithNext: z$1.ZodBoolean;
        createdAt: z$1.ZodNumber;
        updatedAt: z$1.ZodNumber;
    }, z$1.core.$strip>;
}, z$1.core.$strip>;
type SendQueuedMessageResponse = z$1.infer<typeof sendQueuedMessageResponseSchema>;
declare const threadListResponseSchema: z$1.ZodArray<z$1.ZodObject<{
    id: z$1.ZodString;
    projectId: z$1.ZodString;
    environmentId: z$1.ZodNullable<z$1.ZodString>;
    providerId: z$1.ZodString;
    title: z$1.ZodNullable<z$1.ZodString>;
    titleFallback: z$1.ZodNullable<z$1.ZodString>;
    sectionId: z$1.ZodNullable<z$1.ZodString>;
    status: z$1.ZodEnum<{
        error: "error";
        stopping: "stopping";
        idle: "idle";
        starting: "starting";
        active: "active";
    }>;
    parentThreadId: z$1.ZodNullable<z$1.ZodString>;
    sourceThreadId: z$1.ZodNullable<z$1.ZodString>;
    originKind: z$1.ZodNullable<z$1.ZodEnum<{
        fork: "fork";
    }>>;
    childOrigin: z$1.ZodNullable<z$1.ZodEnum<{
        fork: "fork";
    }>>;
    originPluginId: z$1.ZodNullable<z$1.ZodString>;
    visibility: z$1.ZodEnum<{
        visible: "visible";
        hidden: "hidden";
    }>;
    archivedAt: z$1.ZodNullable<z$1.ZodNumber>;
    pinnedAt: z$1.ZodNullable<z$1.ZodNumber>;
    deletedAt: z$1.ZodNullable<z$1.ZodNumber>;
    lastReadAt: z$1.ZodNullable<z$1.ZodNumber>;
    latestAttentionAt: z$1.ZodNumber;
    createdAt: z$1.ZodNumber;
    updatedAt: z$1.ZodNumber;
    runtime: z$1.ZodObject<{
        displayStatus: z$1.ZodEnum<{
            error: "error";
            provisioning: "provisioning";
            stopping: "stopping";
            idle: "idle";
            starting: "starting";
            active: "active";
            "host-reconnecting": "host-reconnecting";
            "waiting-for-host": "waiting-for-host";
        }>;
        hostReconnectGraceExpiresAt: z$1.ZodNullable<z$1.ZodNumber>;
    }, z$1.core.$strip>;
    activity: z$1.ZodObject<{
        activeWorkflowCount: z$1.ZodNumber;
        activeBackgroundAgentCount: z$1.ZodNumber;
        activeBackgroundCommandCount: z$1.ZodNumber;
        activePlanModeCount: z$1.ZodNumber;
        activeGoalCount: z$1.ZodNumber;
    }, z$1.core.$strip>;
    pinSortKey: z$1.ZodNullable<z$1.ZodString>;
    hasPendingInteraction: z$1.ZodBoolean;
    environmentHostId: z$1.ZodNullable<z$1.ZodString>;
    environmentName: z$1.ZodNullable<z$1.ZodString>;
    environmentBranchName: z$1.ZodNullable<z$1.ZodString>;
    environmentWorkspaceDisplayKind: z$1.ZodEnum<{
        "managed-worktree": "managed-worktree";
        "unmanaged-worktree": "unmanaged-worktree";
        other: "other";
    }>;
}, z$1.core.$strip>>;
type ThreadListResponse = z$1.infer<typeof threadListResponseSchema>;
declare const threadSearchResponseSchema: z$1.ZodObject<{
    active: z$1.ZodObject<{
        total: z$1.ZodNumber;
        results: z$1.ZodArray<z$1.ZodObject<{
            thread: z$1.ZodObject<{
                id: z$1.ZodString;
                projectId: z$1.ZodString;
                environmentId: z$1.ZodNullable<z$1.ZodString>;
                providerId: z$1.ZodString;
                title: z$1.ZodNullable<z$1.ZodString>;
                titleFallback: z$1.ZodNullable<z$1.ZodString>;
                sectionId: z$1.ZodNullable<z$1.ZodString>;
                status: z$1.ZodEnum<{
                    error: "error";
                    stopping: "stopping";
                    idle: "idle";
                    starting: "starting";
                    active: "active";
                }>;
                parentThreadId: z$1.ZodNullable<z$1.ZodString>;
                sourceThreadId: z$1.ZodNullable<z$1.ZodString>;
                originKind: z$1.ZodNullable<z$1.ZodEnum<{
                    fork: "fork";
                }>>;
                childOrigin: z$1.ZodNullable<z$1.ZodEnum<{
                    fork: "fork";
                }>>;
                originPluginId: z$1.ZodNullable<z$1.ZodString>;
                visibility: z$1.ZodEnum<{
                    visible: "visible";
                    hidden: "hidden";
                }>;
                archivedAt: z$1.ZodNullable<z$1.ZodNumber>;
                pinnedAt: z$1.ZodNullable<z$1.ZodNumber>;
                deletedAt: z$1.ZodNullable<z$1.ZodNumber>;
                lastReadAt: z$1.ZodNullable<z$1.ZodNumber>;
                latestAttentionAt: z$1.ZodNumber;
                createdAt: z$1.ZodNumber;
                updatedAt: z$1.ZodNumber;
                runtime: z$1.ZodObject<{
                    displayStatus: z$1.ZodEnum<{
                        error: "error";
                        provisioning: "provisioning";
                        stopping: "stopping";
                        idle: "idle";
                        starting: "starting";
                        active: "active";
                        "host-reconnecting": "host-reconnecting";
                        "waiting-for-host": "waiting-for-host";
                    }>;
                    hostReconnectGraceExpiresAt: z$1.ZodNullable<z$1.ZodNumber>;
                }, z$1.core.$strip>;
                activity: z$1.ZodObject<{
                    activeWorkflowCount: z$1.ZodNumber;
                    activeBackgroundAgentCount: z$1.ZodNumber;
                    activeBackgroundCommandCount: z$1.ZodNumber;
                    activePlanModeCount: z$1.ZodNumber;
                    activeGoalCount: z$1.ZodNumber;
                }, z$1.core.$strip>;
                pinSortKey: z$1.ZodNullable<z$1.ZodString>;
                hasPendingInteraction: z$1.ZodBoolean;
                environmentHostId: z$1.ZodNullable<z$1.ZodString>;
                environmentName: z$1.ZodNullable<z$1.ZodString>;
                environmentBranchName: z$1.ZodNullable<z$1.ZodString>;
                environmentWorkspaceDisplayKind: z$1.ZodEnum<{
                    "managed-worktree": "managed-worktree";
                    "unmanaged-worktree": "unmanaged-worktree";
                    other: "other";
                }>;
            }, z$1.core.$strip>;
            matches: z$1.ZodArray<z$1.ZodObject<{
                sourceKind: z$1.ZodEnum<{
                    title: "title";
                    title_fallback: "title_fallback";
                    user_message: "user_message";
                    assistant_message: "assistant_message";
                    system_message: "system_message";
                }>;
                text: z$1.ZodString;
                highlightRanges: z$1.ZodArray<z$1.ZodObject<{
                    start: z$1.ZodNumber;
                    end: z$1.ZodNumber;
                }, z$1.core.$strict>>;
                sourceSeq: z$1.ZodNullable<z$1.ZodNumber>;
            }, z$1.core.$strict>>;
        }, z$1.core.$strict>>;
    }, z$1.core.$strict>;
    archived: z$1.ZodObject<{
        total: z$1.ZodNumber;
        results: z$1.ZodArray<z$1.ZodObject<{
            thread: z$1.ZodObject<{
                id: z$1.ZodString;
                projectId: z$1.ZodString;
                environmentId: z$1.ZodNullable<z$1.ZodString>;
                providerId: z$1.ZodString;
                title: z$1.ZodNullable<z$1.ZodString>;
                titleFallback: z$1.ZodNullable<z$1.ZodString>;
                sectionId: z$1.ZodNullable<z$1.ZodString>;
                status: z$1.ZodEnum<{
                    error: "error";
                    stopping: "stopping";
                    idle: "idle";
                    starting: "starting";
                    active: "active";
                }>;
                parentThreadId: z$1.ZodNullable<z$1.ZodString>;
                sourceThreadId: z$1.ZodNullable<z$1.ZodString>;
                originKind: z$1.ZodNullable<z$1.ZodEnum<{
                    fork: "fork";
                }>>;
                childOrigin: z$1.ZodNullable<z$1.ZodEnum<{
                    fork: "fork";
                }>>;
                originPluginId: z$1.ZodNullable<z$1.ZodString>;
                visibility: z$1.ZodEnum<{
                    visible: "visible";
                    hidden: "hidden";
                }>;
                archivedAt: z$1.ZodNullable<z$1.ZodNumber>;
                pinnedAt: z$1.ZodNullable<z$1.ZodNumber>;
                deletedAt: z$1.ZodNullable<z$1.ZodNumber>;
                lastReadAt: z$1.ZodNullable<z$1.ZodNumber>;
                latestAttentionAt: z$1.ZodNumber;
                createdAt: z$1.ZodNumber;
                updatedAt: z$1.ZodNumber;
                runtime: z$1.ZodObject<{
                    displayStatus: z$1.ZodEnum<{
                        error: "error";
                        provisioning: "provisioning";
                        stopping: "stopping";
                        idle: "idle";
                        starting: "starting";
                        active: "active";
                        "host-reconnecting": "host-reconnecting";
                        "waiting-for-host": "waiting-for-host";
                    }>;
                    hostReconnectGraceExpiresAt: z$1.ZodNullable<z$1.ZodNumber>;
                }, z$1.core.$strip>;
                activity: z$1.ZodObject<{
                    activeWorkflowCount: z$1.ZodNumber;
                    activeBackgroundAgentCount: z$1.ZodNumber;
                    activeBackgroundCommandCount: z$1.ZodNumber;
                    activePlanModeCount: z$1.ZodNumber;
                    activeGoalCount: z$1.ZodNumber;
                }, z$1.core.$strip>;
                pinSortKey: z$1.ZodNullable<z$1.ZodString>;
                hasPendingInteraction: z$1.ZodBoolean;
                environmentHostId: z$1.ZodNullable<z$1.ZodString>;
                environmentName: z$1.ZodNullable<z$1.ZodString>;
                environmentBranchName: z$1.ZodNullable<z$1.ZodString>;
                environmentWorkspaceDisplayKind: z$1.ZodEnum<{
                    "managed-worktree": "managed-worktree";
                    "unmanaged-worktree": "unmanaged-worktree";
                    other: "other";
                }>;
            }, z$1.core.$strip>;
            matches: z$1.ZodArray<z$1.ZodObject<{
                sourceKind: z$1.ZodEnum<{
                    title: "title";
                    title_fallback: "title_fallback";
                    user_message: "user_message";
                    assistant_message: "assistant_message";
                    system_message: "system_message";
                }>;
                text: z$1.ZodString;
                highlightRanges: z$1.ZodArray<z$1.ZodObject<{
                    start: z$1.ZodNumber;
                    end: z$1.ZodNumber;
                }, z$1.core.$strict>>;
                sourceSeq: z$1.ZodNullable<z$1.ZodNumber>;
            }, z$1.core.$strict>>;
        }, z$1.core.$strict>>;
    }, z$1.core.$strict>;
}, z$1.core.$strict>;
type ThreadSearchResponse = z$1.infer<typeof threadSearchResponseSchema>;
declare const threadResponseSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    projectId: z$1.ZodString;
    environmentId: z$1.ZodNullable<z$1.ZodString>;
    providerId: z$1.ZodString;
    title: z$1.ZodNullable<z$1.ZodString>;
    titleFallback: z$1.ZodNullable<z$1.ZodString>;
    sectionId: z$1.ZodNullable<z$1.ZodString>;
    status: z$1.ZodEnum<{
        error: "error";
        stopping: "stopping";
        idle: "idle";
        starting: "starting";
        active: "active";
    }>;
    parentThreadId: z$1.ZodNullable<z$1.ZodString>;
    sourceThreadId: z$1.ZodNullable<z$1.ZodString>;
    originKind: z$1.ZodNullable<z$1.ZodEnum<{
        fork: "fork";
    }>>;
    childOrigin: z$1.ZodNullable<z$1.ZodEnum<{
        fork: "fork";
    }>>;
    originPluginId: z$1.ZodNullable<z$1.ZodString>;
    visibility: z$1.ZodEnum<{
        visible: "visible";
        hidden: "hidden";
    }>;
    archivedAt: z$1.ZodNullable<z$1.ZodNumber>;
    pinnedAt: z$1.ZodNullable<z$1.ZodNumber>;
    deletedAt: z$1.ZodNullable<z$1.ZodNumber>;
    lastReadAt: z$1.ZodNullable<z$1.ZodNumber>;
    latestAttentionAt: z$1.ZodNumber;
    createdAt: z$1.ZodNumber;
    updatedAt: z$1.ZodNumber;
    runtime: z$1.ZodObject<{
        displayStatus: z$1.ZodEnum<{
            error: "error";
            provisioning: "provisioning";
            stopping: "stopping";
            idle: "idle";
            starting: "starting";
            active: "active";
            "host-reconnecting": "host-reconnecting";
            "waiting-for-host": "waiting-for-host";
        }>;
        hostReconnectGraceExpiresAt: z$1.ZodNullable<z$1.ZodNumber>;
    }, z$1.core.$strip>;
    activeBackgroundAgentCount: z$1.ZodNumber;
    canSpawnChild: z$1.ZodBoolean;
}, z$1.core.$strip>;
type ThreadResponse = z$1.infer<typeof threadResponseSchema>;
declare const threadGetQuerySchema: z$1.ZodObject<{
    include: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type ThreadGetQuery = z$1.infer<typeof threadGetQuerySchema>;
declare const threadWithIncludesResponseSchema: z$1.ZodObject<{
    id: z$1.ZodString;
    projectId: z$1.ZodString;
    environmentId: z$1.ZodNullable<z$1.ZodString>;
    providerId: z$1.ZodString;
    title: z$1.ZodNullable<z$1.ZodString>;
    titleFallback: z$1.ZodNullable<z$1.ZodString>;
    sectionId: z$1.ZodNullable<z$1.ZodString>;
    status: z$1.ZodEnum<{
        error: "error";
        stopping: "stopping";
        idle: "idle";
        starting: "starting";
        active: "active";
    }>;
    parentThreadId: z$1.ZodNullable<z$1.ZodString>;
    sourceThreadId: z$1.ZodNullable<z$1.ZodString>;
    originKind: z$1.ZodNullable<z$1.ZodEnum<{
        fork: "fork";
    }>>;
    childOrigin: z$1.ZodNullable<z$1.ZodEnum<{
        fork: "fork";
    }>>;
    originPluginId: z$1.ZodNullable<z$1.ZodString>;
    visibility: z$1.ZodEnum<{
        visible: "visible";
        hidden: "hidden";
    }>;
    archivedAt: z$1.ZodNullable<z$1.ZodNumber>;
    pinnedAt: z$1.ZodNullable<z$1.ZodNumber>;
    deletedAt: z$1.ZodNullable<z$1.ZodNumber>;
    lastReadAt: z$1.ZodNullable<z$1.ZodNumber>;
    latestAttentionAt: z$1.ZodNumber;
    createdAt: z$1.ZodNumber;
    updatedAt: z$1.ZodNumber;
    runtime: z$1.ZodObject<{
        displayStatus: z$1.ZodEnum<{
            error: "error";
            provisioning: "provisioning";
            stopping: "stopping";
            idle: "idle";
            starting: "starting";
            active: "active";
            "host-reconnecting": "host-reconnecting";
            "waiting-for-host": "waiting-for-host";
        }>;
        hostReconnectGraceExpiresAt: z$1.ZodNullable<z$1.ZodNumber>;
    }, z$1.core.$strip>;
    activeBackgroundAgentCount: z$1.ZodNumber;
    canSpawnChild: z$1.ZodBoolean;
    environment: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodObject<{
        id: z$1.ZodString;
        name: z$1.ZodNullable<z$1.ZodString>;
        projectId: z$1.ZodString;
        hostId: z$1.ZodString;
        path: z$1.ZodNullable<z$1.ZodString>;
        managed: z$1.ZodBoolean;
        isGitRepo: z$1.ZodBoolean;
        isWorktree: z$1.ZodBoolean;
        workspaceProvisionType: z$1.ZodEnum<{
            unmanaged: "unmanaged";
            "managed-worktree": "managed-worktree";
            personal: "personal";
        }>;
        branchName: z$1.ZodNullable<z$1.ZodString>;
        baseBranch: z$1.ZodNullable<z$1.ZodString>;
        defaultBranch: z$1.ZodNullable<z$1.ZodString>;
        mergeBaseBranch: z$1.ZodNullable<z$1.ZodString>;
        status: z$1.ZodEnum<{
            error: "error";
            provisioning: "provisioning";
            ready: "ready";
            retiring: "retiring";
            destroying: "destroying";
            destroyed: "destroyed";
        }>;
        createdAt: z$1.ZodNumber;
        updatedAt: z$1.ZodNumber;
    }, z$1.core.$strip>>>;
    host: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodObject<{
        id: z$1.ZodString;
        name: z$1.ZodString;
        type: z$1.ZodEnum<{
            persistent: "persistent";
        }>;
        status: z$1.ZodEnum<{
            disconnected: "disconnected";
            connected: "connected";
        }>;
        maxPermissionMode: z$1.ZodEnum<{
            auto: "auto";
            "accept-edits": "accept-edits";
            full: "full";
        }>;
        lastSeenAt: z$1.ZodNullable<z$1.ZodNumber>;
        lastRejectedProtocolVersion: z$1.ZodNullable<z$1.ZodNumber>;
        createdAt: z$1.ZodNumber;
        updatedAt: z$1.ZodNumber;
    }, z$1.core.$strip>>>;
}, z$1.core.$strip>;
type ThreadWithIncludesResponse = z$1.infer<typeof threadWithIncludesResponseSchema>;
declare const threadPendingInteractionsResponseSchema: z$1.ZodArray<z$1.ZodUnion<readonly [z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    status: z$1.ZodEnum<{
        pending: "pending";
        interrupted: "interrupted";
        resolving: "resolving";
        resolved: "resolved";
    }>;
    statusReason: z$1.ZodNullable<z$1.ZodString>;
    createdAt: z$1.ZodNumber;
    expiresAt: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodNumber>>;
    resolvedAt: z$1.ZodNullable<z$1.ZodNumber>;
    turnId: z$1.ZodString;
    providerId: z$1.ZodString;
    providerThreadId: z$1.ZodString;
    providerRequestId: z$1.ZodString;
    origin: z$1.ZodOptional<z$1.ZodObject<{
        kind: z$1.ZodLiteral<"provider">;
        providerId: z$1.ZodString;
        providerThreadId: z$1.ZodString;
        providerRequestId: z$1.ZodString;
    }, z$1.core.$strip>>;
    payload: z$1.ZodUnion<readonly [z$1.ZodObject<{
        kind: z$1.ZodLiteral<"approval">;
        subject: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"command">;
            itemId: z$1.ZodString;
            command: z$1.ZodString;
            cwd: z$1.ZodNullable<z$1.ZodString>;
            actions: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                type: z$1.ZodLiteral<"read">;
                command: z$1.ZodString;
                name: z$1.ZodString;
                path: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                type: z$1.ZodLiteral<"listFiles">;
                command: z$1.ZodString;
                path: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                type: z$1.ZodLiteral<"search">;
                command: z$1.ZodString;
                query: z$1.ZodNullable<z$1.ZodString>;
                path: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                type: z$1.ZodLiteral<"unknown">;
                command: z$1.ZodString;
            }, z$1.core.$strip>], "type">>;
            sessionGrant: z$1.ZodNullable<z$1.ZodObject<{
                network: z$1.ZodNullable<z$1.ZodObject<{
                    enabled: z$1.ZodNullable<z$1.ZodBoolean>;
                }, z$1.core.$strip>>;
                fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                    read: z$1.ZodArray<z$1.ZodString>;
                    write: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strip>>;
            }, z$1.core.$strict>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"file_change">;
            itemId: z$1.ZodString;
            writeScope: z$1.ZodNullable<z$1.ZodString>;
            sessionGrant: z$1.ZodNullable<z$1.ZodObject<{
                network: z$1.ZodNullable<z$1.ZodObject<{
                    enabled: z$1.ZodNullable<z$1.ZodBoolean>;
                }, z$1.core.$strip>>;
                fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                    read: z$1.ZodArray<z$1.ZodString>;
                    write: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strip>>;
            }, z$1.core.$strict>>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"permission_grant">;
            itemId: z$1.ZodString;
            toolName: z$1.ZodNullable<z$1.ZodString>;
            permissions: z$1.ZodObject<{
                network: z$1.ZodNullable<z$1.ZodObject<{
                    enabled: z$1.ZodNullable<z$1.ZodBoolean>;
                }, z$1.core.$strip>>;
                fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                    read: z$1.ZodArray<z$1.ZodString>;
                    write: z$1.ZodArray<z$1.ZodString>;
                }, z$1.core.$strip>>;
            }, z$1.core.$strict>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"plan">;
            itemId: z$1.ZodString;
            plan: z$1.ZodString;
            planFilePath: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"mcp_tool_call">;
            serverName: z$1.ZodString;
            message: z$1.ZodString;
            toolDescription: z$1.ZodNullable<z$1.ZodString>;
        }, z$1.core.$strip>], "kind">;
        reason: z$1.ZodNullable<z$1.ZodString>;
        availableDecisions: z$1.ZodArray<z$1.ZodEnum<{
            allow_once: "allow_once";
            allow_for_session: "allow_for_session";
            deny: "deny";
        }>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"user_question">;
        questions: z$1.ZodArray<z$1.ZodObject<{
            id: z$1.ZodString;
            prompt: z$1.ZodString;
            shortLabel: z$1.ZodOptional<z$1.ZodString>;
            multiSelect: z$1.ZodBoolean;
            options: z$1.ZodOptional<z$1.ZodArray<z$1.ZodObject<{
                value: z$1.ZodString;
                label: z$1.ZodString;
                description: z$1.ZodOptional<z$1.ZodString>;
            }, z$1.core.$strip>>>;
            allowFreeText: z$1.ZodBoolean;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>]>;
    resolution: z$1.ZodNullable<z$1.ZodUnion<readonly [z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        decision: z$1.ZodLiteral<"allow_once">;
        grantedPermissions: z$1.ZodNullable<z$1.ZodObject<{
            network: z$1.ZodNullable<z$1.ZodObject<{
                enabled: z$1.ZodNullable<z$1.ZodBoolean>;
            }, z$1.core.$strip>>;
            fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                read: z$1.ZodArray<z$1.ZodString>;
                write: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strict>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        decision: z$1.ZodLiteral<"allow_for_session">;
        grantedPermissions: z$1.ZodNullable<z$1.ZodObject<{
            network: z$1.ZodNullable<z$1.ZodObject<{
                enabled: z$1.ZodNullable<z$1.ZodBoolean>;
            }, z$1.core.$strip>>;
            fileSystem: z$1.ZodNullable<z$1.ZodObject<{
                read: z$1.ZodArray<z$1.ZodString>;
                write: z$1.ZodArray<z$1.ZodString>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strict>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        decision: z$1.ZodLiteral<"deny">;
    }, z$1.core.$strip>], "decision">, z$1.ZodObject<{
        kind: z$1.ZodLiteral<"user_answer">;
        answers: z$1.ZodRecord<z$1.ZodString, z$1.ZodObject<{
            selected: z$1.ZodArray<z$1.ZodString>;
            freeText: z$1.ZodOptional<z$1.ZodString>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>]>>;
}, z$1.core.$strip>, z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    status: z$1.ZodEnum<{
        pending: "pending";
        interrupted: "interrupted";
        resolving: "resolving";
        resolved: "resolved";
    }>;
    statusReason: z$1.ZodNullable<z$1.ZodString>;
    createdAt: z$1.ZodNumber;
    expiresAt: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodNumber>>;
    resolvedAt: z$1.ZodNullable<z$1.ZodNumber>;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    origin: z$1.ZodObject<{
        kind: z$1.ZodLiteral<"plugin">;
        pluginId: z$1.ZodString;
        rendererId: z$1.ZodString;
    }, z$1.core.$strip>;
    payload: z$1.ZodObject<{
        kind: z$1.ZodLiteral<"plugin">;
        title: z$1.ZodString;
        data: z$1.ZodType<JsonValue$1, unknown, z$1.core.$ZodTypeInternals<JsonValue$1, unknown>>;
    }, z$1.core.$strip>;
    resolution: z$1.ZodNullable<z$1.ZodObject<{
        kind: z$1.ZodLiteral<"plugin_submitted">;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>, z$1.ZodObject<{
    id: z$1.ZodString;
    threadId: z$1.ZodString;
    status: z$1.ZodEnum<{
        pending: "pending";
        interrupted: "interrupted";
        resolving: "resolving";
        resolved: "resolved";
    }>;
    statusReason: z$1.ZodNullable<z$1.ZodString>;
    createdAt: z$1.ZodNumber;
    expiresAt: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodNumber>>;
    resolvedAt: z$1.ZodNullable<z$1.ZodNumber>;
    turnId: z$1.ZodNullable<z$1.ZodString>;
    origin: z$1.ZodObject<{
        kind: z$1.ZodLiteral<"server">;
    }, z$1.core.$strip>;
    payload: z$1.ZodObject<{
        kind: z$1.ZodLiteral<"consent">;
        action: z$1.ZodEnum<{
            update: "update";
            install: "install";
            enable: "enable";
            disable: "disable";
            remove: "remove";
            configure: "configure";
            "run-setup-script": "run-setup-script";
            "move-workspace": "move-workspace";
        }>;
        subjectId: z$1.ZodString;
        subjectName: z$1.ZodString;
        permissions: z$1.ZodArray<z$1.ZodString>;
        sites: z$1.ZodArray<z$1.ZodString>;
        detail: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strip>;
    resolution: z$1.ZodNullable<z$1.ZodObject<{
        kind: z$1.ZodLiteral<"consent_decided">;
        approved: z$1.ZodBoolean;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>]>>;
type ThreadPendingInteractionsResponse = z$1.infer<typeof threadPendingInteractionsResponseSchema>;
declare const threadQueuedMessageListResponseSchema: z$1.ZodArray<z$1.ZodObject<{
    id: z$1.ZodString;
    content: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"text">;
        text: z$1.ZodString;
        mentions: z$1.ZodDefault<z$1.ZodArray<z$1.ZodObject<{
            start: z$1.ZodNumber;
            end: z$1.ZodNumber;
            resource: z$1.ZodPipe<z$1.ZodTransform<unknown, unknown>, z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
                kind: z$1.ZodLiteral<"thread">;
                threadId: z$1.ZodString;
                projectId: z$1.ZodOptional<z$1.ZodString>;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"project">;
                projectId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"section">;
                sectionId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"path">;
                source: z$1.ZodEnum<{
                    workspace: "workspace";
                    "thread-storage": "thread-storage";
                }>;
                entryKind: z$1.ZodEnum<{
                    file: "file";
                    directory: "directory";
                }>;
                path: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"command">;
                trigger: z$1.ZodEnum<{
                    "/": "/";
                }>;
                name: z$1.ZodString;
                source: z$1.ZodEnum<{
                    command: "command";
                    skill: "skill";
                }>;
                origin: z$1.ZodEnum<{
                    user: "user";
                    project: "project";
                    builtin: "builtin";
                }>;
                label: z$1.ZodString;
                argumentHint: z$1.ZodNullable<z$1.ZodString>;
            }, z$1.core.$strip>, z$1.ZodObject<{
                kind: z$1.ZodLiteral<"plugin">;
                pluginId: z$1.ZodString;
                icon: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
                itemId: z$1.ZodString;
                label: z$1.ZodString;
            }, z$1.core.$strip>], "kind">>;
        }, z$1.core.$strip>>>;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"image">;
        url: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localImage">;
        path: z$1.ZodString;
    }, z$1.core.$strip>, z$1.ZodObject<{
        visibility: z$1.ZodOptional<z$1.ZodEnum<{
            "agent-only": "agent-only";
        }>>;
        type: z$1.ZodLiteral<"localFile">;
        path: z$1.ZodString;
        name: z$1.ZodOptional<z$1.ZodString>;
        sizeBytes: z$1.ZodOptional<z$1.ZodNumber>;
        mimeType: z$1.ZodOptional<z$1.ZodString>;
    }, z$1.core.$strip>], "type">>;
    model: z$1.ZodString;
    reasoningLevel: z$1.ZodEnum<{
        none: "none";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        ultracode: "ultracode";
        max: "max";
        ultra: "ultra";
    }>;
    permissionMode: z$1.ZodEnum<{
        auto: "auto";
        "accept-edits": "accept-edits";
        full: "full";
    }>;
    serviceTier: z$1.ZodEnum<{
        default: "default";
        fast: "fast";
    }>;
    groupWithNext: z$1.ZodBoolean;
    createdAt: z$1.ZodNumber;
    updatedAt: z$1.ZodNumber;
}, z$1.core.$strip>>;
type ThreadQueuedMessageListResponse = z$1.infer<typeof threadQueuedMessageListResponseSchema>;
declare const threadChildSummaryResponseSchema: z$1.ZodObject<{
    nonDeletedChildCount: z$1.ZodNumber;
}, z$1.core.$strip>;
type ThreadChildSummaryResponse = z$1.infer<typeof threadChildSummaryResponseSchema>;
declare const deleteThreadRequestSchema: z$1.ZodObject<{
    childThreadsConfirmed: z$1.ZodBoolean;
}, z$1.core.$strip>;
type DeleteThreadRequest = z$1.infer<typeof deleteThreadRequestSchema>;
declare const updateThreadRequestSchema: z$1.ZodObject<{
    title: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
    sectionId: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
    parentThreadId: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
    model: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodString>>;
    reasoningLevel: z$1.ZodOptional<z$1.ZodNullable<z$1.ZodEnum<{
        none: "none";
        low: "low";
        medium: "medium";
        high: "high";
        xhigh: "xhigh";
        ultracode: "ultracode";
        max: "max";
        ultra: "ultra";
    }>>>;
    visibility: z$1.ZodOptional<z$1.ZodEnum<{
        visible: "visible";
        hidden: "hidden";
    }>>;
}, z$1.core.$strip>;
type UpdateThreadRequest = z$1.infer<typeof updateThreadRequestSchema>;
declare const reorderPinnedThreadRequestSchema: z$1.ZodObject<{
    previousThreadId: z$1.ZodNullable<z$1.ZodString>;
    nextThreadId: z$1.ZodNullable<z$1.ZodString>;
}, z$1.core.$strip>;
type ReorderPinnedThreadRequest = z$1.infer<typeof reorderPinnedThreadRequestSchema>;
/**
 * Requested placement for a thread opened in the app's split layout. Edge
 * placements add panes through the eighth pane; at the cap they replace the
 * focused pane. `replace` always replaces the focused pane.
 */
declare const threadOpenSplitSchema: z$1.ZodEnum<{
    left: "left";
    right: "right";
    down: "down";
    top: "top";
    replace: "replace";
}>;
type ThreadOpenSplit = z$1.infer<typeof threadOpenSplitSchema>;
/** Optional secondary-panel file to open with a thread. */
declare const threadOpenFileSchema: z$1.ZodObject<{
    source: z$1.ZodEnum<{
        workspace: "workspace";
        "thread-storage": "thread-storage";
    }>;
    path: z$1.ZodString;
    lineNumber: z$1.ZodNullable<z$1.ZodNumber>;
}, z$1.core.$strict>;
type ThreadOpenFile = z$1.infer<typeof threadOpenFileSchema>;
/** Response for POST /threads/:id/open: how many connected clients received it. */
declare const threadOpenResponseSchema: z$1.ZodObject<{
    delivered: z$1.ZodNumber;
}, z$1.core.$strip>;
type ThreadOpenResponse = z$1.infer<typeof threadOpenResponseSchema>;
/** Presentation action for one thread pane in each connected app window. */
declare const threadPaneActionSchema: z$1.ZodEnum<{
    maximize: "maximize";
    restore: "restore";
    toggle: "toggle";
}>;
type ThreadPaneAction = z$1.infer<typeof threadPaneActionSchema>;
/** Number of connected app clients that received the pane action. */
declare const threadPaneActionResponseSchema: z$1.ZodObject<{
    delivered: z$1.ZodNumber;
}, z$1.core.$strip>;
type ThreadPaneActionResponse = z$1.infer<typeof threadPaneActionResponseSchema>;
declare const threadArchiveAllResponseSchema: z$1.ZodObject<{
    ok: z$1.ZodLiteral<true>;
    archivedThreadIds: z$1.ZodArray<z$1.ZodString>;
}, z$1.core.$strip>;
type ThreadArchiveAllResponse = z$1.infer<typeof threadArchiveAllResponseSchema>;
declare const threadListQuerySchema: z$1.ZodObject<{
    projectId: z$1.ZodOptional<z$1.ZodString>;
    parentThreadId: z$1.ZodOptional<z$1.ZodString>;
    sourceThreadId: z$1.ZodOptional<z$1.ZodString>;
    archived: z$1.ZodOptional<z$1.ZodEnum<{
        true: "true";
        false: "false";
    }>>;
    sectionId: z$1.ZodOptional<z$1.ZodString>;
    unsectioned: z$1.ZodOptional<z$1.ZodEnum<{
        true: "true";
        false: "false";
    }>>;
    hasParent: z$1.ZodOptional<z$1.ZodEnum<{
        true: "true";
        false: "false";
    }>>;
    originKind: z$1.ZodOptional<z$1.ZodEnum<{
        fork: "fork";
    }>>;
    originPluginId: z$1.ZodOptional<z$1.ZodString>;
    childOrigin: z$1.ZodOptional<z$1.ZodEnum<{
        fork: "fork";
    }>>;
    includeHidden: z$1.ZodOptional<z$1.ZodEnum<{
        true: "true";
        false: "false";
    }>>;
    limit: z$1.ZodOptional<z$1.ZodString>;
    offset: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type ThreadListQuery = z$1.infer<typeof threadListQuerySchema>;
declare const threadSearchQuerySchema: z$1.ZodObject<{
    query: z$1.ZodString;
    limitPerGroup: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type ThreadSearchQuery = z$1.infer<typeof threadSearchQuerySchema>;
declare const threadTimelineQuerySchema: z$1.ZodObject<{
    includeNestedRows: z$1.ZodOptional<z$1.ZodEnum<{
        true: "true";
        false: "false";
    }>>;
    segmentLimit: z$1.ZodOptional<z$1.ZodString>;
    beforeAnchorSeq: z$1.ZodOptional<z$1.ZodString>;
    beforeAnchorId: z$1.ZodOptional<z$1.ZodString>;
    summaryOnly: z$1.ZodOptional<z$1.ZodEnum<{
        true: "true";
        false: "false";
    }>>;
    afterSequence: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type ThreadTimelineQuery = z$1.infer<typeof threadTimelineQuerySchema>;
declare const timelineTurnSummaryDetailsQuerySchema: z$1.ZodObject<{
    turnId: z$1.ZodString;
    sourceSeqStart: z$1.ZodString;
    sourceSeqEnd: z$1.ZodString;
}, z$1.core.$strip>;
type TimelineTurnSummaryDetailsQuery = z$1.infer<typeof timelineTurnSummaryDetailsQuerySchema>;
declare const threadStorageFilesQuerySchema: z$1.ZodObject<{
    query: z$1.ZodOptional<z$1.ZodString>;
    limit: z$1.ZodOptional<z$1.ZodString>;
}, z$1.core.$strip>;
type ThreadStorageFilesQuery = z$1.infer<typeof threadStorageFilesQuerySchema>;
declare const threadStoragePathsQuerySchema: z$1.ZodObject<{
    query: z$1.ZodOptional<z$1.ZodString>;
    limit: z$1.ZodOptional<z$1.ZodString>;
    includeFiles: z$1.ZodEnum<{
        true: "true";
        false: "false";
    }>;
    includeDirectories: z$1.ZodEnum<{
        true: "true";
        false: "false";
    }>;
}, z$1.core.$strip>;
type ThreadStoragePathsQuery = z$1.infer<typeof threadStoragePathsQuerySchema>;
declare const timelineTurnSummaryDetailsResponseSchema: z$1.ZodObject<{
    rows: z$1.ZodArray<z$1.ZodType<TimelineRow, unknown, z$1.core.$ZodTypeInternals<TimelineRow, unknown>>>;
}, z$1.core.$strip>;
type TimelineTurnSummaryDetailsResponse = z$1.infer<typeof timelineTurnSummaryDetailsResponseSchema>;
declare const threadTimelineResponseSchema: z$1.ZodObject<{
    rows: z$1.ZodArray<z$1.ZodType<TimelineRow, unknown, z$1.core.$ZodTypeInternals<TimelineRow, unknown>>>;
    activePromptMode: z$1.ZodNullable<z$1.ZodObject<{
        mode: z$1.ZodLiteral<"plan">;
        providerId: z$1.ZodEnum<{
            "claude-code": "claude-code";
            codex: "codex";
        }>;
        prompt: z$1.ZodString;
    }, z$1.core.$strict>>;
    activeThinking: z$1.ZodNullable<z$1.ZodObject<{
        id: z$1.ZodString;
        text: z$1.ZodString;
        startedAt: z$1.ZodNumber;
        updatedAt: z$1.ZodNumber;
    }, z$1.core.$strip>>;
    activeWorkflows: z$1.ZodArray<z$1.ZodObject<{
        id: z$1.ZodString;
        threadId: z$1.ZodString;
        turnId: z$1.ZodNullable<z$1.ZodString>;
        sourceSeqStart: z$1.ZodNumber;
        sourceSeqEnd: z$1.ZodNumber;
        startedAt: z$1.ZodNumber;
        createdAt: z$1.ZodNumber;
        kind: z$1.ZodLiteral<"work">;
        status: z$1.ZodEnum<{
            error: "error";
            pending: "pending";
            completed: "completed";
            interrupted: "interrupted";
        }>;
        workKind: z$1.ZodLiteral<"workflow">;
        itemId: z$1.ZodString;
        taskType: z$1.ZodString;
        workflowName: z$1.ZodNullable<z$1.ZodString>;
        description: z$1.ZodString;
        taskStatus: z$1.ZodEnum<{
            pending: "pending";
            completed: "completed";
            running: "running";
            paused: "paused";
            failed: "failed";
            killed: "killed";
            stopped: "stopped";
        }>;
        workflow: z$1.ZodNullable<z$1.ZodObject<{
            phases: z$1.ZodArray<z$1.ZodObject<{
                index: z$1.ZodNumber;
                title: z$1.ZodString;
                kind: z$1.ZodOptional<z$1.ZodString>;
            }, z$1.core.$strip>>;
            agents: z$1.ZodArray<z$1.ZodObject<{
                index: z$1.ZodNumber;
                label: z$1.ZodString;
                state: z$1.ZodEnum<{
                    running: "running";
                    failed: "failed";
                    queued: "queued";
                    done: "done";
                    skipped: "skipped";
                }>;
                model: z$1.ZodString;
                attempt: z$1.ZodNumber;
                cached: z$1.ZodBoolean;
                lastProgressAt: z$1.ZodNumber;
                phaseIndex: z$1.ZodOptional<z$1.ZodNumber>;
                phaseTitle: z$1.ZodOptional<z$1.ZodString>;
                agentType: z$1.ZodOptional<z$1.ZodString>;
                isolation: z$1.ZodOptional<z$1.ZodString>;
                queuedAt: z$1.ZodOptional<z$1.ZodNumber>;
                startedAt: z$1.ZodOptional<z$1.ZodNumber>;
                lastToolName: z$1.ZodOptional<z$1.ZodString>;
                lastToolSummary: z$1.ZodOptional<z$1.ZodString>;
                promptPreview: z$1.ZodOptional<z$1.ZodString>;
                resultPreview: z$1.ZodOptional<z$1.ZodString>;
                error: z$1.ZodOptional<z$1.ZodString>;
                tokens: z$1.ZodOptional<z$1.ZodNumber>;
                toolCalls: z$1.ZodOptional<z$1.ZodNumber>;
                durationMs: z$1.ZodOptional<z$1.ZodNumber>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
        usage: z$1.ZodNullable<z$1.ZodObject<{
            totalTokens: z$1.ZodNumber;
            toolUses: z$1.ZodNumber;
            durationMs: z$1.ZodNumber;
        }, z$1.core.$strip>>;
        summary: z$1.ZodNullable<z$1.ZodString>;
        error: z$1.ZodNullable<z$1.ZodString>;
        completedAt: z$1.ZodNullable<z$1.ZodNumber>;
    }, z$1.core.$strip>>;
    activeBackgroundCommands: z$1.ZodArray<z$1.ZodObject<{
        id: z$1.ZodString;
        threadId: z$1.ZodString;
        turnId: z$1.ZodNullable<z$1.ZodString>;
        sourceSeqStart: z$1.ZodNumber;
        sourceSeqEnd: z$1.ZodNumber;
        startedAt: z$1.ZodNumber;
        createdAt: z$1.ZodNumber;
        kind: z$1.ZodLiteral<"work">;
        status: z$1.ZodEnum<{
            error: "error";
            pending: "pending";
            completed: "completed";
            interrupted: "interrupted";
        }>;
        workKind: z$1.ZodLiteral<"workflow">;
        itemId: z$1.ZodString;
        taskType: z$1.ZodString;
        workflowName: z$1.ZodNullable<z$1.ZodString>;
        description: z$1.ZodString;
        taskStatus: z$1.ZodEnum<{
            pending: "pending";
            completed: "completed";
            running: "running";
            paused: "paused";
            failed: "failed";
            killed: "killed";
            stopped: "stopped";
        }>;
        workflow: z$1.ZodNullable<z$1.ZodObject<{
            phases: z$1.ZodArray<z$1.ZodObject<{
                index: z$1.ZodNumber;
                title: z$1.ZodString;
                kind: z$1.ZodOptional<z$1.ZodString>;
            }, z$1.core.$strip>>;
            agents: z$1.ZodArray<z$1.ZodObject<{
                index: z$1.ZodNumber;
                label: z$1.ZodString;
                state: z$1.ZodEnum<{
                    running: "running";
                    failed: "failed";
                    queued: "queued";
                    done: "done";
                    skipped: "skipped";
                }>;
                model: z$1.ZodString;
                attempt: z$1.ZodNumber;
                cached: z$1.ZodBoolean;
                lastProgressAt: z$1.ZodNumber;
                phaseIndex: z$1.ZodOptional<z$1.ZodNumber>;
                phaseTitle: z$1.ZodOptional<z$1.ZodString>;
                agentType: z$1.ZodOptional<z$1.ZodString>;
                isolation: z$1.ZodOptional<z$1.ZodString>;
                queuedAt: z$1.ZodOptional<z$1.ZodNumber>;
                startedAt: z$1.ZodOptional<z$1.ZodNumber>;
                lastToolName: z$1.ZodOptional<z$1.ZodString>;
                lastToolSummary: z$1.ZodOptional<z$1.ZodString>;
                promptPreview: z$1.ZodOptional<z$1.ZodString>;
                resultPreview: z$1.ZodOptional<z$1.ZodString>;
                error: z$1.ZodOptional<z$1.ZodString>;
                tokens: z$1.ZodOptional<z$1.ZodNumber>;
                toolCalls: z$1.ZodOptional<z$1.ZodNumber>;
                durationMs: z$1.ZodOptional<z$1.ZodNumber>;
            }, z$1.core.$strip>>;
        }, z$1.core.$strip>>;
        usage: z$1.ZodNullable<z$1.ZodObject<{
            totalTokens: z$1.ZodNumber;
            toolUses: z$1.ZodNumber;
            durationMs: z$1.ZodNumber;
        }, z$1.core.$strip>>;
        summary: z$1.ZodNullable<z$1.ZodString>;
        error: z$1.ZodNullable<z$1.ZodString>;
        completedAt: z$1.ZodNullable<z$1.ZodNumber>;
    }, z$1.core.$strip>>;
    pendingTodos: z$1.ZodNullable<z$1.ZodObject<{
        sourceSeq: z$1.ZodNumber;
        updatedAt: z$1.ZodNumber;
        items: z$1.ZodArray<z$1.ZodObject<{
            id: z$1.ZodString;
            text: z$1.ZodString;
            status: z$1.ZodEnum<{
                pending: "pending";
                completed: "completed";
                in_progress: "in_progress";
            }>;
        }, z$1.core.$strip>>;
    }, z$1.core.$strip>>;
    goal: z$1.ZodNullable<z$1.ZodObject<{
        sourceSeq: z$1.ZodNumber;
        updatedAt: z$1.ZodNumber;
        objective: z$1.ZodString;
        status: z$1.ZodEnum<{
            active: "active";
            paused: "paused";
            budgetLimited: "budgetLimited";
            complete: "complete";
        }>;
        tokenBudget: z$1.ZodNullable<z$1.ZodNumber>;
        tokensUsed: z$1.ZodNumber;
        timeUsedSeconds: z$1.ZodNumber;
    }, z$1.core.$strip>>;
    modelFallback: z$1.ZodNullable<z$1.ZodObject<{
        sourceSeq: z$1.ZodNumber;
        detectedAt: z$1.ZodNumber;
        originalModel: z$1.ZodString;
        fallbackModel: z$1.ZodString;
        reason: z$1.ZodEnum<{
            refusal: "refusal";
            provider: "provider";
        }>;
        message: z$1.ZodString;
    }, z$1.core.$strip>>;
    contextWindowUsage: z$1.ZodOptional<z$1.ZodObject<{
        usedTokens: z$1.ZodNumber;
        modelContextWindow: z$1.ZodNumber;
        estimated: z$1.ZodBoolean;
    }, z$1.core.$strip>>;
    timelinePage: z$1.ZodObject<{
        kind: z$1.ZodEnum<{
            latest: "latest";
            older: "older";
        }>;
        segmentLimit: z$1.ZodNumber;
        returnedSegmentCount: z$1.ZodNumber;
        hasOlderRows: z$1.ZodBoolean;
        olderCursor: z$1.ZodNullable<z$1.ZodObject<{
            anchorSeq: z$1.ZodNumber;
            anchorId: z$1.ZodString;
        }, z$1.core.$strict>>;
    }, z$1.core.$strict>;
    maxSeq: z$1.ZodNumber;
    delta: z$1.ZodOptional<z$1.ZodObject<{
        upsertRows: z$1.ZodArray<z$1.ZodType<TimelineRow, unknown, z$1.core.$ZodTypeInternals<TimelineRow, unknown>>>;
        rowOrder: z$1.ZodOptional<z$1.ZodArray<z$1.ZodString>>;
    }, z$1.core.$strip>>;
}, z$1.core.$strip>;
type ThreadTimelineResponse = z$1.infer<typeof threadTimelineResponseSchema>;
declare const threadConversationOutlineResponseSchema: z$1.ZodObject<{
    items: z$1.ZodArray<z$1.ZodObject<{
        id: z$1.ZodString;
        role: z$1.ZodEnum<{
            user: "user";
            assistant: "assistant";
        }>;
        preview: z$1.ZodString;
        attachmentSummary: z$1.ZodNullable<z$1.ZodObject<{
            imageCount: z$1.ZodNumber;
            fileCount: z$1.ZodNumber;
        }, z$1.core.$strict>>;
    }, z$1.core.$strict>>;
    maxSeq: z$1.ZodNumber;
}, z$1.core.$strict>;
type ThreadConversationOutlineResponse = z$1.infer<typeof threadConversationOutlineResponseSchema>;
declare const threadStorageFileListResponseSchema: z$1.ZodObject<{
    files: z$1.ZodArray<z$1.ZodObject<{
        path: z$1.ZodString;
        name: z$1.ZodString;
    }, z$1.core.$strip>>;
    truncated: z$1.ZodBoolean;
    storageRootPath: z$1.ZodString;
}, z$1.core.$strip>;
type ThreadStorageFileListResponse = z$1.infer<typeof threadStorageFileListResponseSchema>;
declare const threadStoragePathListResponseSchema: z$1.ZodObject<{
    paths: z$1.ZodArray<z$1.ZodObject<{
        kind: z$1.ZodEnum<{
            file: "file";
            directory: "directory";
        }>;
        path: z$1.ZodString;
        name: z$1.ZodString;
        score: z$1.ZodNumber;
        positions: z$1.ZodArray<z$1.ZodNumber>;
    }, z$1.core.$strip>>;
    truncated: z$1.ZodBoolean;
    storageRootPath: z$1.ZodString;
}, z$1.core.$strip>;
type ThreadStoragePathListResponse = z$1.infer<typeof threadStoragePathListResponseSchema>;

declare const browserHistoryEntrySchema: z$1.ZodObject<{
    id: z$1.ZodString;
    scopeId: z$1.ZodString;
    url: z$1.ZodString;
    title: z$1.ZodNullable<z$1.ZodString>;
    visitCount: z$1.ZodNumber;
    lastVisitedAt: z$1.ZodNumber;
}, z$1.core.$strict>;
type BrowserHistoryEntry = z$1.infer<typeof browserHistoryEntrySchema>;

declare const threadTabsResponseSchema: z$1.ZodObject<{
    revision: z$1.ZodNumber;
    tabs: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"thread-info">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"git-diff">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        actionId: z$1.ZodString;
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"plugin-panel">;
        paramsJson: z$1.ZodNullable<z$1.ZodString>;
        pluginId: z$1.ZodString;
        title: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        environmentId: z$1.ZodNullable<z$1.ZodString>;
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"workspace-file-preview">;
        lineRange: z$1.ZodNullable<z$1.ZodObject<{
            endLineNumber: z$1.ZodNumber;
            startLineNumber: z$1.ZodNumber;
        }, z$1.core.$strict>>;
        path: z$1.ZodString;
        projectId: z$1.ZodNullable<z$1.ZodString>;
        source: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"working-tree">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"head">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"merge-base">;
            ref: z$1.ZodString;
        }, z$1.core.$strict>], "kind">;
        statusLabel: z$1.ZodNullable<z$1.ZodLiteral<"deleted">>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        environmentId: z$1.ZodNullable<z$1.ZodString>;
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"host-file-preview">;
        lineRange: z$1.ZodNullable<z$1.ZodObject<{
            endLineNumber: z$1.ZodNumber;
            startLineNumber: z$1.ZodNumber;
        }, z$1.core.$strict>>;
        path: z$1.ZodString;
        threadId: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        environmentId: z$1.ZodNullable<z$1.ZodString>;
        id: z$1.ZodString;
        isPinned: z$1.ZodBoolean;
        kind: z$1.ZodLiteral<"thread-storage-file-preview">;
        lineRange: z$1.ZodNullable<z$1.ZodObject<{
            endLineNumber: z$1.ZodNumber;
            startLineNumber: z$1.ZodNumber;
        }, z$1.core.$strict>>;
        path: z$1.ZodString;
        threadId: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        environmentId: z$1.ZodNullable<z$1.ZodString>;
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"browser">;
        title: z$1.ZodNullable<z$1.ZodString>;
        url: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"new-tab">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"side-chat">;
        sourceMessageText: z$1.ZodString;
        sourceSeqEnd: z$1.ZodNullable<z$1.ZodNumber>;
        threadId: z$1.ZodNullable<z$1.ZodString>;
        title: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"terminal">;
        terminalId: z$1.ZodString;
    }, z$1.core.$strict>], "kind">>;
}, z$1.core.$strict>;
type ThreadTabsResponse = z$1.infer<typeof threadTabsResponseSchema>;
declare const updateThreadTabsRequestSchema: z$1.ZodObject<{
    expectedRevision: z$1.ZodNumber;
    tabs: z$1.ZodArray<z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"thread-info">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"git-diff">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        actionId: z$1.ZodString;
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"plugin-panel">;
        paramsJson: z$1.ZodNullable<z$1.ZodString>;
        pluginId: z$1.ZodString;
        title: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        environmentId: z$1.ZodNullable<z$1.ZodString>;
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"workspace-file-preview">;
        lineRange: z$1.ZodNullable<z$1.ZodObject<{
            endLineNumber: z$1.ZodNumber;
            startLineNumber: z$1.ZodNumber;
        }, z$1.core.$strict>>;
        path: z$1.ZodString;
        projectId: z$1.ZodNullable<z$1.ZodString>;
        source: z$1.ZodDiscriminatedUnion<[z$1.ZodObject<{
            kind: z$1.ZodLiteral<"working-tree">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"head">;
        }, z$1.core.$strict>, z$1.ZodObject<{
            kind: z$1.ZodLiteral<"merge-base">;
            ref: z$1.ZodString;
        }, z$1.core.$strict>], "kind">;
        statusLabel: z$1.ZodNullable<z$1.ZodLiteral<"deleted">>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        environmentId: z$1.ZodNullable<z$1.ZodString>;
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"host-file-preview">;
        lineRange: z$1.ZodNullable<z$1.ZodObject<{
            endLineNumber: z$1.ZodNumber;
            startLineNumber: z$1.ZodNumber;
        }, z$1.core.$strict>>;
        path: z$1.ZodString;
        threadId: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        environmentId: z$1.ZodNullable<z$1.ZodString>;
        id: z$1.ZodString;
        isPinned: z$1.ZodBoolean;
        kind: z$1.ZodLiteral<"thread-storage-file-preview">;
        lineRange: z$1.ZodNullable<z$1.ZodObject<{
            endLineNumber: z$1.ZodNumber;
            startLineNumber: z$1.ZodNumber;
        }, z$1.core.$strict>>;
        path: z$1.ZodString;
        threadId: z$1.ZodNullable<z$1.ZodString>;
    }, z$1.core.$strict>, z$1.ZodObject<{
        environmentId: z$1.ZodNullable<z$1.ZodString>;
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"browser">;
        title: z$1.ZodNullable<z$1.ZodString>;
        url: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"new-tab">;
    }, z$1.core.$strict>, z$1.ZodObject<{
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"side-chat">;
        sourceMessageText: z$1.ZodString;
        sourceSeqEnd: z$1.ZodNullable<z$1.ZodNumber>;
        threadId: z$1.ZodNullable<z$1.ZodString>;
        title: z$1.ZodString;
    }, z$1.core.$strict>, z$1.ZodObject<{
        id: z$1.ZodString;
        kind: z$1.ZodLiteral<"terminal">;
        terminalId: z$1.ZodString;
    }, z$1.core.$strict>], "kind">>;
}, z$1.core.$strict>;
type UpdateThreadTabsRequest = z$1.infer<typeof updateThreadTabsRequestSchema>;

/**
 * A value that survives a JSON round trip without coercion or data loss.
 *
 * Host boundaries still validate values at runtime because TypeScript cannot
 * exclude non-finite numbers and plugin bundles can bypass static types.
 */
type JsonValue = string | number | boolean | null | JsonValue[] | {
    [key: string]: JsonValue;
};

/** A JSON-safe path segment reported by a Standard Schema validation issue. */
type PluginRpcIssuePathSegment = string | number;
/** Validator-neutral validation detail carried by an RPC error envelope. */
interface PluginRpcValidationIssue {
    message: string;
    path?: PluginRpcIssuePathSegment[];
}
/** Stable wire error categories for plugin RPC. */
type PluginRpcErrorCode = "invalid_json" | "invalid_input" | "handler_error" | "invalid_output" | "non_json_result" | "unknown_method";
/** Structured RPC failure returned as `{ ok: false, error }`. */
interface PluginRpcError {
    code: PluginRpcErrorCode;
    message: string;
    issues?: PluginRpcValidationIssue[];
}
/**
 * The validator-neutral subset of Standard Schema v1 used by plugin RPC.
 * Zod 4 schemas implement this interface directly; other validators can do
 * the same without becoming part of Patcher's public protocol.
 */
interface StandardSchemaV1<Input = unknown, Output = Input> {
    readonly "~standard": {
        readonly version: 1;
        readonly vendor: string;
        readonly validate: (value: unknown) => StandardSchemaV1Result<Output> | Promise<StandardSchemaV1Result<Output>>;
        readonly types?: {
            readonly input: Input;
            readonly output: Output;
        };
    };
}
type StandardSchemaV1Result<Output> = {
    readonly value: Output;
    readonly issues?: undefined;
} | {
    readonly issues: readonly StandardSchemaV1Issue[];
};
interface StandardSchemaV1Issue {
    readonly message: string;
    readonly path?: PropertyKey | readonly (PropertyKey | {
        readonly key: PropertyKey;
    })[];
}
type StandardSchemaV1InferInput<Schema extends StandardSchemaV1> = NonNullable<Schema["~standard"]["types"]>["input"];
type StandardSchemaV1InferOutput<Schema extends StandardSchemaV1> = NonNullable<Schema["~standard"]["types"]>["output"];
interface PluginRpcMethodContract<InputSchema extends StandardSchemaV1 = StandardSchemaV1, OutputSchema extends StandardSchemaV1 = StandardSchemaV1> {
    readonly input: InputSchema;
    readonly output: OutputSchema;
}
type PluginRpcContract = Readonly<Record<string, PluginRpcMethodContract>>;
/** Define a shared RPC contract while preserving exact method/schema types. */
declare function defineRpcContract<const Contract extends PluginRpcContract>(contract: Contract): Contract;
type PluginRpcHandlers<Contract extends PluginRpcContract> = {
    [Method in keyof Contract]: (input: StandardSchemaV1InferOutput<Contract[Method]["input"]>) => StandardSchemaV1InferInput<Contract[Method]["output"]> | Promise<StandardSchemaV1InferInput<Contract[Method]["output"]>>;
};
type PluginRpcCallInput<Method extends PluginRpcMethodContract> = StandardSchemaV1InferInput<Method["input"]>;
type PluginRpcCallArgs<Method extends PluginRpcMethodContract> = null extends PluginRpcCallInput<Method> ? [input?: PluginRpcCallInput<Method>] : [input: PluginRpcCallInput<Method>];
type PluginRpcResult<Method extends PluginRpcMethodContract> = StandardSchemaV1InferOutput<Method["output"]>;

/**
 * The `@patcher/plugin-sdk/app` contract (plugin design §5.2) — pure types with no
 * side effects. The Patcher app imports these to keep its real implementation in
 * sync (`satisfies PluginSdkApp`). Plugin authors import the same shapes through
 * `@patcher/plugin-sdk/app`.
 *
 * Per-slot props are versioned contracts: additive-only within an SDK major.
 */
/** Props passed to a `homepageSection` component. */
interface PluginHomepageSectionProps {
    /** Project in view on the compose surface; null when none is selected. */
    projectId: string | null;
}
/**
 * Props passed to a `settingsSection` component.
 *
 * Deliberately empty in V1; versioned additive like the other slot props.
 */
interface PluginSettingsSectionProps {
}
/**
 * Props passed to an `experimental_leadingPanel` component.
 *
 * Deliberately empty: the panel is not a route and has no context to hand it.
 * Named rather than omitted so fields can be added additively later without
 * changing what a plugin's component signature looks like.
 */
interface PluginLeadingPanelProps {
    /**
     * The address of the page in the active browser tab, or null when the window
     * is not showing one.
     *
     * Here because a panel scoped to a site (see
     * {@link PluginLeadingPanelRegistration.matches}) needs to know *which* page —
     * "my open pull requests" is one panel, but which repository it is looking at
     * is the tab's business.
     */
    browserUrl: string | null;
}
/** Props passed to a `navPanel` component (it owns its whole route). */
interface PluginNavPanelProps {
    /**
     * The route remainder after the panel root, "" at the root. The panel's
     * route is `/plugins/<pluginId>/<path>/*`, so a deep link like
     * `/plugins/notes/notes/work/ideas.md` renders the panel with
     * `subPath: "work/ideas.md"`. Navigate within the panel via
     * `usePatcherNavigate().toPluginPanel(path, { subPath })` — browser
     * back/forward then walks panel-internal history.
     */
    subPath: string;
}
/**
 * Props passed to a panel tab opened by a `threadPanelAction`.
 *
 * This slot is rendered only for an existing thread. Use
 * `experimental_newThreadPanelAction` for the root New thread screen.
 */
interface PluginThreadPanelProps {
    threadId: string;
    /**
     * The JSON value the action's `openPanel` call passed (round-tripped
     * through persistence, so the tab restores across reloads); null when the
     * action opened the panel without params.
     */
    params: JsonValue | null;
}
/** Props passed to a panel tab opened by `experimental_newThreadPanelAction`. */
interface PluginNewThreadPanelProps {
    /** Project selected in the root composer; null in projectless compose. */
    projectId: string | null;
    /**
     * The JSON value the action's `openPanel` call passed (round-tripped
     * through persistence, so the tab restores across reloads); null when the
     * action opened the panel without params.
     */
    params: JsonValue | null;
}
interface PluginPendingInteractionView {
    id: string;
    threadId: string;
    title: string;
    payload: JsonValue;
    createdAt: number;
    expiresAt: number | null;
}
interface PluginPendingInteractionProps {
    interaction: PluginPendingInteractionView;
    submit(value: JsonValue): Promise<void>;
    cancel(): Promise<void>;
}
/**
 * Props for a `sidebarFooterAction` — host-rendered (no plugin component).
 * Deliberately empty; the registration's `run` carries the behavior.
 */
interface PluginSidebarFooterActionProps {
}
/**
 * Props passed to an `experimental_threadList` component — the sidebar's
 * scrolling thread area, replaced wholesale by one plugin.
 */
interface PluginThreadListProps {
    /** The thread the route currently shows; null on non-thread routes. */
    activeThreadId: string | null;
    /** The project the route currently shows; null when none is selected. */
    activeProjectId: string | null;
    /** True on phone-width viewports and coarse pointers. */
    isCompactViewport: boolean;
    /**
     * Call after the user opens a thread. It closes the mobile sidebar drawer,
     * and it clears the host search field on every viewport. Always call it, or
     * the sidebar stays in search mode after the thread opens.
     */
    onNavigate: () => void;
    /**
     * The host search field's current text, or "" when the field is closed.
     * The host owns that field, so a plugin list filters by this rather than
     * shipping a second search box.
     */
    searchQuery: string;
}
/**
 * Props passed to an `experimental_threadHeaderAction` component, rendered in
 * the thread header's action row.
 */
interface PluginThreadHeaderActionProps {
    /**
     * The thread this header belongs to. Never null: the slot is not rendered
     * on the compose screen or other non-thread routes. A split layout renders
     * one header per pane, so the component mounts once per visible thread,
     * each with its own id — keep per-thread state in the component, never in a
     * module-level singleton.
     */
    threadId: string;
    projectId: string;
    /**
     * True on phone-width viewports and coarse pointers. Collapse to an
     * icon-sized control when it is true — the row is short.
     */
    isCompactViewport: boolean;
}
/**
 * Where a file being opened by a `fileOpener` lives. `path` semantics follow
 * the source: workspace paths are relative to the environment's worktree,
 * thread-storage paths are relative to the thread's storage root, host paths
 * are absolute on the thread's host.
 */
interface PluginFileOpenerSource {
    kind: "workspace" | "host" | "thread-storage";
    threadId: string | null;
    environmentId: string | null;
    projectId: string | null;
}
/** Props passed to a `fileOpener` component (rendered as a panel file tab). */
interface PluginFileOpenerProps {
    path: string;
    source: PluginFileOpenerSource;
}
/**
 * Message context passed to a `messageDirective` component — the assistant
 * (or nested agent) message that contained the directive.
 */
interface PluginMessageDirectiveMessage {
    id: string;
    threadId: string;
    turnId: string | null;
    projectId: string | null;
}
/**
 * Open a worktree-relative file in the host's workspace file viewer. Returns
 * true when the host accepted the path; false when the path is invalid or the
 * viewer declined it.
 */
type PluginMessageDirectiveOpenWorkspaceFile = (path: string) => boolean;
/**
 * Props passed to a `messageDirective` component. Attributes are untrusted
 * strings parsed from the directive; the plugin validates its own fields.
 */
interface PluginMessageDirectiveProps {
    /** Parsed, untrusted directive attributes (e.g. `{ file: "demo.html" }`). */
    attributes: Readonly<Record<string, string>>;
    /** Original directive source text (useful for diagnostics / crash fallback). */
    source: string;
    message: PluginMessageDirectiveMessage;
    /**
     * Opens a worktree-relative file in the host's workspace file viewer. Null
     * when the message surface has no workspace viewer available.
     */
    openWorkspaceFile: PluginMessageDirectiveOpenWorkspaceFile | null;
}
interface PluginHomepageSectionRegistration {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    title: string;
    component: ComponentType<PluginHomepageSectionProps>;
}
interface PluginSettingsSectionRegistration {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    /** Optional host-rendered section heading. */
    title?: string;
    /**
     * Optional one-line host-rendered subheading under `title`, in the built-in
     * SettingsSection idiom (ignored when `title` is absent).
     */
    description?: string;
    component: ComponentType<PluginSettingsSectionProps>;
}
/**
 * A panel on the window's **leading** edge — the end opposite the sidebar.
 *
 * Patcher puts nothing there itself. The edge exists for plugins and is absent
 * entirely when no plugin has asked for it: no empty column, no toggle for a
 * panel with nothing in it. What appears is decided by how many registrations
 * there are, not by configuration — one plugin gets the whole panel with no
 * chrome of Patcher's own around it, and a second one is what makes Patcher draw a rail
 * to switch between them.
 *
 * Unlike a `navPanel` this is not a route: it has no path, nothing links to it,
 * and it stays where it is while the user navigates. Use it for something that
 * accompanies the work rather than something the user goes to.
 *
 * Experimental: see docs/api_to_audit.md.
 */
interface PluginLeadingPanelRegistration {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    /** Named in the rail's tooltip, and its accessible name. */
    title: string;
    /** Icon hint (Patcher icon name); unknown names fall back to a generic icon. */
    icon: string;
    /** Rendered as the whole panel body; it owns its own scrolling. */
    component: ComponentType<PluginLeadingPanelProps>;
    /**
     * Show this panel only while the active browser tab is on a matching page —
     * URL globs, the dialect route patterns use (`https://github.com/**`).
     *
     * Declared rather than decided in the component, because with nothing declared
     * the host draws the column whenever the plugin is installed, and a component
     * that returns null for the page in front of the user leaves an empty edge
     * behind. The host removes the column instead.
     *
     * Unlike `patcher.sites`, this costs no permission and is not checked against one:
     * the panel is Patcher's own UI, and what it is told about the tab is the address
     * the address bar is already showing.
     */
    matches?: string[];
}
interface PluginNavPanelRegistration {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    title: string;
    /** Icon hint (Patcher icon name); unknown names fall back to a generic icon. */
    icon: string;
    /** URL segment under `/plugins/<pluginId>/`; letters, digits, `-`, `_`. */
    path: string;
    component: ComponentType<PluginNavPanelProps>;
    /**
     * Optional presentational component rendered at the trailing edge of this
     * panel's sidebar row. It receives no props so it can own a narrow live
     * value through the ordinary SDK hooks without coupling that state to the
     * host sidebar. The host does not mount it on compact viewports and clips it
     * to a small, single-line box on wider viewports. It shares the trailing
     * action column, fading out for the host's options button on hover or focus;
     * do not render controls or rely on unbounded content here.
     *
     * Experimental: see docs/api_to_audit.md.
     */
    experimental_sidebarAccessory?: ComponentType;
    /**
     * Optional component rendered on the right side of the shared title bar
     * (e.g. a sync button or a count). Contained separately from the body: a
     * throwing headerContent is hidden without breaking the title bar.
     */
    headerContent?: ComponentType<PluginNavPanelProps>;
}
/**
 * Context handed to a `threadPanelAction`'s `run`.
 *
 * The action is thread-only and is never offered on the root New thread
 * screen, so `threadId` is always present.
 */
interface PluginThreadPanelActionContext {
    /** The thread whose panel launcher invoked the action. */
    threadId: string;
    /**
     * Open a tab in the thread's side panel rendering this action's
     * `component`. `title` labels the tab (default: the action's `title`);
     * `params` must be JSON-serializable — it is persisted with the tab and
     * reaches the component as its `params` prop. Opening with params
     * identical to an already-open tab of this action focuses that tab
     * (updating its title) instead of duplicating it. May be called more than
     * once (different params ⇒ multiple tabs) or not at all.
     */
    openPanel(options?: {
        title?: string;
        params?: JsonValue;
    }): void;
}
interface PluginThreadPanelActionRegistration {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    /** Label of the action row in the panel's new-tab launcher. */
    title: string;
    /**
     * Icon hint (Patcher icon name) used when the plugin ships no logo; the
     * launcher row and opened tabs prefer the plugin's logo.
     */
    icon?: string;
    /** Rendered inside every panel tab this action opens. */
    component: ComponentType<PluginThreadPanelProps>;
    /**
     * How the host frames the tab content. "padded" (default) wraps the
     * component in the panel's scroll container with standard padding —
     * right for document-like content. "flush" gives the component the full
     * tab area (no padding, definite height, no host scrolling) — right for
     * app-like content that manages its own layout, such as
     * `ThreadChat`.
     */
    layout?: "padded" | "flush";
    /**
     * Runs when the user activates the action: call your RPC methods, show a
     * toast, and/or open panel tabs via `context.openPanel`. Omitted =
     * immediately open a panel tab with defaults. Errors (sync or async) are
     * contained and logged; they never break the launcher.
     */
    run?(context: PluginThreadPanelActionContext): void | Promise<void>;
}
/** Context handed to an `experimental_newThreadPanelAction`'s `run`. */
interface PluginNewThreadPanelActionContext {
    /** Project selected in the root composer; null in projectless compose. */
    projectId: string | null;
    /**
     * Open a tab in the root New thread screen's side panel rendering this
     * action's `component`. The title, params, deduplication, and error
     * semantics match `threadPanelAction`.
     */
    openPanel(options?: {
        title?: string;
        params?: JsonValue;
    }): void;
}
/** Registration for the root New thread screen's panel Actions list. */
interface PluginNewThreadPanelActionRegistration {
    /** Unique within this slot for the plugin; letters, digits, `-`, `_`. */
    id: string;
    /** Label of the action row in the panel's new-tab launcher. */
    title: string;
    /** Icon hint (Patcher icon name) used when the plugin ships no logo. */
    icon?: string;
    /** Rendered inside every panel tab this action opens. */
    component: ComponentType<PluginNewThreadPanelProps>;
    /** Host framing; matches `threadPanelAction`. */
    layout?: "padded" | "flush";
    /**
     * Runs when the user activates the action. Omitted = immediately open a
     * panel tab with defaults. Errors are contained and logged.
     */
    run?(context: PluginNewThreadPanelActionContext): void | Promise<void>;
}
interface PluginPendingInteractionRegistration {
    /** Matches `rendererId` passed to `patcher.ui.requestInput`. */
    id: string;
    component: ComponentType<PluginPendingInteractionProps>;
}
/** Context handed to a `sidebarFooterAction`'s `run`. */
interface PluginSidebarFooterActionContext {
    /**
     * Navigate to this plugin's detail page in Tools, where declarative settings
     * and `settingsSection` slots render.
     */
    openSettings(): void;
}
/**
 * An icon button in the app sidebar footer (next to Settings / bug report).
 * Host-rendered for consistent chrome — plugins supply icon, label, and
 * `run` behavior only.
 */
interface PluginSidebarFooterActionRegistration {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    /** Tooltip and accessible label for the icon button. */
    title: string;
    /** Icon hint (Patcher icon name); unknown names fall back to a generic icon. */
    icon: string;
    /**
     * Runs when the user activates the action (e.g. call `openSettings()`,
     * open a panel via other surfaces, toast). Errors (sync or async) are
     * contained and logged; they never break the sidebar.
     */
    run(context: PluginSidebarFooterActionContext): void | Promise<void>;
}
/**
 * The one status Patcher would paint for a thread, already resolved through the
 * host's precedence (attention before work; plan and goal before the generic
 * spinner). Draw your own glyph for it — the SDK ships no status component.
 *
 * Treat an unrecognized value as "none": Patcher adds kinds over time, and an
 * older plugin must degrade to drawing nothing rather than throwing.
 *
 * "draft" and "working-draft" are never reported here: an unsubmitted composer
 * draft is per-client state the host reads per row, which an array-wide view
 * cannot. A thread holding a draft reports whatever it would report without
 * one.
 */
type PluginSidebarThreadIndicator = "unread-error" | "waiting-for-input" | "working-draft" | "workflow" | "background-agent" | "background-command" | "plan-mode" | "goal" | "runtime" | "draft" | "unread-success" | "none";
/**
 * How a thread's environment presents its workspace: a worktree Patcher manages,
 * a worktree the user manages, or anything else (a plain checkout).
 */
type PluginSidebarWorkspaceKind = "managed-worktree" | "unmanaged-worktree" | "other";
/** Live work counts on a thread. All zero means nothing is running. */
interface PluginSidebarThreadActivity {
    workflows: number;
    backgroundAgents: number;
    backgroundCommands: number;
    planMode: number;
    goals: number;
}
/**
 * One thread in the sidebar's live view.
 *
 * A deliberate copy of the fields a sidebar needs — not a re-export of the
 * host's internal thread row type, which changes whenever the app needs a
 * field. Timestamps are epoch milliseconds.
 */
interface PluginSidebarThread {
    id: string;
    projectId: string;
    /** Null while a thread is still unnamed; pair with `titleFallback`. */
    title: string | null;
    titleFallback: string | null;
    /** The thread this one was forked from or spawned under; null at the root. */
    parentThreadId: string | null;
    sectionId: string | null;
    /** How this thread came to exist under its parent; null for root threads. */
    originKind: "fork" | "side-chat" | null;
    /** The plugin that spawned it, or null for non-plugin origins. */
    originPluginId: string | null;
    /** The agent provider this thread runs on, e.g. "codex", "claude-code". */
    providerId: string;
    /** The agent is blocked on the user: an approval or a question. */
    hasPendingInteraction: boolean;
    activity: PluginSidebarThreadActivity;
    indicator: PluginSidebarThreadIndicator;
    /**
     * The host's accessible label for `indicator`, e.g. "Thread needs user
     * input"; null when the indicator is "none". Use it for `aria-label` so
     * screen-reader text stays consistent across sidebars.
     */
    indicatorLabel: string | null;
    isUnread: boolean;
    isPinned: boolean;
    isArchived: boolean;
    environment: {
        id: string | null;
        name: string | null;
        branchName: string | null;
        workspaceDisplayKind: PluginSidebarWorkspaceKind;
    } | null;
    /**
     * The machine this thread's work runs on, with the name resolved for you.
     * Null when the thread has no environment yet, or when its host is not in
     * the known-hosts list. Useful where a thread has no branch to show — a
     * personal-project thread has a machine but no worktree.
     */
    host: {
        id: string;
        name: string;
    } | null;
    createdAt: number;
    updatedAt: number;
    lastReadAt: number | null;
    latestAttentionAt: number;
}
/**
 * The pull request for a thread's branch, narrowed to what a sidebar row
 * needs. `attention` is Patcher's rolled-up "does this need you" signal, so a row
 * can colour a badge without reading checks, review, and mergeability itself.
 */
interface PluginSidebarPullRequest {
    number: number;
    title: string;
    url: string;
    state: "draft" | "open" | "merged" | "closed";
    attention: "checks_failed" | "checks_pending" | "changes_requested" | "review_requested" | "conflicts" | "blocked" | "draft" | "ready_to_merge" | "merged" | "closed" | "none";
}
interface PluginSidebarThreadPullRequestState {
    /** True while the first lookup for this thread's environment is in flight. */
    isLoading: boolean;
    /**
     * The pull request, or null when the branch has none, the thread has no
     * environment, or the lookup could not run (a git-host hiccup). A row should
     * treat null as "nothing to show", never as an error.
     */
    pullRequest: PluginSidebarPullRequest | null;
}
/** One project in the sidebar's live view. */
interface PluginSidebarProject {
    id: string;
    name: string;
    /** True for the implicit personal project. */
    isPersonal: boolean;
}
interface PluginSidebarThreadsState {
    status: "loading" | "ready" | "error";
    threads: readonly PluginSidebarThread[];
    projects: readonly PluginSidebarProject[];
}
/**
 * Act on threads from a plugin surface. Every method routes to the host's own
 * flow, so optimistic updates, toasts, dialogs, pane closing, and route repair
 * behave exactly as they do in the built-in sidebar. Unknown thread ids are
 * ignored by `open` and rejected by the rest.
 */
interface PluginSidebarThreadActions {
    /**
     * Navigate to a thread. `split: true` applies Patcher's split placement rules —
     * a right split by default, focus when the thread is already open, replace
     * at the pane cap — and falls back to plain navigation where splits are off.
     */
    open(threadId: string, options?: {
        split?: boolean;
    }): void;
    /**
     * Go to the new-thread screen. Passing `projectId` also makes that project
     * the composer's selection, so the thread is created where you asked.
     */
    openNewThread(options?: {
        projectId?: string;
        focusPrompt?: boolean;
    }): void;
    setPinned(threadId: string, pinned: boolean): Promise<void>;
    setRead(threadId: string, read: boolean): Promise<void>;
    /** Silent rename — no dialog. For inline editing in your own row. */
    rename(threadId: string, title: string): Promise<void>;
    /** Archives the thread AND its children, closing any panes showing them. */
    archive(threadId: string): void;
    /**
     * Opens Patcher's delete confirmation, which counts child threads first. Deletion
     * is destructive and recursive, so the host owns the confirmation: there is
     * deliberately no silent `delete`.
     */
    requestDelete(threadId: string): void;
}
/**
 * Render a plugin component in the thread header's action row.
 *
 * This replaced an older backend-only registration that rendered a host-owned
 * button and ran server-side, so it is now the only shape a thread-header
 * control takes — including the plain "do a thing" button, which is this
 * component rendering one.
 *
 * The host places it at the left end of the action row, before the workspace
 * button, git actions, the panel toggle, maximize, and close. That row is a
 * 48px chrome row with 28px controls: render one inline control that fits, and
 * put anything taller in a portalled popover.
 */
interface PluginThreadHeaderActionRegistration {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    /**
     * Names the region the host wraps around your component (a labelled group).
     * It does NOT label your control: an icon-only button still needs its own
     * accessible name.
     */
    title: string;
    component: ComponentType<PluginThreadHeaderActionProps>;
}
/** One pane's place in the split layout, as fractions of the split area. */
interface PluginSidebarSplitPane {
    paneId: string;
    rect: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    /** This pane holds the thread the row represents. */
    isMe: boolean;
    isFocused: boolean;
}
/**
 * Drag-to-split support for one row, plus where that thread currently sits in
 * the split layout.
 */
interface PluginSidebarThreadSplit {
    /**
     * Spread onto the row's interactive element. Carries the pointer handler
     * that starts a split drag; empty when splits are unavailable, so spreading
     * it is always safe.
     *
     * The host owns every rule: the gesture engages only once the pointer leaves
     * the sidebar toward the main area (so a list with its own drag-to-reorder
     * keeps working), an edge drop splits, a center drop replaces, an
     * already-open thread focuses its pane, and the pane cap coerces a split
     * into a replace.
     */
    splitProps: {
        onPointerDown?: (event: react.PointerEvent<HTMLElement>) => void;
    };
    /**
     * False on compact viewports, when the user disabled splits, and for an
     * unknown thread id. Gate any "open in split" affordance you draw on it.
     */
    isAvailable: boolean;
    /**
     * Where this thread sits in the split layout, or null when it is not open in
     * one (including single-pane layouts). Draw a mini-map, a tint, or nothing.
     */
    layout: {
        panes: readonly PluginSidebarSplitPane[];
    } | null;
}
/**
 * Replace the sidebar's thread list with a plugin component.
 *
 * Unlike every other slot, this one is EXCLUSIVE: two lists cannot share one
 * scroll area. The built-in list stays the default; the user picks a provider
 * in Settings → Appearance, stored per client. A provider that is uninstalled,
 * disabled, or crashing falls back to the built-in list rather than leaving
 * the user with no sidebar.
 *
 * The plugin gets the scrolling list and nothing else. The New-thread button,
 * the search field, the plugin nav rows, and the footer stay host-rendered in
 * every sidebar — they are shared surfaces (other plugins live in two of
 * them), and a replaced list must not be able to remove them.
 */
interface PluginThreadListRegistration {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    /** Label in the Settings → Appearance → Sidebar picker. */
    title: string;
    /** Optional one-line description under the title in that picker. */
    description?: string;
    component: ComponentType<PluginThreadListProps>;
}
/**
 * Register this plugin as a viewer/editor for file extensions. The user
 * picks (and can set as default) an opener per extension via the file tab's
 * "Open with" menu; matching files opened in the panel then render
 * `component` in a plugin tab instead of the built-in preview. Applies to
 * working-tree, host, and thread-storage files — never to git-ref snapshots
 * (diff views always use the built-in preview). The built-in preview stays
 * one menu click away, and a missing/disabled opener falls back to it.
 */
interface PluginFileOpenerRegistration {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    /** Label in the "Open with" menu (e.g. "Notes editor"). */
    title: string;
    /** Lowercase extensions without the dot (e.g. ["md", "mdx"]). */
    extensions: readonly string[];
    component: ComponentType<PluginFileOpenerProps>;
}
/**
 * Register a leaf message directive rendered inside assistant (and nested
 * agent) message Markdown. `id` is the directive name: `inline-vis` matches
 * `::inline-vis{file="demo.html"}`.
 */
interface PluginMessageDirectiveRegistration {
    /**
     * The directive name. Lowercase kebab-case beginning with a letter.
     */
    id: string;
    component: ComponentType<PluginMessageDirectiveProps>;
}
/**
 * A narrow, stable reference to one rendered chat message — NOT an internal
 * timeline row. `sourceSeqEnd` is the last source event sequence the message
 * covers, the anchor the server accepts for provider-history forks.
 */
interface ThreadChatMessageReference {
    id: string;
    threadId: string;
    role: "user" | "assistant";
    /** Visible text of the message. */
    text: string;
    sourceSeqEnd: number;
}
interface PluginMessageActionThreadPanelOptions {
    /** A `threadPanelAction` id registered by this same plugin. */
    actionId: string;
    title?: string;
    params?: JsonValue;
}
/** Context handed to a `messageAction`'s `run`. */
interface PluginMessageActionContext {
    /** The thread whose timeline surfaced the action. */
    threadId: string;
    message: ThreadChatMessageReference;
    /**
     * Present only when the action was invoked from the text-selection menu;
     * the exact text the user highlighted inside `message`.
     */
    selectedText?: string;
    /**
     * Open one of this plugin's `threadPanelAction` components in the current
     * thread's side panel — the registration-callback equivalent of
     * `usePatcherNavigate().openThreadPanel`. Returns true when the host
     * accepted (the action id exists and the surface has a panel); false
     * otherwise.
     */
    openPanel(options: PluginMessageActionThreadPanelOptions): boolean;
}
/**
 * An action on chat messages: an icon button in the per-message action bar
 * (user and assistant messages) and an entry in the assistant-message
 * text-selection menu. Host-rendered chrome — the plugin supplies title,
 * icon hint, and `run` behavior only.
 */
interface PluginMessageActionRegistration {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    /** Tooltip / menu label for the action. */
    title: string;
    /** Icon hint (Patcher icon name); unknown names fall back to a generic icon. */
    icon?: string;
    /**
     * Runs when the user activates the action. Errors (sync or async) are
     * contained and logged; they never break the timeline.
     */
    run(context: PluginMessageActionContext): void | Promise<void>;
}
interface PluginAppSlots {
    homepageSection(registration: PluginHomepageSectionRegistration): void;
    settingsSection(registration: PluginSettingsSectionRegistration): void;
    navPanel(registration: PluginNavPanelRegistration): void;
    /**
     * Claim a place on the window's leading edge (see
     * {@link PluginLeadingPanelRegistration}). Experimental: see
     * docs/api_to_audit.md.
     */
    experimental_leadingPanel(registration: PluginLeadingPanelRegistration): void;
    /**
     * Add an action to an existing thread's panel launcher. This slot is
     * thread-only; use `experimental_newThreadPanelAction` for root compose.
     */
    threadPanelAction(registration: PluginThreadPanelActionRegistration): void;
    /**
     * Add an action to the root New thread screen's panel launcher (see
     * {@link PluginNewThreadPanelActionRegistration}). Experimental: see
     * docs/api_to_audit.md.
     */
    experimental_newThreadPanelAction(registration: PluginNewThreadPanelActionRegistration): void;
    pendingInteraction(registration: PluginPendingInteractionRegistration): void;
    sidebarFooterAction(registration: PluginSidebarFooterActionRegistration): void;
    /**
     * Replace the sidebar's thread list (see
     * {@link PluginThreadListRegistration}). Experimental: see
     * docs/api_to_audit.md for what to audit before the prefix drops.
     */
    experimental_threadList(registration: PluginThreadListRegistration): void;
    /**
     * Render a component in the thread header's action row (see
     * {@link PluginThreadHeaderActionRegistration}). Experimental: see
     * docs/api_to_audit.md.
     */
    experimental_threadHeaderAction(registration: PluginThreadHeaderActionRegistration): void;
    fileOpener(registration: PluginFileOpenerRegistration): void;
    messageDirective(registration: PluginMessageDirectiveRegistration): void;
    messageAction(registration: PluginMessageActionRegistration): void;
}
interface PluginAppComposer {
    customize(registration: ComposerCustomization): void;
}
/** Stable lifecycle values for one content-script instance in one Patcher client. */
interface PluginContentScriptContext {
    /** The id of the plugin that owns this script. */
    readonly pluginId: string;
    /** Monotonic per-client generation, starting at 1. */
    readonly generation: number;
    /** Aborted before cleanup begins on replacement, deactivation, or teardown. */
    readonly signal: AbortSignal;
    /**
     * Persistently decorate any thread row for this plugin generation.
     *
     * The status is owned by the frontend generation and therefore survives
     * route changes. Passing `null` clears the plugin's status for that thread.
     * The host clears every remaining status when the frontend generation
     * deactivates.
     *
     * Optional so bundles can feature-detect support while this experimental
     * surface rolls out across 0.x clients.
     */
    readonly experimental_setThreadRowStatus?: (threadId: string, status: PluginComposerThreadRowStatus | null) => void;
    /**
     * Mark a browser tab for this plugin generation — the tab **decorator** point.
     *
     * The mark rides on the tab in the browser surface's strip, beside its page
     * icon and title, for as long as this generation lives; `null` clears it, and
     * the host clears everything this generation set when it deactivates. Marking
     * a tab id the strip does not hold is not an error — the tab may not be open
     * yet, or may be in another window — it simply shows nowhere.
     *
     * Which tabs exist is `patcher.browser.tabs.list()` on the backend side; a decorator
     * is what a plugin does once it knows.
     *
     * Optional so bundles can feature-detect support while this experimental
     * surface rolls out across 0.x clients.
     */
    readonly experimental_setBrowserTabStatus?: (tabId: string, status: PluginBrowserTabStatus | null) => void;
}
/** Cleanup returned by a frontend content script. */
type PluginContentScriptDisposer = () => void | Promise<void>;
/**
 * Trusted same-origin JavaScript/TypeScript mounted once per active frontend
 * generation in each Patcher app window or browser tab.
 */
interface PluginContentScriptRegistration {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    /**
     * Install behavior into the Patcher app shell. The host awaits a returned
     * promise, contains failures, and calls the returned disposer exactly once.
     */
    mount(context: PluginContentScriptContext): void | PluginContentScriptDisposer | Promise<void | PluginContentScriptDisposer>;
}
/** Lifecycle surface for trusted frontend content scripts. */
interface PluginAppContentScripts {
    register(registration: PluginContentScriptRegistration): void;
}
interface PluginAppBuilder {
    slots: PluginAppSlots;
    composer: PluginAppComposer;
    contentScripts: PluginAppContentScripts;
}
type PluginAppSetup = (app: PluginAppBuilder) => void;
/**
 * The opaque product of `definePluginApp` — a plugin's `app.tsx` default
 * export. The host re-runs `setup` against a fresh collector on every
 * (re)interpretation, replacing that plugin's registrations wholesale.
 */
interface PluginAppDefinition {
    /** Brand the host checks before interpreting a bundle's default export. */
    readonly __patcherPluginApp: true;
    readonly setup: PluginAppSetup;
}
interface PluginRpcClient<Contract extends PluginRpcContract = PluginRpcContract> {
    /**
     * Invoke one of the plugin's `patcher.rpc` methods (POST
     * /api/v1/plugins/&lt;id&gt;/rpc/&lt;method&gt;). Resolves with the method's
     * inferred output; rejects with an `Error` carrying the server's message,
     * stable `code`, and validation `issues` when present.
     */
    call<Method extends Extract<keyof Contract, string>>(method: Method, ...args: PluginRpcCallArgs<Contract[Method]>): Promise<PluginRpcResult<Contract[Method]>>;
}
interface PluginSettingsState {
    /**
     * Effective non-secret setting values (secret settings are excluded —
     * read them server-side). Undefined while loading or unavailable.
     */
    values: Record<string, string | boolean> | undefined;
    isLoading: boolean;
}
/** State of the app's shared realtime connection to the Patcher server. */
type PluginRealtimeConnectionState = "connecting" | "connected" | "reconnecting";
/** Where `useComposer()` writes. */
type PluginComposerScope = {
    kind: "thread";
    threadId: string;
} | {
    kind: "queued-message";
    threadId: string;
    queuedMessageId: string;
} | {
    kind: "side-chat";
    projectId: string;
    parentThreadId: string;
    tabId: string;
    childThreadId: string | null;
} | {
    kind: "new-thread";
    /** Root compose's effective selected project; null only while unresolved. */
    projectId: string | null;
};
/** One plugin-owned composer customization registration. */
interface ComposerCustomization {
    /** Unique within the plugin; letters, digits, `-`, `_`. */
    id: string;
    /** Composer kinds where this customization is active; omit for all kinds. */
    scopes?: readonly PluginComposerScope["kind"][];
    actions?: readonly {
        id: string;
        component: ComponentType;
    }[];
    banners?: readonly {
        id: string;
        /** Host chrome around the banner. Defaults to `"card"`. */
        chrome?: "card" | "bare";
        component: ComponentType;
    }[];
    plusMenu?: readonly ComposerPlusMenuItem[];
    richText?: ComposerRichTextSpec;
}
/** Host-rendered menu row in the composer's `+` menu. */
interface ComposerPlusMenuItem {
    id: string;
    label: string;
    /** Patcher icon name; unknown names fall back to the generic plugin icon. */
    icon?: string;
    /** Accessible description for the host-rendered row. */
    description?: string;
    disabled?: boolean | ((view: ComposerView) => boolean);
    run(context: {
        composer: PluginComposerApi;
        view: ComposerView;
    }): void | Promise<void>;
}
/** Reactive read-side of the composer a plugin surface is mounted in. */
interface ComposerView {
    scope: PluginComposerScope;
    layout: "expanded" | "compact" | "zen";
    draft: {
        text: string;
        isEmpty: boolean;
        attachmentCount: number;
    };
    run: {
        isRunning: boolean;
        isSubmitting: boolean;
    };
}
interface ComposerRichTextSpec {
    /** Content-derived paint: match ranges receive `className`; text is never mutated. */
    effects?: readonly {
        id: string;
        /** Plain-text offsets into the current structured draft. */
        match(text: string): readonly {
            from: number;
            to: number;
        }[];
        className: string;
    }[];
    /** Debounced, read-only observation of the structured draft. */
    onDraftChange?(draft: ComposerStructuredDraft, view: ComposerView): void;
}
interface ComposerStructuredDraft {
    text: string;
    mentions: readonly {
        from: number;
        to: number;
        provider: string;
        id: string;
        label: string;
    }[];
}
/** Host-rendered paint applied to the editable composer text. */
interface PluginComposerTextEffect {
    className: string;
}
/**
 * Host-rendered mark on a browser tab, shown beside its page icon and title.
 *
 * Deliberately the same three fields as {@link PluginComposerThreadRowStatus}
 * rather than a richer badge: what the strip can honestly show on a tab that may
 * be squeezed to its icon is one glyph with a label behind it.
 */
interface PluginBrowserTabStatus {
    /** Patcher icon-name hint; unknown names fall back to the generic plugin icon. */
    icon: string;
    /** Accessible label for the mark, and its tooltip. */
    label: string;
    /**
     * Semantic host treatment. `running` shimmers, `success` and `error` are
     * static tones, and the default is neutral.
     */
    tone?: "default" | "running" | "success" | "error";
}
/** Host-rendered status that temporarily replaces a thread's draft glyph. */
interface PluginComposerThreadRowStatus {
    /** Patcher icon-name hint; unknown names fall back to the generic plugin icon. */
    icon: string;
    /** Accessible label for the status glyph. */
    label: string;
    /**
     * Semantic host treatment for the status glyph. `running` automatically
     * shimmers; terminal `success` and `error` tones are static. Defaults to the
     * neutral tone.
     */
    tone?: "default" | "running" | "success" | "error";
}
/** An @-mention pill bound to one of the calling plugin's mention providers. */
interface PluginComposerMention {
    /** Mention provider id registered by THIS plugin via `patcher.ui.registerMentionProvider`. */
    provider: string;
    /** Item id your provider's `resolve` will receive at send time. */
    id: string;
    /** Pill text shown in the composer. */
    label: string;
}
/**
 * Programmatic access to the chat composer draft — the same shared draft the
 * built-in "Add to chat" affordances (file preview, diff, terminal selections)
 * write to. While a queued message is being edited, writes land in that
 * message's inline editor. In a side chat, writes land in the visible side-chat
 * draft. Otherwise, inside a thread context writes land in that thread's draft;
 * anywhere else (nav panel, homepage section) they seed the new-thread composer
 * draft, which persists until the user sends or clears it.
 */
interface PluginComposerApi {
    scope: PluginComposerScope;
    /** Current plain text for this composer scope. */
    readonly text: string;
    /**
     * Replace the draft's plain text. Attachments are preserved. Inline mentions
     * outside the changed range are preserved and rebased; mentions overlapped
     * by the replacement are removed because their text representation changed.
     */
    setText(next: string): void;
    /**
     * Replace the draft's plain text from the latest committed value. Uses the
     * same structured-state reconciliation as `setText`.
     */
    updateText(updater: (current: string) => string): void;
    /** Clear plain text without clearing independently attached files. */
    clear(): void;
    /**
     * Apply a host-rendered effect to this composer's editable text, or clear it.
     * Effects are scoped to the calling plugin and automatically clear when the
     * slot unmounts or its composer scope changes.
     */
    setTextEffect(effect: PluginComposerTextEffect | null): void;
    /**
     * Lock or unlock editing for this composer. Locks are scoped to the calling
     * plugin and automatically release when the slot unmounts or its composer
     * scope changes.
     */
    setInputLock(locked: boolean): void;
    /**
     * Append text to the draft as a `> ` blockquote block and focus the
     * composer. Blank text is a no-op. This is the "reference this selection
     * in chat" primitive.
     */
    addQuote(text: string): void;
    /**
     * Insert an @-mention pill that resolves through this plugin's mention
     * provider at send time — the durable way to reference an entity whose
     * content should be fetched fresh when the message is sent.
     */
    insertMention(mention: PluginComposerMention): void;
    /** Focus the composer caret at the end of the draft. */
    focus(): void;
}
/**
 * A consumer-supplied action on the messages of one `ThreadChat` instance,
 * rendered in the embedded timeline's per-message action bar alongside the
 * native and slot-registered actions. Unlike the `messageAction` slot this is
 * scoped to the rendering component, not registered globally.
 */
interface ThreadChatMessageAction {
    /** Unique within this ThreadChat instance; letters, digits, `-`, `_`. */
    id: string;
    /** Tooltip / menu label for the action. */
    title: string;
    /** Icon hint (Patcher icon name); unknown names fall back to a generic icon. */
    icon?: string;
    /**
     * Message roles the action applies to. Omitted = both user and assistant
     * messages.
     */
    roles?: readonly ("user" | "assistant")[];
    /**
     * Runs when the user activates the action. Errors (sync or async) are
     * contained and logged; they never break the timeline.
     */
    run(message: ThreadChatMessageReference): void | Promise<void>;
}
/**
 * Props of the host-owned `ThreadChat` component — one thread's chat
 * (timeline, and for the composer variants the full send/queue/draft
 * engine), rendered by the Patcher app inside a plugin slot. This is the
 * deliberate exception to the no-host-components rule (§5.5): a stable
 * product capability, not a UI kit. Versioned additive like slot props;
 * internal timeline rows, query hooks, and prompt-box configuration are
 * deliberately not exposed.
 */
interface ThreadChatProps {
    threadId: string;
    /**
     * "full" (default) is the page presentation (centered reading width);
     * "compact" is the side-panel presentation; "timeline" renders the
     * transcript without a composer.
     */
    variant?: "full" | "compact" | "timeline";
    /**
     * "contained" (default) fills and scrolls inside a bounded parent;
     * "document" grows with its content and defers scrolling to the page.
     */
    layout?: "contained" | "document";
    /** Bump to focus the composer (ignored by `variant: "timeline"`). */
    focusRequest?: number;
    /**
     * Who controls the permission mode sends run with. "inherit" (default)
     * pins every send to the thread's own resolved default and renders the
     * picker as a dimmed label — a plugin surface can never widen it.
     * "editable" gives this chat its own picker, so the user can raise or
     * lower permissions for this thread independently of the thread it was
     * forked from. Ignored by `variant: "timeline"` (no composer).
     */
    permissionPolicy?: "inherit" | "editable";
    className?: string;
    /** Rendered above the conversation, scrolling with it. */
    leadingContent?: ReactNode;
    /**
     * Actions rendered in this instance's per-message action bar (see
     * {@link ThreadChatMessageAction}).
     */
    messageActions?: readonly ThreadChatMessageAction[];
}
/**
 * Every selection the composer resolved, JSON-serializable so a plugin can
 * forward it to its own backend rpc verbatim and hand it straight to
 * `patcher.sdk.threads.spawn`.
 *
 * The split is deliberate: the composer owns *user selections*, the plugin
 * owns *filing and attribution*. `patcher.sdk.threads.spawn` auto-fills
 * `origin: "plugin"` and `originPluginId`, so a thread created this way stays
 * attributed to the plugin — which it would not be if the component created
 * the thread itself. The plugin adds `sectionId`, `parentThreadId`, `title`,
 * and `visibility` to the request on its own; they are deliberately not
 * composer props.
 */
interface NewThreadRequest {
    projectId: string;
    providerId: string;
    model: string;
    reasoningLevel: ReasoningLevel;
    permissionMode: PermissionMode;
    /** Omitted when the selected provider has no service tiers. */
    serviceTier?: ServiceTier;
    /**
     * Per-field provenance (caller-explicit vs. default) for the execution
     * options above, forwarded to `spawn` so the server records what the user
     * actually chose.
     */
    executionInputSources: CreateExecutionInputSources;
    environment: CreateThreadEnvironmentArgs;
    input: PromptInput[];
}
/**
 * Props of the host-owned `experimental_NewThreadComposer` component — Patcher's
 * full new-thread compose surface (prompt editor with @-mentions and expand,
 * attachments, provider/model/reasoning picker, voice, submit, and the row
 * beneath with project, environment, branch-from, and permission mode),
 * rendered by the Patcher app inside a plugin slot.
 *
 * It is the create-side counterpart to `ThreadChat`: same deliberate
 * exception to the no-host-components rule (§5.5), same additive versioning.
 */
interface NewThreadComposerProps {
    /** Seeds the project picker. The user can change it. */
    defaultProjectId?: string;
    /**
     * Seeds the provider picker. Like every `default*` prop this is a SEED, not
     * a controlled value: the composer stays uncontrolled, the user can change
     * it, and when omitted the composer falls back to the project's remembered
     * execution defaults exactly as before. When provided it takes precedence
     * over those project defaults.
     *
     * Re-seeding: the `default*` props are value-compared each render. When any
     * of them changes after mount, the composer re-seeds EVERY execution and
     * environment selection from the new props — including selections the user
     * had already touched — so switching between two saved records in the same
     * mounted composer reloads that record's values (the same rule
     * `defaultProjectId` already follows).
     *
     * Every seeded field is reported as caller-explicit in the submitted
     * request's `executionInputSources`. That is what makes the seed survive
     * `threads.spawn`: the server drops a requested `providerId`/`model` that
     * carries no provenance source and re-derives it from the project's stored
     * defaults, which would silently undo the seed.
     */
    defaultProviderId?: string;
    /** Seeds the model picker. Same seed semantics as {@link defaultProviderId}. */
    defaultModel?: string;
    /**
     * Seeds the reasoning-level picker. Same seed semantics as
     * {@link defaultProviderId}. If the seeded model does not support this
     * level, the composer reconciles to the closest supported one.
     */
    defaultReasoningLevel?: ReasoningLevel;
    /**
     * Seeds the service-tier picker. Same seed semantics as
     * {@link defaultProviderId}. Ignored (and omitted from the submitted
     * request) when the selected provider has no service tiers.
     */
    defaultServiceTier?: ServiceTier;
    /** Seeds the permission-mode picker. Same seed semantics as {@link defaultProviderId}. */
    defaultPermissionMode?: PermissionMode;
    /**
     * Seeds the environment and branch pickers from a previously submitted
     * `NewThreadRequest.environment`. Same seed semantics as
     * {@link defaultProviderId}: a seed the user can change, taking precedence
     * over the composer's own environment default when provided.
     *
     * Round trip: feeding a submitted request's `environment` back in and
     * resubmitting untouched reproduces an equivalent environment, with these
     * documented limits — the composer cannot represent every args variant:
     *
     * - `{ type: "project-default" }` seeds nothing; the composer resolves its
     *   own default and submits that concrete environment instead.
     * - A `host` environment whose host no longer exists (or whose project has
     *   no source on it) falls back to the composer's default host, exactly as
     *   the primary compose surface would.
     * - A `reuse` environment whose worktree no longer has unarchived threads
     *   falls back the same way.
     * - An `unmanaged` workspace's `path` has no composer control; the seeded
     *   selection submits `path: null` (the host's configured checkout). The
     *   composer itself never produces a non-null `path`, so real round trips
     *   are unaffected.
     * - A `managed-worktree` with `baseBranch: { kind: "default" }` leaves the
     *   branch picker on its default, which may resolve to a named base branch
     *   when the project configures a dedicated worktree base — the same branch
     *   the original `default` submission would have created from.
     */
    defaultEnvironment?: CreateThreadEnvironmentArgs;
    /** Seeds the draft, only while the draft is still empty. */
    initialPrompt?: string;
    placeholder?: string;
    /**
     * "contained" (default) fills and scrolls inside a bounded parent;
     * "document" grows with its content and defers scrolling to the page.
     */
    layout?: "contained" | "document";
    /** Bump to focus the editor. */
    focusRequest?: number;
    className?: string;
    /**
     * Where the draft persists. Drafts survive reloads and are shared by every
     * composer using the same key; defaults to a key scoped to this plugin.
     */
    draftKey?: string;
    /**
     * Fires on submit with every selection resolved. The draft clears when this
     * resolves and is KEPT if it throws, so a failed create never loses what the
     * user typed.
     */
    onSubmit: (request: NewThreadRequest) => void | Promise<void>;
}
/**
 * Props of the host-owned `Markdown` component — Patcher's chat message renderer
 * (the same typography, spacing, and code styling as timeline messages).
 * Use it wherever plugin UI quotes or previews message content so it reads
 * like the rest of the chat. Like `ThreadChat`, this is a stable product
 * capability, not a UI kit; renderer internals stay private.
 */
interface MarkdownProps {
    /** Markdown source, rendered exactly like a chat message body. */
    content: string;
    className?: string;
}
/** Current app selection, derived from the route. */
interface PatcherContext {
    projectId: string | null;
    threadId: string | null;
}
interface PatcherNavigate {
    toThread(threadId: string): void;
    toProject(projectId: string): void;
    /**
     * Navigate to one of this plugin's own nav panels by its `path`.
     * `subPath` targets a location inside the panel (the component's
     * `subPath` prop); `replace` swaps the current history entry instead of
     * pushing — use it for redirects so back does not bounce.
     */
    toPluginPanel(path: string, options?: {
        subPath?: string;
        replace?: boolean;
    }): void;
    /**
     * Navigate to the root compose surface (the new-thread screen). Pass
     * `initialPrompt` to seed the composer draft and `focusPrompt` to focus the
     * composer on arrival — the pairing behind "Create via chat" style entry
     * points that drop the user into chat with a prefilled prompt.
     */
    toCompose(options?: {
        initialPrompt?: string;
        focusPrompt?: boolean;
    }): void;
    /**
     * Open one of this plugin's registered thread-panel actions in the current
     * thread surface. Returns false when the surface has no thread side panel or
     * the action is unavailable.
     */
    openThreadPanel(options: {
        actionId: string;
        title?: string;
        params?: JsonValue;
    }): boolean;
}
/**
 * Everything `@patcher/plugin-sdk/app` resolves to at runtime. The Patcher app builds
 * the real implementation and `satisfies` this interface; `patcher plugin build`
 * shims the specifier to that object on `globalThis.__patcherPluginRuntime`.
 */
interface PluginSdkApp {
    definePluginApp(setup: PluginAppSetup): PluginAppDefinition;
    useRpc<Contract extends PluginRpcContract = PluginRpcContract>(): PluginRpcClient<Contract>;
    useRealtime(channel: string, handler: (payload: unknown) => void): void;
    /**
     * Observe the same shared connection that delivers `useRealtime` signals.
     * Use a subsequent transition to `connected` to reconcile server state that
     * may have changed while ephemeral signals could not be delivered. The first
     * connection can transition from `connecting` and is not a reconnection.
     */
    useRealtimeConnectionState(): PluginRealtimeConnectionState;
    useSettings(): PluginSettingsState;
    usePatcherContext(): PatcherContext;
    usePatcherNavigate(): PatcherNavigate;
    useComposer(): PluginComposerApi;
    /**
     * The sidebar's live thread view (see {@link PluginSidebarThreadsState}).
     * Reads the host's own cache and realtime subscriptions, so it costs no
     * extra request and updates exactly when the built-in sidebar does.
     * Experimental: see docs/api_to_audit.md.
     */
    experimental_useSidebarThreads(): PluginSidebarThreadsState;
    /**
     * Thread actions bound to the host's mutations (see
     * {@link PluginSidebarThreadActions}). Experimental: see
     * docs/api_to_audit.md.
     */
    experimental_useSidebarThreadActions(): PluginSidebarThreadActions;
    /**
     * The pull request for one thread's branch (see
     * {@link PluginSidebarThreadPullRequestState}).
     *
     * Per row and opt-in, because it costs a git-host lookup: it is NOT on the
     * thread payload every sidebar loads. Threads sharing an environment share
     * one query, and the host owns the polling and staleness rules — an open PR
     * with pending checks refreshes, a merged one does not.
     *
     * Experimental: see docs/api_to_audit.md.
     */
    experimental_useSidebarThreadPullRequest(threadId: string): PluginSidebarThreadPullRequestState;
    /**
     * Per-row drag-to-split support (see {@link PluginSidebarThreadSplit}).
     * Call it once per rendered row, like the built-in sidebar does.
     * Experimental: see docs/api_to_audit.md.
     */
    experimental_useSidebarThreadSplit(threadId: string): PluginSidebarThreadSplit;
    /**
     * The host-owned chat component (see {@link ThreadChatProps}). Together
     * with `Markdown`, the only components the SDK ships — everything else
     * stays vendored per §5.5.
     */
    ThreadChat: ComponentType<ThreadChatProps>;
    /**
     * The host-owned chat-message markdown renderer (see
     * {@link MarkdownProps}).
     */
    Markdown: ComponentType<MarkdownProps>;
    /**
     * The host-owned new-thread compose surface (see
     * {@link NewThreadComposerProps}). Experimental: see
     * docs/api_to_audit.md for what to audit before the prefix drops.
     */
    experimental_NewThreadComposer: ComponentType<NewThreadComposerProps>;
    useComposerView(): ComposerView;
}

interface BrowserHistoryListArgs {
    /** How many entries, newest first. Defaults to the server's own limit. */
    limit?: number;
    /** Substring of the URL or title, matched case-insensitively. */
    query?: string;
    /** One surface's history — a thread id, or the browser surface's own id. */
    scopeId?: string;
    signal?: AbortSignal;
}
interface BrowserHistoryRecordArgs {
    scopeId: string;
    url: string;
    title: string | null;
    /** When the visit happened. Defaults to now; set it to import old visits. */
    visitedAt?: number;
}
interface BrowserHistoryRemoveArgs {
    id: string;
}
interface BrowserHistoryClearArgs {
    /** One surface's history; omit to clear all of it. */
    scopeId?: string;
}
/**
 * The browser's history store.
 *
 * A real store rather than the browser's private state: a plugin can read what
 * was visited, add visits it imported from somewhere else, and delete what the
 * user should not have kept. What it cannot do from here is see a visit as it
 * happens — that is `patcher.browser.registerHistoryFilter`, which runs before the
 * write and can rewrite or drop it.
 */
interface BrowserHistoryArea {
    list(args?: BrowserHistoryListArgs): Promise<BrowserHistoryEntry[]>;
    /** Null when a history filter dropped the visit. */
    record(args: BrowserHistoryRecordArgs): Promise<BrowserHistoryEntry | null>;
    remove(args: BrowserHistoryRemoveArgs): Promise<void>;
    /** How many entries were removed. */
    clear(args?: BrowserHistoryClearArgs): Promise<number>;
}

interface EnvironmentActionArgs {
    environmentId: string;
}
interface EnvironmentGetArgs extends EnvironmentActionArgs {
    signal?: AbortSignal;
}
type EnvironmentMergeBaseBranchUpdateValue = Exclude<UpdateEnvironmentRequest["mergeBaseBranch"], undefined>;
type EnvironmentNameUpdateValue = Exclude<UpdateEnvironmentRequest["name"], undefined>;
interface EnvironmentMergeBaseBranchUpdate {
    mergeBaseBranch: EnvironmentMergeBaseBranchUpdateValue;
    name?: EnvironmentNameUpdateValue;
}
interface EnvironmentNameUpdate {
    mergeBaseBranch?: EnvironmentMergeBaseBranchUpdateValue;
    name: EnvironmentNameUpdateValue;
}
type EnvironmentUpdateFields = EnvironmentMergeBaseBranchUpdate | EnvironmentNameUpdate;
type EnvironmentUpdateArgs = EnvironmentUpdateFields & {
    environmentId: string;
};
interface EnvironmentStatusArgs extends EnvironmentStatusQuery {
    environmentId: string;
    signal?: AbortSignal;
}
type EnvironmentDiffArgs = EnvironmentDiffQuery & {
    environmentId: string;
    signal?: AbortSignal;
};
type EnvironmentDiffFileArgs = EnvironmentDiffFileQuery & {
    environmentId: string;
    signal?: AbortSignal;
};
interface EnvironmentDiffBranchesArgs extends EnvironmentDiffBranchesQuery {
    environmentId: string;
    signal?: AbortSignal;
}
interface EnvironmentCommitArgs {
    environmentId: string;
}
interface EnvironmentSquashMergeArgs {
    environmentId: string;
    mergeBaseBranch: string;
}
interface EnvironmentPullRequestMergeArgs {
    environmentId: string;
    method: PullRequestMergeMethod;
}
type EnvironmentDiffPatchArgs = EnvironmentDiffPatchRequest & {
    environmentId: string;
    signal?: AbortSignal;
};
interface EnvironmentPathsArgs extends EnvironmentPathsQuery {
    environmentId: string;
    signal?: AbortSignal;
}
type EnvironmentArchiveThreadsResult = EnvironmentArchiveThreadsResponse;
type EnvironmentCommitResult = CommitActionResponse;
type EnvironmentDiffResult = EnvironmentDiffResponse;
type EnvironmentDiffBranchesResult = EnvironmentDiffBranchesResponse;
type EnvironmentDiffFileResult = EnvironmentDiffFileResponse;
type EnvironmentDiffFilesResult = EnvironmentDiffFilesResponse;
type EnvironmentDiffPatchResult = EnvironmentDiffPatchResponse;
type EnvironmentGetResult = Environment;
type EnvironmentMarkPullRequestDraftResult = PullRequestDraftActionResponse;
type EnvironmentMarkPullRequestReadyResult = PullRequestReadyActionResponse;
type EnvironmentMergePullRequestResult = PullRequestMergeActionResponse;
type EnvironmentPathsResult = WorkspacePathListResponse;
type EnvironmentPullRequestResult = EnvironmentPullRequestResponse;
type EnvironmentSquashMergeResult = SquashMergeActionResponse;
type EnvironmentStatusResult = EnvironmentStatusResponse;
type EnvironmentUpdateResult = Environment;
interface EnvironmentsArea {
    archiveThreads(args: EnvironmentActionArgs): Promise<EnvironmentArchiveThreadsResult>;
    commit(args: EnvironmentCommitArgs): Promise<EnvironmentCommitResult>;
    diff(args: EnvironmentDiffArgs): Promise<EnvironmentDiffResult>;
    diffBranches(args: EnvironmentDiffBranchesArgs): Promise<EnvironmentDiffBranchesResult>;
    diffFile(args: EnvironmentDiffFileArgs): Promise<EnvironmentDiffFileResult>;
    diffFiles(args: EnvironmentDiffArgs): Promise<EnvironmentDiffFilesResult>;
    diffPatch(args: EnvironmentDiffPatchArgs): Promise<EnvironmentDiffPatchResult>;
    get(args: EnvironmentGetArgs): Promise<EnvironmentGetResult>;
    pullRequest(args: EnvironmentGetArgs): Promise<EnvironmentPullRequestResult>;
    markPullRequestDraft(args: EnvironmentActionArgs): Promise<EnvironmentMarkPullRequestDraftResult>;
    markPullRequestReady(args: EnvironmentActionArgs): Promise<EnvironmentMarkPullRequestReadyResult>;
    mergePullRequest(args: EnvironmentPullRequestMergeArgs): Promise<EnvironmentMergePullRequestResult>;
    paths(args: EnvironmentPathsArgs): Promise<EnvironmentPathsResult>;
    squashMerge(args: EnvironmentSquashMergeArgs): Promise<EnvironmentSquashMergeResult>;
    status(args: EnvironmentStatusArgs): Promise<EnvironmentStatusResult>;
    update(args: EnvironmentUpdateArgs): Promise<EnvironmentUpdateResult>;
}

/**
 * Host file primitives. `hostId` may be omitted to target the server's
 * primary (local) host. `rootPath`, when set, confines the target beneath
 * that absolute root on the host (symlink-safe).
 */
interface FileReadArgs {
    hostId?: string;
    path: string;
    rootPath?: string;
    signal?: AbortSignal;
}
interface FileWriteArgs {
    hostId?: string;
    path: string;
    rootPath?: string;
    content: string;
    /** Defaults to "utf8". */
    contentEncoding?: "utf8" | "base64";
    /** Defaults to false. */
    createParents?: boolean;
    /**
     * Optimistic-concurrency guard: omitted → unconditional write; a hash →
     * write only when the current content hashes to it (use `read().sha256`);
     * null → create-only. A failed guard resolves to the `conflict` outcome.
     */
    expectedSha256?: string | null;
    /** POSIX permission bits used when creating a file (for example 0o600). */
    mode?: number;
}
interface FileListArgs {
    hostId?: string;
    path: string;
    query?: string;
    limit?: number;
    signal?: AbortSignal;
}
interface PathListArgs extends FileListArgs {
    includeFiles: boolean;
    includeDirectories: boolean;
}
interface FileMkdirArgs {
    hostId?: string;
    path: string;
    rootPath?: string;
    recursive?: boolean;
}
interface FileMoveArgs {
    hostId?: string;
    sourcePath: string;
    destinationPath: string;
    rootPath?: string;
}
interface FileRemoveArgs {
    hostId?: string;
    path: string;
    rootPath?: string;
    recursive?: boolean;
}
interface FilePreviewArgs {
    hostId?: string;
    rootPath: string;
    signal?: AbortSignal;
    ttlMs?: number;
}
type FileReadResult = HostFileReadResponse;
type FileWriteResult = HostFileWriteResponse;
type FileListResult = HostFileListResponse;
type PathListResult = HostPathListResponse;
type FileMkdirResult = HostMkdirResponse;
type FileMoveResult = HostMovePathResponse;
type FileRemoveResult = HostRemovePathResponse;
type FilePreviewResult = CreateFilePreviewResponse;
interface FilesArea {
    read(args: FileReadArgs): Promise<FileReadResult>;
    write(args: FileWriteArgs): Promise<FileWriteResult>;
    list(args: FileListArgs): Promise<FileListResult>;
    listPaths(args: PathListArgs): Promise<PathListResult>;
    mkdir(args: FileMkdirArgs): Promise<FileMkdirResult>;
    move(args: FileMoveArgs): Promise<FileMoveResult>;
    remove(args: FileRemoveArgs): Promise<FileRemoveResult>;
    createPreview(args: FilePreviewArgs): Promise<FilePreviewResult>;
}

interface GuideRenderArgs {
    chapter?: string;
}
interface GuideRenderResult {
    chapter?: string;
    content: string;
}
interface GuideArea {
    render(args?: GuideRenderArgs): GuideRenderResult;
}

interface HostGetArgs {
    hostId: string;
    signal?: AbortSignal;
}
interface HostDeleteArgs {
    hostId: string;
}
interface HostUpdateArgs extends UpdateHostRequest {
    hostId: string;
}
interface HostRetryUpdateArgs {
    hostId: string;
}
interface HostDirectoryArgs extends HostDirectoryQuery {
    hostId: string;
    signal?: AbortSignal;
}
interface HostCloneDefaultPathArgs extends HostCloneDefaultPathQuery {
    hostId: string;
    signal?: AbortSignal;
}
interface HostPathsExistArgs extends HostPathsExistRequest {
    hostId: string;
    signal?: AbortSignal;
}
interface HostPickFolderArgs extends HostPickFolderRequest {
    hostId: string;
    signal?: AbortSignal;
}
interface HostProviderCliInstallArgs extends HostProviderCliInstallRequest {
    hostId: string;
}
interface HostListArgs {
    signal?: AbortSignal;
}
type HostCreateJoinCodeResult = CreateHostJoinCodeResponse;
type HostDeleteResult = {
    ok: true;
};
type HostDirectoryResult = HostDirectoryListing;
type HostGetResult = Host;
type HostCloneDefaultPathResult = HostCloneDefaultPathResponse;
type HostProviderCliInstallResult = HostProviderCliInstallEvent[];
type HostListResult = Host[];
type HostPathsExistResult = HostPathsExistResponse;
type HostPickFolderResult = HostPickFolderResponse;
type HostProviderCliStatusResult = HostProviderCliStatusResponse;
type HostRetryUpdateResult = HostRetryUpdateResponse;
type HostUpdateResult = Host;
interface HostsArea {
    createJoinCode(): Promise<HostCreateJoinCodeResult>;
    delete(args: HostDeleteArgs): Promise<HostDeleteResult>;
    directory(args: HostDirectoryArgs): Promise<HostDirectoryResult>;
    get(args: HostGetArgs): Promise<HostGetResult>;
    cloneDefaultPath(args: HostCloneDefaultPathArgs): Promise<HostCloneDefaultPathResult>;
    installProviderCli(args: HostProviderCliInstallArgs): Promise<HostProviderCliInstallResult>;
    list(args?: HostListArgs): Promise<HostListResult>;
    pathsExist(args: HostPathsExistArgs): Promise<HostPathsExistResult>;
    pickFolder(args: HostPickFolderArgs): Promise<HostPickFolderResult>;
    providerCliStatus(args: HostGetArgs): Promise<HostProviderCliStatusResult>;
    retryUpdate(args: HostRetryUpdateArgs): Promise<HostRetryUpdateResult>;
    update(args: HostUpdateArgs): Promise<HostUpdateResult>;
}

interface ProjectListArgs {
    include?: ProjectListQuery["include"];
    /** Include the singleton personal project. Defaults to false for compatibility. */
    includePersonal?: boolean;
    signal?: AbortSignal;
}
interface ProjectCreateArgs extends CreateProjectRequest {
}
interface ProjectGetArgs {
    projectId: string;
    signal?: AbortSignal;
}
interface ProjectUpdateArgs extends UpdateProjectRequest {
    projectId: string;
}
interface ProjectDeleteArgs {
    projectId: string;
}
interface ProjectReorderArgs extends ReorderProjectRequest {
    projectId: string;
}
interface ProjectPromptHistoryArgs extends PromptHistoryQuery {
    projectId: string;
    signal?: AbortSignal;
}
/** Select one project workspace source, or omit both for the primary host. */
type ProjectWorkspaceRoutingArgs = {
    environmentId: string;
    hostId?: never;
} | {
    environmentId?: never;
    hostId: string;
} | {
    environmentId?: never;
    hostId?: never;
};
type ProjectFilesArgs = ProjectWorkspaceRoutingArgs & Omit<ProjectFilesQuery, "environmentId" | "hostId"> & {
    projectId: string;
    signal?: AbortSignal;
};
type ProjectPathsArgs = ProjectWorkspaceRoutingArgs & Omit<ProjectPathsQuery, "environmentId" | "hostId"> & {
    projectId: string;
    signal?: AbortSignal;
};
type ProjectCommandsArgs = ProjectWorkspaceRoutingArgs & Omit<ProjectCommandsQuery, "environmentId" | "hostId"> & {
    projectId: string;
    signal?: AbortSignal;
};
type ProjectFileContentArgs = ProjectWorkspaceRoutingArgs & Omit<ProjectFileContentQuery, "environmentId" | "hostId"> & {
    projectId: string;
    signal?: AbortSignal;
};
interface ProjectBranchesArgs extends ProjectBranchesQuery {
    projectId: string;
    signal?: AbortSignal;
}
interface ProjectDefaultExecutionOptionsArgs {
    projectId: string;
    signal?: AbortSignal;
}
interface ProjectAttachmentFileLike {
    arrayBuffer(): Promise<ArrayBuffer>;
    readonly name: string;
    readonly type?: string;
}
interface ProjectAttachmentUploadArgsBase {
    /** MIME override. Omit to use the File/Blob type, when available. */
    mimeType?: string;
    projectId: string;
}
/**
 * Upload bytes owned by this SDK client. A bare Blob/byte buffer needs an
 * explicit filename; File-like values can supply their own name.
 */
type ProjectAttachmentUploadArgs = ProjectAttachmentUploadArgsBase & ({
    clientFile: ProjectAttachmentFileLike;
    filename?: string;
} | {
    clientFile: ArrayBuffer | Blob | Uint8Array;
    filename: string;
});
interface ProjectAttachmentReadArgs {
    path: string;
    projectId: string;
    signal?: AbortSignal;
}
interface ProjectAttachmentCopyArgs extends CopyProjectAttachmentsRequest {
    projectId: string;
}
type ProjectSourceAddArgs = CreateProjectSourceRequest & {
    projectId: string;
};
interface ProjectSourceUpdateArgs extends UpdateProjectSourceRequest {
    projectId: string;
    sourceId: string;
}
interface ProjectSourceDeleteArgs {
    projectId: string;
    sourceId: string;
}
type ProjectBranchesResult = ProjectBranchesResponse;
interface ProjectAttachmentReadResult {
    bytes: Uint8Array;
    mimeType: string;
    sizeBytes: number;
}
type ProjectAttachmentUploadResult = UploadedPromptAttachment;
type ProjectCommandsResult = CommandListResponse;
type ProjectCreateResult = ProjectResponse;
type ProjectDefaultExecutionOptionsResult = ProjectExecutionDefaults | null;
type ProjectDeleteResult = {
    ok: true;
};
interface ProjectFileContentResult {
    /** UTF-8 text or base64, as selected by `contentEncoding`. */
    content: string;
    contentEncoding: "utf8" | "base64";
    mimeType: string;
    sizeBytes: number;
}
type ProjectFilesResult = WorkspaceFileListResponse;
type ProjectGetResult = ProjectResponse;
type ProjectListResult = ProjectResponse[] | ProjectWithThreadsResponse[];
type ProjectPathsResult = WorkspacePathListResponse;
type ProjectPromptHistoryResult = PromptHistoryResponse;
type ProjectReorderResult = ProjectResponse[];
type ProjectSourceAddResult = ProjectSource;
type ProjectSourceDeleteResult = {
    ok: true;
};
type ProjectSourceUpdateResult = ProjectSource;
type ProjectUpdateResult = ProjectResponse;
interface ProjectSourcesArea {
    add(args: ProjectSourceAddArgs): Promise<ProjectSourceAddResult>;
    delete(args: ProjectSourceDeleteArgs): Promise<ProjectSourceDeleteResult>;
    update(args: ProjectSourceUpdateArgs): Promise<ProjectSourceUpdateResult>;
}
interface ProjectAttachmentsArea {
    copy(args: ProjectAttachmentCopyArgs): Promise<void>;
    read(args: ProjectAttachmentReadArgs): Promise<ProjectAttachmentReadResult>;
    upload(args: ProjectAttachmentUploadArgs): Promise<ProjectAttachmentUploadResult>;
}
interface ProjectsArea {
    attachments: ProjectAttachmentsArea;
    branches(args: ProjectBranchesArgs): Promise<ProjectBranchesResult>;
    commands(args: ProjectCommandsArgs): Promise<ProjectCommandsResult>;
    create(args: ProjectCreateArgs): Promise<ProjectCreateResult>;
    defaultExecutionOptions(args: ProjectDefaultExecutionOptionsArgs): Promise<ProjectDefaultExecutionOptionsResult>;
    delete(args: ProjectDeleteArgs): Promise<ProjectDeleteResult>;
    fileContent(args: ProjectFileContentArgs): Promise<ProjectFileContentResult>;
    files(args: ProjectFilesArgs): Promise<ProjectFilesResult>;
    get(args: ProjectGetArgs): Promise<ProjectGetResult>;
    list(args?: ProjectListArgs): Promise<ProjectListResult>;
    paths(args: ProjectPathsArgs): Promise<ProjectPathsResult>;
    promptHistory(args: ProjectPromptHistoryArgs): Promise<ProjectPromptHistoryResult>;
    reorder(args: ProjectReorderArgs): Promise<ProjectReorderResult>;
    sources: ProjectSourcesArea;
    update(args: ProjectUpdateArgs): Promise<ProjectUpdateResult>;
}

/** Select exactly one provider-discovery host source, or omit both for primary. */
type ProviderHostRoutingArgs = {
    environmentId: string;
    hostId?: never;
} | {
    environmentId?: never;
    hostId: string;
} | {
    environmentId?: never;
    hostId?: never;
};
type ProviderListArgs = ProviderHostRoutingArgs & {
    signal?: AbortSignal;
};
type ProviderModelsArgs = ProviderHostRoutingArgs & {
    providerId?: string;
    signal?: AbortSignal;
};
type ProviderListResult = ProviderInfo[];
type ProviderModelsResult = SystemExecutionOptionsResponse;
interface ProvidersArea {
    /** List providers on the environment host, explicit host, or primary host. */
    list(args?: ProviderListArgs): Promise<ProviderListResult>;
    /** List models on the environment host, explicit host, or primary host. */
    models(args?: ProviderModelsArgs): Promise<ProviderModelsResult>;
}

interface PluginIdArgs {
    pluginId: string;
}
/** Install directly from a path:, git:, npm:, or builtin: source spec. */
interface PluginInstallArgs {
    source: string;
}
/** Install an entry from Patcher's official catalog. */
interface PluginCatalogInstallArgs {
    entryId: string;
}
interface PluginReloadArgs {
    pluginId?: string;
}
interface PluginSettingsUpdateArgs extends PluginIdArgs {
    values: Record<string, JsonValue$1>;
}
interface PluginTokenArgs extends PluginIdArgs {
    rotate?: boolean;
}
interface PluginCheckUpdatesArgs {
    pluginId?: string;
    signal?: AbortSignal;
}
interface PluginRpcArgs<TOutput> extends PluginIdArgs {
    input?: JsonValue$1;
    method: string;
    outputSchema: z$1.ZodType<TOutput>;
}
interface PluginCatalogSearchArgs {
    query: string;
    signal?: AbortSignal;
}
interface PluginCatalogStatusArgs {
    signal?: AbortSignal;
}
interface PluginGetSettingsArgs extends PluginIdArgs {
    signal?: AbortSignal;
}
interface PluginGetSourceArgs extends PluginIdArgs {
    signal?: AbortSignal;
}
interface PluginListArgs {
    signal?: AbortSignal;
}
interface PluginListUpdateResultsArgs {
    signal?: AbortSignal;
}
type PluginDisableResult = InstalledPlugin;
type PluginEnableResult = InstalledPlugin;
type PluginGetSettingsResult = PluginSettingsResponse;
type PluginInstallResult = InstalledPlugin;
type PluginListResult = PluginListResponse;
type PluginReloadResult = PluginReloadResponse;
type PluginRemoveResult = PluginRemoveResponse;
type PluginTokenResult = PluginTokenResponse;
type PluginUpdateSettingsResult = PluginSettingsResponse;
type PluginGetSourceResult = PluginSourceDetail;
type PluginCheckUpdatesResult = PluginUpdateCheckEntry[];
type PluginApplyUpdateResult = PluginApplyUpdateResult$1;
type PluginCatalogStatusResult = PluginCatalogStatus;
type PluginCatalogSearchResult = PluginCatalogSearchResult$1[];
interface PluginCatalogArea {
    install(args: PluginCatalogInstallArgs): Promise<PluginInstallResult>;
    search(args: PluginCatalogSearchArgs): Promise<PluginCatalogSearchResult>;
    status(args?: PluginCatalogStatusArgs): Promise<PluginCatalogStatusResult>;
}
interface PluginsArea {
    applyUpdate(args: PluginIdArgs): Promise<PluginApplyUpdateResult>;
    callRpc<TOutput>(args: PluginRpcArgs<TOutput>): Promise<TOutput>;
    checkUpdates(args?: PluginCheckUpdatesArgs): Promise<PluginCheckUpdatesResult>;
    catalog: PluginCatalogArea;
    disable(args: PluginIdArgs): Promise<PluginDisableResult>;
    enable(args: PluginIdArgs): Promise<PluginEnableResult>;
    getSettings(args: PluginGetSettingsArgs): Promise<PluginGetSettingsResult>;
    getSource(args: PluginGetSourceArgs): Promise<PluginGetSourceResult>;
    install(args: PluginInstallArgs): Promise<PluginInstallResult>;
    list(args?: PluginListArgs): Promise<PluginListResult>;
    listUpdateResults(args?: PluginListUpdateResultsArgs): Promise<PluginCheckUpdatesResult>;
    reload(args?: PluginReloadArgs): Promise<PluginReloadResult>;
    remove(args: PluginIdArgs): Promise<PluginRemoveResult>;
    token(args: PluginTokenArgs): Promise<PluginTokenResult>;
    updateSettings(args: PluginSettingsUpdateArgs): Promise<PluginUpdateSettingsResult>;
}

type PatcherRealtimeUnsubscribe = () => void;
type PatcherRealtimeEventName = "thread:changed" | "project:changed" | "environment:changed" | "host:changed" | "system:changed" | "system:config-changed" | "realtime:connection";
type ThreadRealtimeEvent = Extract<ChangedMessage, {
    entity: "thread";
}>;
type ProjectRealtimeEvent = Extract<ChangedMessage, {
    entity: "project";
}>;
type EnvironmentRealtimeEvent = Extract<ChangedMessage, {
    entity: "environment";
}>;
type HostRealtimeEvent = Extract<ChangedMessage, {
    entity: "host";
}>;
type SystemRealtimeEvent = Extract<ChangedMessage, {
    entity: "system";
}>;
type PatcherRealtimeConnectionState = "connecting" | "connected" | "disconnected";
interface PatcherRealtimeConnectionEvent {
    reconnectDelayMs: number | null;
    reconnected: boolean;
    state: PatcherRealtimeConnectionState;
}
/**
 * Entity-changed events are delivered as one shared object to every matching
 * listener; their payload types are readonly so a listener cannot mutate what
 * the next listener receives.
 */
interface PatcherRealtimeEventMap {
    "thread:changed": ThreadRealtimeEvent;
    "project:changed": ProjectRealtimeEvent;
    "environment:changed": EnvironmentRealtimeEvent;
    "host:changed": HostRealtimeEvent;
    "system:changed": SystemRealtimeEvent;
    "system:config-changed": SystemRealtimeEvent;
    "realtime:connection": PatcherRealtimeConnectionEvent;
}
type PatcherRealtimeCallback<TEventName extends PatcherRealtimeEventName> = (event: PatcherRealtimeEventMap[TEventName]) => void;
interface ThreadRealtimeSubscribeArgs {
    callback: PatcherRealtimeCallback<"thread:changed">;
    event: "thread:changed";
    threadId?: string;
}
interface ProjectRealtimeSubscribeArgs {
    callback: PatcherRealtimeCallback<"project:changed">;
    event: "project:changed";
    projectId?: string;
}
interface EnvironmentRealtimeSubscribeArgs {
    callback: PatcherRealtimeCallback<"environment:changed">;
    environmentId?: string;
    event: "environment:changed";
}
interface HostRealtimeSubscribeArgs {
    callback: PatcherRealtimeCallback<"host:changed">;
    event: "host:changed";
    hostId?: string;
}
interface SystemRealtimeSubscribeArgs {
    callback: PatcherRealtimeCallback<"system:changed">;
    event: "system:changed";
}
interface SystemConfigRealtimeSubscribeArgs {
    callback: PatcherRealtimeCallback<"system:config-changed">;
    event: "system:config-changed";
}
/**
 * Connection listeners are pure observers — they never open or hold the
 * socket. A listener registered while a socket already exists receives the
 * latest connection event as a snapshot on the next microtask, so a status
 * UI mounted after connect still learns the current state.
 */
interface RealtimeConnectionSubscribeArgs {
    callback: PatcherRealtimeCallback<"realtime:connection">;
    event: "realtime:connection";
}
type PatcherRealtimeSubscribeArgsUnion = ThreadRealtimeSubscribeArgs | ProjectRealtimeSubscribeArgs | EnvironmentRealtimeSubscribeArgs | HostRealtimeSubscribeArgs | SystemRealtimeSubscribeArgs | SystemConfigRealtimeSubscribeArgs | RealtimeConnectionSubscribeArgs;
type PatcherRealtimeSubscribeArgs<TEventName extends PatcherRealtimeEventName = PatcherRealtimeEventName> = Extract<PatcherRealtimeSubscribeArgsUnion, {
    event: TEventName;
}>;
interface PatcherRealtime {
    subscribe<TEventName extends PatcherRealtimeEventName>(args: PatcherRealtimeSubscribeArgs<TEventName>): PatcherRealtimeUnsubscribe;
}

interface StatusGetArgs {
    projectId?: string;
    signal?: AbortSignal;
    threadId?: string;
}
interface StatusThreadSummary {
    environmentId: string | null;
    id: string;
    parentThreadId: string | null;
    pinnedAt: number | null;
    projectId: string;
    status: ThreadStatus;
    title: string | null;
}
type StatusProject = ProjectResponse;
type StatusChildThreads = ThreadListResponse;
interface StatusResult {
    childThreads: StatusChildThreads | null;
    pendingTodos: ThreadTimelinePendingTodos | null;
    project: StatusProject | null;
    thread: StatusThreadSummary | null;
}
interface StatusArea {
    get(args?: StatusGetArgs): Promise<StatusResult>;
}

interface SkillWorkspaceArgs {
    projectId: string;
    environmentId: string | null;
}
interface SkillListArgs extends SkillWorkspaceArgs {
    signal?: AbortSignal;
}
interface SkillIdentityArgs extends SkillListArgs {
    skillId: string;
}
interface SkillContentArgs extends SkillIdentityArgs {
    path: string;
}
interface SkillUpdateArgs extends SkillWorkspaceArgs {
    skillId: string;
    content: string;
    revision: string;
}
interface SkillDeleteArgs extends SkillWorkspaceArgs {
    skillId: string;
}
/**
 * Registry calls proxy out to skills.sh and GitHub, and the browse grid fans
 * out one per card. Callers pass their query's AbortSignal so abandoning a
 * page cancels its requests instead of leaving them in flight.
 */
interface AbortableArgs {
    signal?: AbortSignal;
}
interface RegistrySkillsSearchArgs extends AbortableArgs {
    query?: string;
    page?: number;
    perPage?: number;
}
interface RegistrySkillIdArgs extends AbortableArgs {
    registrySkillId: string;
}
interface RegistrySkillSourceArgs extends AbortableArgs {
    source: string;
    skillId: string;
}
interface RegistryRepositoryArgs extends AbortableArgs {
    source: string;
}
/**
 * Install is a mutation and deliberately takes no signal: its body is parsed
 * with a strict schema, so an extra key would throw at runtime.
 */
interface RegistrySkillInstallArgs {
    registrySkillId: string;
}
interface SkillsRegistryArea {
    detail(args: RegistrySkillSourceArgs): Promise<RegistrySkillDetail>;
    get(args: RegistrySkillIdArgs): Promise<RegistrySkill>;
    install(args: RegistrySkillInstallArgs): Promise<RegistrySkillInstallResponse>;
    repositoryStars(args: RegistryRepositoryArgs): Promise<RegistryRepositoryStars>;
    search(args?: RegistrySkillsSearchArgs): Promise<RegistrySkillsPage>;
}
interface SkillsArea {
    getContent(args: SkillContentArgs): Promise<SkillContentResponse>;
    list(args: SkillListArgs): Promise<SkillListResponse>;
    listFiles(args: SkillIdentityArgs): Promise<SkillFilesResponse>;
    registry: SkillsRegistryArea;
    remove(args: SkillDeleteArgs): Promise<{
        deletedPath: string;
    }>;
    update(args: SkillUpdateArgs): Promise<{
        filePath: string;
        revision: string;
    }>;
}

type ThemeGetResult = AppTheme;
type ThemeCatalogResult = ThemeCatalogResponse;
type ThemeSetInput = AppThemeSelection;
type ThemeSetResult = AppTheme;
interface ThemeCatalogArgs {
    signal?: AbortSignal;
}
interface ThemeGetArgs {
    signal?: AbortSignal;
}
interface ThemeArea {
    /** The active app palette, resolved server-side (built-in id or custom CSS). */
    get(args?: ThemeGetArgs): Promise<ThemeGetResult>;
    /** The custom-theme directory plus discovered themes and the active palette. */
    catalog(args?: ThemeCatalogArgs): Promise<ThemeCatalogResult>;
    /** Set the complete app appearance selection in one request. */
    set(selection: ThemeSetInput): Promise<ThemeSetResult>;
    /**
     * Activate a palette by id while preserving the active favicon color. This
     * compatibility shorthand reads the active appearance before writing the
     * complete selection; prefer the object form when both values are known.
     */
    set(themeId: string): Promise<ThemeSetResult>;
}

interface SystemAttentionArgs {
    signal?: AbortSignal;
}
interface SystemConfigArgs {
    signal?: AbortSignal;
}
interface SystemExecutionOptionsArgs extends SystemExecutionOptionsQuery {
    signal?: AbortSignal;
}
interface SystemUsageLimitsArgs extends SystemUsageLimitsQuery {
    signal?: AbortSignal;
}
interface SystemVersionArgs {
    force?: boolean;
    signal?: AbortSignal;
}
interface SystemVoiceTranscriptionArgs {
    file: Blob;
    prompt?: string;
    signal?: AbortSignal;
}
type SystemAttentionResult = SystemAttentionResponse;
type SystemConfigResult = SystemConfigResponse;
type SystemExecutionOptionsResult = SystemExecutionOptionsResponse;
type SystemReloadConfigResult = SystemConfigReloadResponse;
type SystemInstallCliSkillsArgs = SystemInstallCliSkillsRequest;
interface SystemCliSkillsStatusArgs {
    /** Omit for every enrolled machine. */
    hostIds?: readonly string[];
    signal?: AbortSignal;
}
type SystemCliSkillsStatusResult = SystemCliSkillsStatusResponse;
type SystemInstallCliSkillsResult = SystemInstallCliSkillsResponse;
type SystemVoiceTranscriptionResult = SystemVoiceTranscriptionResponse;
type SystemUpdateExperimentsResult = Experiments;
type SystemUpdateGeneralSettingsResult = AppSettings;
type SystemUpdateKeyboardSettingsResult = AppKeybindingOverrides;
type SystemUsageLimitsResult = ProviderUsageResponse;
interface SystemOnboardingArgs extends SystemProvidersQuery {
    signal?: AbortSignal;
}
interface SystemOnboardingReposArgs extends SystemOnboardingReposQuery {
    signal?: AbortSignal;
}
type SystemOnboardingAgentsResult = OnboardingAgentOverview;
type SystemOnboardingReposResult = DiscoverReposResult;
type SystemVersionResult = SystemVersionResponse;
interface SystemArea {
    attention(args?: SystemAttentionArgs): Promise<SystemAttentionResult>;
    config(args?: SystemConfigArgs): Promise<SystemConfigResult>;
    executionOptions(args?: SystemExecutionOptionsArgs): Promise<SystemExecutionOptionsResult>;
    /**
     * Copy Patcher's built-in CLI skills into each named machine's global agent skill
     * roots (`~/.agents/skills` and `~/.claude/skills`). Machines install
     * independently; the result reports each machine's outcome.
     */
    /** Per-machine install state of Patcher's built-in CLI skills. */
    cliSkillsStatus(args?: SystemCliSkillsStatusArgs): Promise<SystemCliSkillsStatusResult>;
    installCliSkills(args: SystemInstallCliSkillsArgs): Promise<SystemInstallCliSkillsResult>;
    reloadConfig(): Promise<SystemReloadConfigResult>;
    transcribeVoice(args: SystemVoiceTranscriptionArgs): Promise<SystemVoiceTranscriptionResult>;
    updateExperiments(args: Experiments): Promise<SystemUpdateExperimentsResult>;
    updateGeneralSettings(args: AppSettings): Promise<SystemUpdateGeneralSettingsResult>;
    updateKeyboardSettings(args: AppKeybindingOverrides): Promise<SystemUpdateKeyboardSettingsResult>;
    /** Report one onboarding funnel event to anonymous telemetry. */
    onboardingEvent(args: OnboardingTelemetryEvent): Promise<{
        ok: true;
    }>;
    /** Live agent state for onboarding: install, auth, and plan per provider. */
    onboardingAgents(args?: SystemOnboardingArgs): Promise<SystemOnboardingAgentsResult>;
    /** Candidate projects discovered on the host, ranked for onboarding. */
    onboardingRepos(args?: SystemOnboardingReposArgs): Promise<SystemOnboardingReposResult>;
    usageLimits(args?: SystemUsageLimitsArgs): Promise<SystemUsageLimitsResult>;
    version(args?: SystemVersionArgs): Promise<SystemVersionResult>;
}

interface TerminalThreadScope {
    cwd?: never;
    environmentId?: never;
    hostId?: never;
    kind: "thread";
    threadId: string;
}
interface TerminalEnvironmentScope {
    environmentId: string;
    cwd?: never;
    hostId?: never;
    kind: "environment";
    threadId?: never;
}
interface TerminalHostPathListScope {
    /** Optional exact initial working-directory filter on the selected host. */
    cwd?: string;
    environmentId?: never;
    hostId: string;
    kind: "host_path";
    threadId?: never;
}
interface TerminalHostPathCreateScope {
    /** Null starts in the selected host's home directory. */
    cwd: string | null;
    environmentId?: never;
    hostId: string;
    kind: "host_path";
    threadId?: never;
}
type TerminalListScope = TerminalThreadScope | TerminalEnvironmentScope | TerminalHostPathListScope;
type TerminalCreateScope = TerminalThreadScope | TerminalEnvironmentScope | TerminalHostPathCreateScope;
interface TerminalListArgs {
    signal?: AbortSignal;
    scope: TerminalListScope;
}
interface TerminalCreateArgs {
    cols: number;
    rows: number;
    scope: TerminalCreateScope;
    start?: CreateTerminalRequest["start"];
    title?: string;
}
interface TerminalTargetArgs {
    terminalId: string;
}
interface TerminalGetArgs extends TerminalTargetArgs {
    signal?: AbortSignal;
}
interface TerminalRenameArgs extends TerminalTargetArgs {
    title: UpdateTerminalRequest["title"];
}
interface TerminalCloseArgs extends TerminalTargetArgs {
    mode: "force" | "if-clean";
}
interface TerminalInputArgs extends TerminalTargetArgs {
    dataBase64: TerminalInputRequest["dataBase64"];
}
interface TerminalResizeArgs extends TerminalTargetArgs {
    cols: TerminalResizeRequest["cols"];
    rows: TerminalResizeRequest["rows"];
}
interface TerminalOutputArgs extends TerminalTargetArgs {
    limitChunks?: TerminalOutputQuery["limitChunks"];
    signal?: AbortSignal;
    sinceSeq?: TerminalOutputQuery["sinceSeq"];
    tailBytes?: TerminalOutputQuery["tailBytes"];
}
type TerminalRestartArgs = TerminalTargetArgs;
type TerminalListResult = TerminalListResponse;
type TerminalCreateResult = TerminalSession;
type TerminalGetResult = TerminalSession;
type TerminalRenameResult = TerminalSession;
type TerminalCloseResult = TerminalSession;
type TerminalInputResult = TerminalSession;
type TerminalResizeResult = TerminalSession;
type TerminalOutputResult = TerminalOutputResponse;
type TerminalRestartResult = TerminalSession;
interface TerminalsArea {
    close(args: TerminalCloseArgs): Promise<TerminalCloseResult>;
    create(args: TerminalCreateArgs): Promise<TerminalCreateResult>;
    get(args: TerminalGetArgs): Promise<TerminalGetResult>;
    input(args: TerminalInputArgs): Promise<TerminalInputResult>;
    list(args: TerminalListArgs): Promise<TerminalListResult>;
    output(args: TerminalOutputArgs): Promise<TerminalOutputResult>;
    rename(args: TerminalRenameArgs): Promise<TerminalRenameResult>;
    /**
     * Replace a terminal with a shell at the same scope, size, and title.
     * The server serializes concurrent restarts and opens the replacement before
     * closing the old session, so a failed open leaves the old terminal running.
     * The original command is not replayed because terminal sessions do not
     * persist launch commands. The replacement has a new terminal ID.
     */
    restart(args: TerminalRestartArgs): Promise<TerminalRestartResult>;
    resize(args: TerminalResizeArgs): Promise<TerminalResizeResult>;
}

interface ThreadListArgs {
    archived?: boolean;
    sectionId?: string;
    hasParent?: boolean;
    includeHidden?: boolean;
    limit?: number;
    offset?: number;
    originKind?: ThreadListQuery["originKind"];
    originPluginId?: string;
    parentThreadId?: string;
    projectId?: string;
    signal?: AbortSignal;
    sourceThreadId?: string;
    unsectioned?: boolean;
}
interface ThreadSearchArgs extends ThreadSearchQuery {
    signal?: AbortSignal;
}
interface ThreadGetArgs {
    include?: ThreadGetQuery["include"];
    signal?: AbortSignal;
    threadId: string;
}
type ThreadGetResult = ThreadResponse | ThreadWithIncludesResponse;
type ThreadListResult = ThreadListResponse;
type ThreadSearchResult = ThreadSearchResponse;
interface ThreadOutputResponse {
    output: string | null;
}
type ThreadMutationResult = ThreadResponse;
type ThreadSpawnResult = ThreadResponse;
type ThreadForkResult = ThreadResponse;
type ThreadInteractionGetResult = PendingInteraction;
type ThreadInteractionListResult = ThreadPendingInteractionsResponse;
type ThreadInteractionResolveResult = PendingInteraction;
type ThreadInteractionRespondResult = PendingInteraction;
type ThreadInteractionCancelResult = PendingInteraction;
type ThreadEventsListResult = ThreadEventRow[];
type ThreadEventWaitResult = ThreadEventRow | null;
type ThreadTimelineResult = ThreadTimelineResponse;
type ThreadArchiveResult = ThreadArchiveAllResponse;
type ThreadOpenResult = ThreadOpenResponse;
type ThreadPaneActionResult = ThreadPaneActionResponse;
type ThreadDeleteResult = {
    ok: true;
};
type ThreadSendResult = {
    ok: true;
};
type ThreadRateLimitRecoveryResult = ProviderRateLimitRecoveryStatus;
type ThreadContinueAfterRateLimitResult = ContinueAfterProviderRateLimitResponse;
type ThreadEditMessageResult = EditMessageResponse;
type ThreadStopResult = {
    ok: true;
};
type ThreadCompactResult = {
    ok: true;
};
type ThreadBannerActionResult = {
    ok: true;
};
type ThreadUnarchiveResult = {
    ok: true;
};
type ThreadArchiveAllResult = ThreadArchiveAllResponse;
type ThreadReadStateResult = ThreadResponse;
type ThreadPinOrderResult = ThreadListResponse;
type ThreadPromptHistoryResult = PromptHistoryResponse;
type ThreadQueuedMessagesResult = ThreadQueuedMessageListResponse;
type ThreadQueuedMessageCreateResult = ThreadQueuedMessage;
type ThreadQueuedMessageUpdateResult = ThreadQueuedMessage;
type ThreadQueuedMessageDeleteResult = {
    ok: true;
};
type ThreadQueuedMessageReorderResult = ThreadQueuedMessageListResponse;
type ThreadQueuedMessageSendResult = SendQueuedMessageResponse;
type ThreadQueuedMessageGroupBoundaryResult = ThreadQueuedMessageListResponse;
type ThreadTabsResult = ThreadTabsResponse;
type ThreadTabsUpdateResult = ThreadTabsResponse;
type ThreadStorageFilesResult = ThreadStorageFileListResponse;
type ThreadStoragePathsResult = ThreadStoragePathListResponse;
type ThreadChildSummaryResult = ThreadChildSummaryResponse;
type ThreadDefaultExecutionOptionsResult = ResolvedThreadExecutionOptions | null;
type ThreadConversationOutlineResult = ThreadConversationOutlineResponse;
type ThreadTimelineTurnSummaryDetailsResult = TimelineTurnSummaryDetailsResponse;
interface ThreadSpawnBaseArgs extends Omit<CreateThreadRequest, "childOrigin" | "input" | "origin" | "originKind" | "startedOnBehalfOf"> {
    childOrigin?: CreateThreadRequest["childOrigin"];
    origin?: CreateThreadRequest["origin"];
    originKind?: CreateThreadRequest["originKind"];
    startedOnBehalfOf?: CreateThreadRequest["startedOnBehalfOf"];
}
type ThreadSpawnArgs = ThreadSpawnBaseArgs & ({
    input: CreateThreadRequest["input"];
    prompt?: never;
} | {
    input?: never;
    prompt: string;
});
interface ThreadForkArgs extends Omit<ForkThreadRequest, "origin" | "visibility" | "workspace"> {
    origin?: ForkThreadRequest["origin"];
    visibility?: ForkThreadRequest["visibility"];
    workspace?: ForkThreadRequest["workspace"];
}
interface ThreadUpdateArgs extends UpdateThreadRequest {
    threadId: string;
}
interface ThreadDeleteArgs extends DeleteThreadRequest {
    threadId: string;
}
interface ThreadSendArgs extends SendMessageRequest {
    threadId: string;
}
interface ThreadEditMessageArgs extends EditMessageRequest {
    threadId: string;
}
interface ThreadActionArgs {
    threadId: string;
}
interface ThreadContinueAfterRateLimitArgs extends ThreadActionArgs {
    failedRequestId: string;
}
interface ThreadStatusArgs extends ThreadActionArgs {
    signal?: AbortSignal;
}
interface ThreadPromptHistoryArgs extends PromptHistoryQuery {
    signal?: AbortSignal;
    threadId: string;
}
interface ThreadPinOrderArgs extends ReorderPinnedThreadRequest {
    threadId: string;
}
interface ThreadQueuedMessageArgs {
    signal?: AbortSignal;
    threadId: string;
}
interface ThreadQueuedMessageCreateArgs extends CreateQueuedMessageRequest {
    threadId: string;
}
interface ThreadQueuedMessageUpdateArgs extends ThreadQueuedMessageTargetArgs, UpdateQueuedMessageRequest {
}
interface ThreadQueuedMessageTargetArgs {
    queuedMessageId: string;
    threadId: string;
}
interface ThreadQueuedMessageSendArgs extends ThreadQueuedMessageTargetArgs, SendQueuedMessageRequest {
}
interface ThreadQueuedMessageReorderArgs extends ThreadQueuedMessageTargetArgs, ReorderQueuedMessageRequest {
}
interface ThreadQueuedMessageGroupBoundaryArgs extends SetQueuedMessageGroupBoundaryRequest {
    threadId: string;
}
interface ThreadStorageFilesArgs extends ThreadStorageFilesQuery {
    signal?: AbortSignal;
    threadId: string;
}
interface ThreadStoragePathsArgs extends ThreadStoragePathsQuery {
    signal?: AbortSignal;
    threadId: string;
}
interface ThreadTimelineTurnSummaryDetailsArgs extends TimelineTurnSummaryDetailsQuery {
    signal?: AbortSignal;
    threadId: string;
}
interface ThreadTabsUpdateArgs extends UpdateThreadTabsRequest {
    threadId: string;
}
interface ThreadOpenArgs {
    threadId: string;
    split?: ThreadOpenSplit;
    file: ThreadOpenFile | null;
}
interface ThreadPaneActionArgs {
    action: ThreadPaneAction;
    threadId: string;
}
interface ThreadEventsListArgs {
    afterSeq?: string;
    limit?: string;
    signal?: AbortSignal;
    threadId: string;
}
interface ThreadEventWaitArgs {
    afterSeq?: string;
    signal?: AbortSignal;
    threadId: string;
    type: string;
    waitMs: string;
}
interface ThreadTimelineArgs extends ThreadTimelineQuery {
    signal?: AbortSignal;
    threadId: string;
}
interface ThreadOutputArgs {
    signal?: AbortSignal;
    threadId: string;
}
interface ThreadInteractionListArgs {
    signal?: AbortSignal;
    threadId: string;
}
interface ThreadInteractionTargetArgs {
    interactionId: string;
    threadId: string;
}
interface ThreadInteractionGetArgs extends ThreadInteractionTargetArgs {
    signal?: AbortSignal;
}
interface ThreadInteractionResolveArgs extends ThreadInteractionTargetArgs {
    resolution: PendingInteractionResolution;
}
interface ThreadInteractionRespondArgs extends ThreadInteractionTargetArgs {
    value: JsonValue$1;
}
type ThreadWaitTarget = {
    kind: "status";
    status: ThreadStatus;
} | {
    kind: "event";
    eventType: string;
};
interface ThreadWaitArgs {
    event?: string;
    pollIntervalMs?: number;
    signal?: AbortSignal;
    status?: ThreadStatus;
    threadId: string;
    timeoutMs?: number;
}
type ThreadWaitResult = {
    event: NonNullable<ThreadEventWaitResult>;
    matched: true;
    target: Extract<ThreadWaitTarget, {
        kind: "event";
    }>;
    threadId: string;
} | {
    matched: true;
    target: Extract<ThreadWaitTarget, {
        kind: "status";
    }>;
    thread: ThreadGetResult;
    threadId: string;
};
interface ThreadInteractionsArea {
    cancel(args: ThreadInteractionTargetArgs): Promise<ThreadInteractionCancelResult>;
    get(args: ThreadInteractionGetArgs): Promise<ThreadInteractionGetResult>;
    list(args: ThreadInteractionListArgs): Promise<ThreadInteractionListResult>;
    resolve(args: ThreadInteractionResolveArgs): Promise<ThreadInteractionResolveResult>;
    respond(args: ThreadInteractionRespondArgs): Promise<ThreadInteractionRespondResult>;
}
interface ThreadEventsArea {
    list(args: ThreadEventsListArgs): Promise<ThreadEventsListResult>;
    wait(args: ThreadEventWaitArgs): Promise<ThreadEventWaitResult>;
}
interface ThreadQueuedMessagesArea {
    create(args: ThreadQueuedMessageCreateArgs): Promise<ThreadQueuedMessageCreateResult>;
    delete(args: ThreadQueuedMessageTargetArgs): Promise<ThreadQueuedMessageDeleteResult>;
    list(args: ThreadQueuedMessageArgs): Promise<ThreadQueuedMessagesResult>;
    reorder(args: ThreadQueuedMessageReorderArgs): Promise<ThreadQueuedMessageReorderResult>;
    send(args: ThreadQueuedMessageSendArgs): Promise<ThreadQueuedMessageSendResult>;
    setGroupBoundary(args: ThreadQueuedMessageGroupBoundaryArgs): Promise<ThreadQueuedMessageGroupBoundaryResult>;
    update(args: ThreadQueuedMessageUpdateArgs): Promise<ThreadQueuedMessageUpdateResult>;
}
interface ThreadTabsArea {
    get(args: ThreadStatusArgs): Promise<ThreadTabsResult>;
    update(args: ThreadTabsUpdateArgs): Promise<ThreadTabsUpdateResult>;
}
interface ThreadsArea {
    archive(args: ThreadActionArgs): Promise<ThreadArchiveResult>;
    archiveAll(args: ThreadActionArgs): Promise<ThreadArchiveAllResult>;
    childSummary(args: ThreadStatusArgs): Promise<ThreadChildSummaryResult>;
    continueAfterRateLimit(args: ThreadContinueAfterRateLimitArgs): Promise<ThreadContinueAfterRateLimitResult>;
    compact(args: ThreadActionArgs): Promise<ThreadCompactResult>;
    cancelPlan(args: ThreadActionArgs): Promise<ThreadBannerActionResult>;
    clearGoal(args: ThreadActionArgs): Promise<ThreadBannerActionResult>;
    conversationOutline(args: ThreadStatusArgs): Promise<ThreadConversationOutlineResult>;
    defaultExecutionOptions(args: ThreadStatusArgs): Promise<ThreadDefaultExecutionOptionsResult>;
    delete(args: ThreadDeleteArgs): Promise<ThreadDeleteResult>;
    editMessage(args: ThreadEditMessageArgs): Promise<ThreadEditMessageResult>;
    events: ThreadEventsArea;
    fork(args: ThreadForkArgs): Promise<ThreadForkResult>;
    get(args: ThreadGetArgs): Promise<ThreadGetResult>;
    interactions: ThreadInteractionsArea;
    list(args?: ThreadListArgs): Promise<ThreadListResult>;
    markRead(args: ThreadActionArgs): Promise<ThreadReadStateResult>;
    markUnread(args: ThreadActionArgs): Promise<ThreadReadStateResult>;
    open(args: ThreadOpenArgs): Promise<ThreadOpenResult>;
    paneAction(args: ThreadPaneActionArgs): Promise<ThreadPaneActionResult>;
    output(args: ThreadOutputArgs): Promise<ThreadOutputResponse>;
    pin(args: ThreadActionArgs): Promise<ThreadMutationResult>;
    promptHistory(args: ThreadPromptHistoryArgs): Promise<ThreadPromptHistoryResult>;
    queuedMessages: ThreadQueuedMessagesArea;
    rateLimitRecovery(args: ThreadStatusArgs): Promise<ThreadRateLimitRecoveryResult>;
    reorderPinned(args: ThreadPinOrderArgs): Promise<ThreadPinOrderResult>;
    search(args: ThreadSearchArgs): Promise<ThreadSearchResult>;
    send(args: ThreadSendArgs): Promise<ThreadSendResult>;
    spawn(args: ThreadSpawnArgs): Promise<ThreadSpawnResult>;
    stop(args: ThreadActionArgs): Promise<ThreadStopResult>;
    tabs: ThreadTabsArea;
    timeline(args: ThreadTimelineArgs): Promise<ThreadTimelineResult>;
    timelineTurnSummaryDetails(args: ThreadTimelineTurnSummaryDetailsArgs): Promise<ThreadTimelineTurnSummaryDetailsResult>;
    storageFiles(args: ThreadStorageFilesArgs): Promise<ThreadStorageFilesResult>;
    storagePaths(args: ThreadStoragePathsArgs): Promise<ThreadStoragePathsResult>;
    unarchive(args: ThreadActionArgs): Promise<ThreadUnarchiveResult>;
    unpin(args: ThreadActionArgs): Promise<ThreadMutationResult>;
    update(args: ThreadUpdateArgs): Promise<ThreadMutationResult>;
    wait(args: ThreadWaitArgs): Promise<ThreadWaitResult>;
}

type ThreadSectionCreateResult = ThreadSectionResponse;
type ThreadSectionUpdateResult = ThreadSectionMutationResponse;
type ThreadSectionDeleteResult = ThreadSectionMutationResponse;
type ThreadSectionListResult = ThreadSectionResponse[];
interface ThreadSectionListArgs {
    signal?: AbortSignal;
}
interface ThreadSectionsArea {
    create(args: CreateThreadSectionRequest): Promise<ThreadSectionCreateResult>;
    delete(args: DeleteThreadSectionRequest): Promise<ThreadSectionDeleteResult>;
    list(args?: ThreadSectionListArgs): Promise<ThreadSectionListResult>;
    update(args: UpdateThreadSectionRequest): Promise<ThreadSectionUpdateResult>;
}

interface PatcherSdk extends PatcherRealtime {
    browserHistory: BrowserHistoryArea;
    environments: EnvironmentsArea;
    files: FilesArea;
    guide: GuideArea;
    hosts: HostsArea;
    projects: ProjectsArea;
    plugins: PluginsArea;
    providers: ProvidersArea;
    skills: SkillsArea;
    status: StatusArea;
    system: SystemArea;
    terminals: TerminalsArea;
    theme: ThemeArea;
    threadSections: ThreadSectionsArea;
    threads: ThreadsArea;
}

/**
 * The backend plugin API contract — the `patcher` object handed to a plugin's
 * `server.ts` factory (`export default function plugin(patcher: PatcherPluginApi)`).
 *
 * Types only: the implementation lives in the Patcher server
 * (apps/server/src/services/plugins/plugin-api.ts), which imports these
 * shapes so the contract and the implementation cannot drift. Plugin authors
 * import them type-only (`import type { PatcherPluginApi } from
 * "@patcher/plugin-sdk"`); the import is erased when Patcher loads the file.
 *
 * Runtime classes stay host-side. NeedsConfigurationError in particular is
 * matched by NAME, so plugin code needs no runtime import:
 * `throw Object.assign(new Error(msg), { name: "NeedsConfigurationError" })`.
 */
interface PluginLogger {
    debug(message: string): void;
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}
/**
 * Declarative settings descriptors (`patcher.settings.define`). Deliberately plain
 * data — not zod — so the host can render settings forms and the CLI can
 * parse values without executing plugin code.
 */
type PluginSettingDescriptor = {
    type: "string";
    label: string;
    description?: string;
    /** Stored in a 0600 file under <dataDir>/plugins/<id>/secrets/, never in the db or sent to the frontend. */
    secret?: true;
    default?: string;
} | {
    type: "boolean";
    label: string;
    description?: string;
    default?: boolean;
} | {
    type: "select";
    label: string;
    description?: string;
    options: string[];
    default?: string;
} | {
    type: "project";
    label: string;
    description?: string;
    default?: string;
};
type PluginSettingDescriptors = Record<string, PluginSettingDescriptor>;
type PluginSettingValue = string | boolean;
/** `default` present → non-optional value; absent → `T | undefined`. */
type PluginSettingsValues<Ds extends Record<string, PluginSettingDescriptor>> = {
    [K in keyof Ds]: Ds[K] extends {
        default: string | boolean;
    } ? PluginSettingValueOf<Ds[K]> : PluginSettingValueOf<Ds[K]> | undefined;
};
type PluginSettingValueOf<D extends PluginSettingDescriptor> = D extends {
    type: "boolean";
} ? boolean : string;
interface PluginSettingsHandle<Ds extends Record<string, PluginSettingDescriptor>> {
    /** Load-safe: callable inside the factory. */
    get(): Promise<PluginSettingsValues<Ds>>;
    /** Fires after values change through the settings route/CLI. */
    onChange(listener: (next: PluginSettingsValues<Ds>, prev: PluginSettingsValues<Ds>) => void): void;
}
interface PluginSettings {
    define<Ds extends Record<string, PluginSettingDescriptor>>(descriptors: Ds): PluginSettingsHandle<Ds>;
}
interface PluginKvStorage {
    get<T>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
    list(prefix?: string): Promise<string[]>;
}
interface PluginStorage {
    /** Namespaced JSON key-value rows in patcher.db; values ≤256KB each. */
    kv: PluginKvStorage;
    /**
     * Open (or reuse the path of) the plugin's own SQLite database at
     * <dataDir>/plugins/<id>/data.db — the server's better-sqlite3, WAL mode,
     * busy_timeout 5000. Handles are host-tracked and closed on
     * dispose/reload; a closed handle throws on use.
     */
    database(): Database.Database;
    /**
     * Ordered-statement migration helper: statement index = migration id in a
     * `_patcher_migrations` table; unapplied statements run in one transaction.
     * Append-only — never reorder or edit shipped statements.
     */
    migrate(db: Database.Database, statements: string[]): void;
}
/**
 * Thread lifecycle events a plugin can observe (design §4.5). Observe-only:
 * handlers run fire-and-forget after the transition is applied and can never
 * block or veto it. `thread` is the same public DTO GET /threads/:id serves.
 */
interface PluginThreadEventPayloads {
    /** Fired after a thread row is created. */
    "thread.created": {
        thread: ThreadResponse;
    };
    /** Fired when a thread transitions into `active`. */
    "thread.active": {
        thread: ThreadResponse;
    };
    /** Fired when a thread transitions into `idle`. `lastAssistantText` is
     * assembled the same way GET /threads/:id/output is. */
    "thread.idle": {
        thread: ThreadResponse;
        lastAssistantText: string | null;
    };
    /** Fired when a thread transitions into `error`. `error` is the latest
     * system/error event message, when one exists. */
    "thread.failed": {
        thread: ThreadResponse;
        error: string | null;
    };
    /** Fired after a thread is archived (including cascade archives). */
    "thread.archived": {
        thread: ThreadResponse;
    };
    /** Fired after a thread is soft-deleted. */
    "thread.deleted": {
        thread: ThreadResponse;
    };
}
type PluginThreadEventName = keyof PluginThreadEventPayloads;
type PluginThreadEventHandler<E extends PluginThreadEventName> = (payload: PluginThreadEventPayloads[E]) => void | Promise<void>;
type PluginHttpAuthMode = "local" | "token" | "none";
type PluginHttpHandler = (context: Context) => Response | Promise<Response>;
interface PluginHttp {
    /**
     * Register an HTTP route, mounted at
     * `/api/v1/plugins/<id>/http/<path>`. Auth modes (default "local"):
     * - "local": Origin/Host must be a local Patcher app origin; non-GET requires
     *   content-type application/json (forces a CORS preflight).
     * - "token": requires the per-plugin token (`patcher plugin token <id>`) via
     *   the x-patcher-plugin-token header or ?token=.
     * - "none": no checks — only for signature-verified webhooks.
     */
    route(method: string, path: string, handler: PluginHttpHandler, opts?: {
        auth?: PluginHttpAuthMode;
    }): void;
}
interface PluginRpc {
    /**
     * Register a Standard Schema-driven rpc contract and its inferred handlers,
     * served at POST
     * `/api/v1/plugins/<id>/rpc/<method>` with "local" auth semantics. The
     * host validates input before invocation and output before strict JSON
     * serialization. The response is `{ ok: true, result }` or
     * `{ ok: false, error: { code, message, issues? } }`.
     */
    register<Contract extends PluginRpcContract>(contract: Contract, handlers: PluginRpcHandlers<Contract>): void;
}
interface PluginRealtime {
    /**
     * Broadcast an ephemeral `plugin-signal` WS message
     * `{ pluginId, channel, payload }` to every connected client (V1 has no
     * per-channel subscriptions). `payload` must be JSON-serializable;
     * `undefined` is normalized to `null`. Nothing is persisted.
     */
    publish(channel: string, payload: unknown): void;
}
interface PluginBackground {
    /**
     * Register a long-lived background service. `start` runs after the
     * factory completes and should resolve when `signal` aborts
     * (dispose/reload/disable/shutdown). A crash restarts it with capped
     * exponential backoff; throwing NeedsConfigurationError marks the plugin
     * `needs-configuration` and stops restarting until the next load.
     */
    service(name: string, service: {
        start(signal: AbortSignal): void | Promise<void>;
    }): void;
    /**
     * Register a cron schedule (5-field expression, server-local time). The
     * durable row keyed (pluginId, name) is upserted at load; the periodic
     * sweep runs every 10s and claims due rows with a CAS on next_run_at, but
     * only while this plugin is loaded. Failures land in last_status/last_error,
     * visible in `patcher plugin list`.
     *
     * An occurrence that came due while nothing was loaded — the server was down,
     * the machine asleep, the plugin disabled — is **not** lost: a load leaves an
     * already-due next_run_at alone, so the next sweep runs it once and then
     * resumes the cron. Only a changed cron discards it, because the stored time
     * is no longer that schedule's. What a schedule still cannot promise is *when*
     * a catch-up lands, so a job whose result depends on the wall clock should
     * read the clock itself rather than assume it woke on the minute.
     */
    schedule(name: string, cron: string, fn: () => void | Promise<void>): void;
}
interface PluginCliCommandInfo {
    name: string;
    summary: string;
    usage: string;
}
/** Context forwarded from the invoking CLI when known; all fields optional. */
interface PluginCliContext {
    cwd?: string;
    threadId?: string;
    projectId?: string;
    /** Aborted when the invoking CLI HTTP request disconnects. */
    signal?: AbortSignal;
}
type PluginInteractionCancelReason = "user" | "request-aborted" | "thread-stopped" | "thread-deleted" | "plugin-disposed" | "server-restarted" | "timeout";
type PluginInteractionResult = {
    outcome: "submitted";
    value: JsonValue;
} | {
    outcome: "cancelled";
    reason: PluginInteractionCancelReason;
};
interface PluginInteractionRequest {
    threadId: string;
    rendererId: string;
    title: string;
    payload: JsonValue;
    /** Defaults to ten minutes; capped at one hour. */
    timeoutMs?: number;
}
interface PluginCliResult {
    exitCode: number;
    stdout?: string;
    stderr?: string;
}
/**
 * Maximum combined UTF-8 bytes accepted from plugin CLI stdout and stderr.
 * This is the shared source of truth for production and the testing harness.
 */
declare const PLUGIN_CLI_OUTPUT_MAX_BYTES: number;
interface PluginCliOutputLimitError {
    code: "plugin_cli_output_too_large";
    message: string;
    maxBytes: number;
    stdoutBytes: number;
    stderrBytes: number;
    totalBytes: number;
}
/** Normalized host result returned by the plugin CLI HTTP/testing boundary. */
interface PluginCliExecutionResult {
    exitCode: number;
    stdout: string;
    stderr: string;
    error?: PluginCliOutputLimitError;
}
interface PluginCliRegistration {
    /** Top-level command name (`patcher <name> …`): lowercase [a-z0-9-]+, and not
     * a core Patcher command (see RESERVED_PATCHER_CLI_COMMANDS in the server). */
    name: string;
    summary: string;
    /** Subcommand metadata rendered in help and the plugin-commands skill
     * without executing plugin code. Parsing argv is plugin-owned. */
    commands?: PluginCliCommandInfo[];
    run(argv: string[], ctx: PluginCliContext): PluginCliResult | Promise<PluginCliResult>;
}
interface PluginCli {
    /**
     * Register this plugin's `patcher` subcommand. One registration per factory
     * execution; a repeated call is rejected. Core Patcher commands always win
     * name collisions; reserved names are rejected at registration.
     */
    register(registration: PluginCliRegistration): void;
}
/** Per-turn context handed to patcher.agents context providers (design §4.4). */
/** MCP-style content parts a native tool may return (design §4.4). */
type PluginAgentToolContentPart = {
    type: "text";
    text: string;
} | {
    type: "image";
    data: string;
    mimeType: string;
};
type PluginAgentToolResult = string | {
    content: PluginAgentToolContentPart[];
    isError?: boolean;
};
/** Per-call context handed to a native tool's execute (design §4.4). */
interface PluginAgentToolContext {
    threadId: string;
    projectId: string;
    /** The tool-call request's abort signal (aborts if the daemon round-trip
     * is torn down mid-call). */
    signal: AbortSignal;
}
/**
 * Native timeline labels for a plugin tool, keyed by Patcher's own timeline row
 * status. This is experimental: Patcher may refine its presentation contract
 * before the field is stabilized.
 */
interface PluginAgentToolExperimentalStatusLabels {
    /** Label shown while the tool call is pending. */
    pending: string;
    /** Label shown after the tool call completes successfully. */
    completed: string;
}
interface PluginAgentToolRegistrationBase {
    /** Tool name shown to the model: [a-zA-Z0-9_-]+, unique across plugins,
     * and not a built-in dynamic tool (see RESERVED_AGENT_TOOL_NAMES in the
     * server). */
    name: string;
    description: string;
    /**
     * Optional usage snippet appended to the thread instructions whenever
     * this tool is in the session's tool set (mirrors the built-in
     * update_environment_directory guidance). Limited to 4096 characters.
     */
    instructions?: string;
    /**
     * Optional native timeline labels. When omitted, Patcher shows the standard
     * tool name and arguments (for example, `Ran tool search_docs …`). Labels
     * apply only while the call is pending and after successful completion;
     * approval, error, and interruption states keep Patcher's standard rendering.
     */
    experimental_statusLabels?: PluginAgentToolExperimentalStatusLabels;
}
/** Stable, plain-data context resolved by the server for one agent session. */
interface PluginAgentConfigurationContext {
    thread: {
        id: string;
        title: string | null;
        parentThreadId: string | null;
        sourceThreadId: string | null;
    };
    project: {
        id: string;
        kind: "standard" | "personal";
        name: string;
        gitRemoteUrl: string | null;
    };
    environment: {
        id: string;
        name: string | null;
        path: string | null;
        workspaceProvisionType: "unmanaged" | "managed-worktree" | "personal";
        branchName: string | null;
    };
    host: {
        id: string;
        name: string;
    };
    provider: {
        id: string;
        model: string;
    };
    /** How the thread was spawned. A side chat is the builtin side-chat
     * plugin's fork: `{ kind: "fork", pluginId: "side-chat" }`. */
    origin: {
        kind: "fork" | null;
        pluginId: string | null;
    };
}
/** Object form of a {@link PluginAgentConfiguration} tools entry: selects a
 * registered tool and overrides the parameter schema advertised to the
 * provider for this resolution only. */
interface PluginAgentToolSelection {
    /** Name of a tool registered by this plugin via `registerTool`. */
    name: string;
    /** JSON-schema object (root `type: "object"`, JSON-serializable, at most
     * 128 KiB serialized) sent to the provider in place of the registered
     * parameter schema. Execution-side validation still runs the registered
     * parameters, so the override must only narrow what the registered schema
     * already accepts. */
    parameters: Record<string, unknown>;
}
/** Per-resolution selection returned by {@link PluginAgents.configure}. */
interface PluginAgentConfiguration {
    /** Tool names registered by this plugin, or {@link PluginAgentToolSelection}
     * entries to also override a tool's advertised parameter schema for this
     * resolution. Duplicate or unknown names, or an invalid override, reject
     * this plugin's complete selection for the resolution. */
    tools: Array<string | PluginAgentToolSelection>;
    /** Skill frontmatter names from this plugin's manifest skill roots.
     * Duplicate or unknown names reject this plugin's complete selection. */
    skills: string[];
    /** Optional dynamic instructions. Output is truncated to 4096 characters. */
    instructions?: string;
}
interface PluginAgents {
    /**
     * Select this plugin's statically registered tools and manifest skills for
     * each thread/session resolution, with optional dynamic instructions. The
     * callback is synchronous and runs at `thread.start` / `turn.submit`; it
     * never rebuilds registrations. Exactly one callback may be registered per
     * factory execution. A throw, malformed result, duplicate id, unknown id,
     * or more than 256 tool/skill ids fails closed for this plugin only.
     *
     * Tools take effect when the provider session is next started or resumed;
     * an already-running session is not hot-mutated. Instructions follow the
     * same boundary: a live provider session keeps the instructions it was
     * constructed with, and a changed selection applies when the session is
     * next constructed. Skill changes follow Patcher's environment runtime policy:
     * a busy runtime keeps its current catalog until a safe relaunch. Side chats
     * are ordinary plugin-owned forks here — read `origin` to detect them — and
     * their returned tool, skill, and dynamic-instruction selections apply at the
     * same boundaries.
     */
    configure(provider: (context: PluginAgentConfigurationContext) => PluginAgentConfiguration): void;
    /**
     * Register a native dynamic tool (design §4.4). `parameters` is either a
     * zod schema (validated per call; execute receives the parsed value) or a
     * plain JSON-schema object (no validation; execute receives the raw
     * arguments as `unknown`). Tool-set changes apply on the NEXT session
     * start — a tool registered mid-session is not hot-added to running
     * provider sessions. A second registration of the same name within this
     * plugin is rejected; a name already registered by another plugin is
     * rejected and surfaced as this plugin's status detail.
     */
    registerTool<Schema extends z.ZodType>(tool: PluginAgentToolRegistrationBase & {
        parameters: Schema;
        execute(params: z.output<Schema>, ctx: PluginAgentToolContext): PluginAgentToolResult | Promise<PluginAgentToolResult>;
    }): void;
    registerTool(tool: PluginAgentToolRegistrationBase & {
        /** Raw JSON-schema escape hatch; params arrive unvalidated. */
        parameters: Record<string, unknown>;
        execute(params: unknown, ctx: PluginAgentToolContext): PluginAgentToolResult | Promise<PluginAgentToolResult>;
    }): void;
    /**
     * Contribute a dynamic section appended to thread instructions. The
     * provider runs when a thread's runtime command config is resolved
     * (thread.start / turn.submit); return null to contribute nothing for
     * that resolution. A live provider session keeps the instructions it was
     * constructed with — a changed contribution takes effect when the
     * provider session is next constructed (thread start or resume after a
     * daemon restart, environment switch, or provider restart), never
     * mid-session. Must be synchronous and fast — it sits on the
     * thread-start path. Output longer than 4096 characters is truncated; a
     * throwing provider is logged against the plugin and contributes nothing.
     * A repeated registration within one factory execution is rejected.
     */
    contributeInstructions(provider: (ctx: {
        threadId: string;
        projectId: string;
    }) => string | null): void;
}
type PluginMentionTrigger = "@" | "#" | "$" | "!" | "~";
/** Search context handed to a mention provider (design §4.9). `projectId`/
 * `threadId` are null when the composer has not committed one yet. */
interface PluginMentionSearchContext {
    trigger: PluginMentionTrigger;
    query: string;
    projectId: string | null;
    threadId: string | null;
}
/** One row a mention provider returns from `search`. `id` is the provider's
 * own item id — the host namespaces it before it reaches the wire. */
interface PluginMentionItem {
    id: string;
    title: string;
    subtitle?: string;
    icon?: string;
}
interface PluginMentionProviderRegistration {
    /** Unique within this plugin: [a-zA-Z0-9_-]+ (no ":" — the host composes
     * wire item ids as "<providerId>:<itemId>"). */
    id: string;
    /** Section label shown above this provider's rows in the mention menu. */
    label: string;
    /**
     * Composer trigger characters this provider should answer. Omit to use the
     * default `@` mention trigger. Valid triggers are `@`, `#`, `$`, `!`, and `~`.
     */
    triggers?: readonly PluginMentionTrigger[];
    /**
     * Runs server-side as the user types after one of this provider's triggers
     * in the composer. Each call is time-boxed (2s) and failure-isolated: a slow
     * or throwing provider contributes an empty list — it can never break the
     * mention menu.
     */
    search(ctx: PluginMentionSearchContext): PluginMentionItem[] | Promise<PluginMentionItem[]>;
    /**
     * Resolves one picked item into agent context, called once per unique
     * item at message send time. The returned `context` is attached to the
     * message as an agent-visible (user-hidden) prompt input. Throwing blocks
     * the send with a visible error.
     */
    resolve(itemId: string): {
        context: string;
    } | Promise<{
        context: string;
    }>;
}
interface PluginUi {
    /** Block until the app submits or cancels a plugin-owned composer form. */
    requestInput(request: PluginInteractionRequest, options?: {
        signal?: AbortSignal;
    }): Promise<PluginInteractionResult>;
    /**
     * Register a mention provider for the shipped app's composer (design §4.9).
     * Providers default to the `@` trigger and may opt into `#`, `$`, `!`, or
     * `~` with `triggers`. Items group under `label` in the mention menu; a
     * picked item becomes a `{ kind: "plugin" }` mention resource whose context
     * is resolved once at send time. Multiple providers per plugin; ids must be
     * unique within the plugin.
     */
    registerMentionProvider(provider: PluginMentionProviderRegistration): void;
    /**
     * Rebind a keyboard shortcut for the shipped app (`browser.shortcuts`).
     *
     * This changes what *this install's* defaults are, so it sits under the
     * user's own overrides: a shortcut the user has rebound in settings keeps
     * winning, and the settings UI shows a plugin's binding as the default rather
     * than as something the user changed.
     *
     * `command` must be a known app command id — `browser.newTab`,
     * `thread.search`, and so on; an unknown one is a registration error rather
     * than a silent no-op. A null `shortcut` unassigns the command, which is how
     * a plugin frees a chord it wants to leave to the page.
     *
     * Between plugins the lowest plugin id wins a contested command, so the
     * result does not depend on load order.
     */
    registerKeybinding(keybinding: PluginKeybinding): void;
    /**
     * Add a command of your own, with a keyboard shortcut for it
     * (`app.commands`) — see {@link PluginCommandRegistration}.
     *
     * Ungated, like `registerKeybinding` and for the same reason: a chord that runs
     * your own code discloses nothing. Anything the command then reads is gated
     * where it already was — the current page costs `tabs.read`.
     */
    registerCommand(command: PluginCommandRegistration): void;
}
/**
 * Modifiers default to false, so a binding names only what it uses. `mod` is
 * Command on macOS and Control elsewhere — the portable one, and the one almost
 * every binding wants.
 */
interface PluginKeybindingShortcut {
    key: string;
    alt?: boolean;
    control?: boolean;
    meta?: boolean;
    mod?: boolean;
    shift?: boolean;
}
interface PluginKeybinding {
    command: string;
    /** Null unassigns the command. */
    shortcut: PluginKeybindingShortcut | null;
}
/**
 * A command of the plugin's own, with the chord that runs it.
 *
 * The difference from {@link PluginUi.registerKeybinding}: that one rebinds a
 * command **Patcher** already has, while this one adds a command Patcher has never heard
 * of. Which is also why it is a separate list rather than an entry in Patcher's
 * keybinding config — Patcher's command ids are a closed set, and a plugin's are not.
 *
 * Deliberately context-free: `run` is handed nothing. A command that needs the
 * page the user is on reads it (`patcher.browser.page.getUrl()`,
 * `patcher.browser.tabs.list()`) and pays `tabs.read` for it — the permission that
 * already governs seeing where the user is. Handing the address to every chord
 * would be a disclosure nobody agreed to for a shortcut.
 */
interface PluginCommandRegistration {
    /** Unique within this plugin: [a-zA-Z0-9_-]+. */
    id: string;
    /** What the shortcut is called wherever it is listed — Settings, for now. */
    title: string;
    /**
     * The chord. Required: Patcher has no command palette yet, so a command without one
     * would have no way to be run at all.
     *
     * Patcher's own bindings win a contested chord — including one the user rebound —
     * and between plugins the lowest plugin id wins, so what happens does not
     * depend on load order. A chord never fires while the user is typing or a
     * dialog is open, the same rule Patcher's own shortcuts follow.
     */
    shortcut: PluginKeybindingShortcut;
    /** Runs server-side when the chord fires. Nothing waits on it. */
    run(): void | Promise<void>;
}
/** Search context handed to an omnibox provider. */
interface PluginOmniboxSuggestContext {
    /** What the user has typed, trimmed. Never empty. */
    query: string;
}
/** What selecting a plugin's omnibox suggestion does. */
type PluginOmniboxAction = 
/** Open a URL in the browser tab the omnibox belongs to. */
{
    type: "navigate";
    url: string;
}
/**
 * Call this provider's `run(itemId)` back on the server. Use it when the
 * suggestion is an action rather than a destination — asking an agent,
 * starting a job — and optionally return a URL to open afterwards.
 */
 | {
    type: "run";
};
/**
 * One row an omnibox provider returns. `id` is the provider's own item id —
 * the host namespaces it before it reaches the wire.
 */
interface PluginOmniboxSuggestion {
    id: string;
    title: string;
    subtitle?: string;
    /**
     * Rank in [0, 1], clamped by the host; defaults to 0.5 when omitted. Score 1
     * belongs to the browser's own default action — what pressing Enter does with
     * nothing selected — and plugin rows are ranked after the built-in providers
     * at equal scores, so a plugin cannot take the top row away from it.
     */
    score?: number;
    action: PluginOmniboxAction;
}
/** What a `run` action asks the browser to do once the plugin is done. */
interface PluginOmniboxRunResult {
    /** Open this URL in the tab the suggestion was picked from. */
    navigate?: string;
}
/** Context handed to `run`, so an action can use the query it was offered for. */
interface PluginOmniboxRunContext {
    /** The query the picked suggestion was produced for. */
    query: string;
}
interface PluginOmniboxProviderRegistration {
    /** Unique within this plugin: [a-zA-Z0-9_-]+ (no ":" — the host composes
     * wire item ids as "<providerId>:<itemId>"). */
    id: string;
    /** Source label shown on this provider's rows, next to the browser's own. */
    label: string;
    /**
     * Runs server-side as the user types in the browser's omnibox. Each call is
     * time-boxed (2s) and failure-isolated: a slow or throwing provider
     * contributes nothing — it can never break the omnibox, whose built-in rows
     * keep working regardless.
     */
    suggest(ctx: PluginOmniboxSuggestContext): PluginOmniboxSuggestion[] | Promise<PluginOmniboxSuggestion[]>;
    /**
     * Performs a `{ type: "run" }` suggestion, called once when the user picks
     * that row. `itemId` is this provider's own item id. Required if any returned
     * suggestion uses a `run` action.
     */
    run?(itemId: string, ctx: PluginOmniboxRunContext): PluginOmniboxRunResult | void | Promise<PluginOmniboxRunResult | void>;
}
/**
 * How a download ended. There is no `started`: a handler runs once a download
 * is over, so it never sees a half-written file it might be tempted to move.
 *
 * `refused` is Patcher's own decision (the page asked for too many at once) and
 * nothing was written, which is why `savePath` is null for it alone.
 */
type PluginBrowserDownloadState = "completed" | "cancelled" | "interrupted" | "refused";
interface PluginBrowserDownload {
    /** Unique per download, for correlating a handler's own bookkeeping. */
    id: string;
    /** The browser tab whose page started it. */
    tabId: string;
    /** The name Patcher wrote — sanitized, and not necessarily what the page asked for. */
    filename: string;
    /** Absolute path of the file on disk; null when nothing was written. */
    savePath: string | null;
    /** Where it came from, and what the server said it was. */
    url: string;
    mimeType: string;
    state: PluginBrowserDownloadState;
}
/**
 * Called after Patcher has finished writing a download.
 *
 * **This is where a plugin takes downloads over.** The file is on disk and
 * nothing else is holding it, so a handler is free to move it somewhere by
 * media type, rename it from the page's title, hand it to an agent, upload it,
 * or delete it outright. Multiple handlers run independently; each is
 * time-boxed and failure-isolated, so a slow or throwing one changes nothing
 * for the others or for the browser.
 *
 * What a handler cannot do is stop the write, and that is a platform limit
 * rather than a policy: Chromium demands the save path **synchronously**, while
 * a plugin lives in another process. So Patcher writes to the user's downloads
 * folder first and hands the result over; a plugin that wants files elsewhere
 * moves them, and one that wants them gone deletes them.
 */
/** What a context-menu item was clicked on. Every field is page-supplied. */
interface PluginBrowserContextMenuContext {
    /** The browser tab the menu was opened in. */
    tabId: string;
    pageUrl: string;
    /** The link under the pointer, when there was one. */
    linkUrl: string | null;
    /** The image under the pointer, when there was one. */
    imageUrl: string | null;
    selectionText: string | null;
}
/**
 * Where an item appears. Any match is enough, so `{ link: true, image: true }`
 * shows on both; omitting `when` shows it everywhere.
 *
 * `page` means a right-click with nothing under the pointer — no link, no
 * image, no selection.
 */
interface PluginBrowserContextMenuWhen {
    image?: boolean;
    link?: boolean;
    page?: boolean;
    selection?: boolean;
}
interface PluginBrowserContextMenuItemRegistration {
    /** Unique within this plugin: [a-zA-Z0-9_-]+. */
    id: string;
    /** The menu label, shown under the browser's own entries. */
    title: string;
    when?: PluginBrowserContextMenuWhen;
    /**
     * Runs server-side when the user picks the item. Fire-and-forget from the
     * menu's point of view — the menu has already closed — so report progress
     * through your own surfaces rather than by returning something.
     */
    run(context: PluginBrowserContextMenuContext): void | Promise<void>;
}
type PluginBrowserDownloadHandler = (download: PluginBrowserDownload) => void | Promise<void>;
/** A site asking a browsed page for a username and password. */
interface PluginBrowserAuthChallenge {
    /** The browser tab whose page was challenged. */
    tabId: string;
    /** `example.com`, or `example.com:8443` when the port is not the default. */
    host: string;
    /** True when the credentials would travel unencrypted (plain `http`). */
    insecure: boolean;
}
interface PluginBrowserAuthCredentials {
    username: string;
    password: string;
}
/**
 * Answers an HTTP authentication challenge before a human is asked, which is
 * what makes a password manager a plugin rather than a feature.
 *
 * Return null to decline — the browser then asks the user, which is also what
 * happens when every provider declines, throws or takes too long. A provider is
 * asked **once per host per tab**: a second challenge from the same host means
 * the first answer was wrong, and repeating it would spin.
 */
type PluginBrowserAuthProvider = (challenge: PluginBrowserAuthChallenge) => PluginBrowserAuthCredentials | null | Promise<PluginBrowserAuthCredentials | null>;
/** What a tab action was run on — one tab in the browser surface's strip. */
interface PluginBrowserTabActionContext {
    tabId: string;
    /**
     * The page's address, empty for a tab that has no page yet — and **null** for
     * a Patcher screen (Settings, a plugin's own panel), which is a tab with no page at
     * all. Null is therefore how an action tells the two kinds apart.
     */
    url: string | null;
    title: string | null;
    pinned: boolean;
    /** Web tabs only: a Patcher screen has no page of its own to silence. */
    muted: boolean;
    /** Whether this is the tab the window is currently showing. */
    active: boolean;
}
interface PluginBrowserTabActionRegistration {
    /** Unique within this plugin: [a-zA-Z0-9_-]+. */
    id: string;
    /** The menu label, shown under the browser's own tab entries. */
    title: string;
    /**
     * Runs server-side when the user picks the entry. Fire-and-forget, like a
     * context-menu item: the menu has already closed, so report progress through
     * your own surfaces rather than by returning something.
     */
    run(context: PluginBrowserTabActionContext): void | Promise<void>;
}
/** The page a toolbar control is being asked about, or was pressed on. */
interface PluginBrowserToolbarContext {
    /** The browser tab whose toolbar this is. */
    tabId: string;
    /** The page's address. Never empty — the toolbar is not drawn over Patcher's own
     * screens, so there is always a page. */
    url: string;
    title: string | null;
}
/**
 * How a control should look for the page it was asked about. Every field is
 * optional because every field has to have a safe default: the control is drawn
 * before an answer arrives.
 */
interface PluginBrowserToolbarState {
    /**
     * Whether the control is *on* for this page — a saved bookmark, a reader mode
     * that is running. The host renders it as an accent on the declared icon
     * rather than by swapping the icon, so the button does not change shape as
     * answers arrive.
     */
    active?: boolean;
    /** Replaces the declared title while this page is open. */
    title?: string;
}
/**
 * A control in the browser's toolbar, and what it says about the page under it.
 *
 * The only contribution point that is asked about a page **without the user
 * doing anything** — which is what makes a star that is already filled possible,
 * and what makes this cost a permission of its own.
 */
interface PluginBrowserToolbarItemRegistration {
    /** Unique within this plugin: [a-zA-Z0-9_-]+. */
    id: string;
    /** The control's accessible name, and its tooltip. */
    title: string;
    /**
     * Icon hint, resolved like every other plugin icon: your `patcher.branding.icon`,
     * then the manifest's, then this name, then a generic mark. Fixed at
     * registration — see {@link PluginBrowserToolbarState.active} for why.
     */
    icon?: string;
    /**
     * What this control looks like for the page in the tab, asked on navigation
     * and after your own `run` finishes.
     *
     * Return `null` to keep what was declared. Time-boxed like a site-info
     * section: the control is already on screen, so a `state` that hangs leaves
     * the declared look rather than an empty space. Omit it entirely for a control
     * that is the same everywhere — nothing is then asked of the plugin as the
     * user browses, and nothing is spent on it.
     */
    state?(context: PluginBrowserToolbarContext): PluginBrowserToolbarState | null | Promise<PluginBrowserToolbarState | null>;
    /**
     * Runs server-side when the user presses the control. Fire-and-forget like a
     * context-menu item — report through your own surfaces — except for one
     * thing: `state` is asked again once this resolves, so a control that toggles
     * something shows its new look without doing anything else.
     */
    run(context: PluginBrowserToolbarContext): void | Promise<void>;
}
/** Which tab's new-tab screen is asking. There is no page yet — that is the point. */
interface PluginBrowserNewTabContext {
    tabId: string;
}
/** One row of a new-tab section: what it says, and where it goes. */
interface PluginBrowserNewTabRow {
    title: string;
    /** Second line, muted — a host, a note, a date. */
    subtitle?: string;
    /**
     * Opened when the row is clicked, in the tab the screen is on. `http` and
     * `https` only: a new-tab row is a link, and `javascript:` or `file:` from a
     * plugin is not a link the browser will follow.
     */
    url: string;
}
/**
 * A section on the browser's new-tab screen — the empty page a fresh tab shows,
 * where Patcher lists recently visited pages.
 *
 * Rows are **links**, so clicking one runs no plugin code: the browser navigates
 * to what the plugin already said. That is what keeps a list of saved pages
 * feeling like part of the browser instead of a remote call per click.
 */
interface PluginBrowserNewTabWidgetRegistration {
    /** Unique within this plugin: [a-zA-Z0-9_-]+. */
    id: string;
    /** The section heading, e.g. "Bookmarks". */
    label: string;
    /**
     * The rows to show, asked each time a new-tab screen appears.
     *
     * Return `null` — or no rows — to show nothing, which is what a section with
     * nothing saved yet should do rather than a heading over an empty list.
     * Time-boxed like a site-info section: the screen is already on display, so a
     * widget that hangs is left out rather than waited for.
     */
    rows(context: PluginBrowserNewTabContext): PluginBrowserNewTabRow[] | null | Promise<PluginBrowserNewTabRow[] | null>;
}
/**
 * CSS the browser applies to pages on the sites this plugin declared.
 *
 * The declaration is data — no callback, nothing asked of the plugin as the user
 * browses — so a style keeps working while the plugin is idle, and a page that
 * matches nothing costs nothing.
 *
 * What it can and cannot do, because the difference matters when writing one:
 * the rules apply to the **main frame only** (a subframe keeps its own
 * stylesheets), they are re-applied on every navigation rather than surviving
 * one, and they land once the navigation has committed — early enough that a
 * network page has usually not painted the element yet, but not a guarantee that
 * it never appears. A rule that must never be seen is not something this surface
 * can promise.
 */
interface PluginBrowserPageStyleRegistration {
    /** Unique within this plugin: [a-zA-Z0-9_-]+. */
    id: string;
    /**
     * Which of the plugin's declared sites this stylesheet is for. Each entry must
     * be one of the patterns in `patcher.sites` — the manifest is where the user reads
     * what a plugin reaches, so code may pick from that list but never widen it.
     */
    matches: string[];
    /**
     * The stylesheet, as text. Ordinary CSS against the page's own DOM; the page's
     * author wrote theirs first, so a rule that has to win says `!important` like
     * any other late stylesheet.
     */
    css: string;
}
/**
 * What the page-side half of a page script is handed.
 *
 * Two members, and no more on purpose. This code runs next to a site the user is
 * signed in to; every name here is something the browser has to be willing to
 * stand behind, so the surface is the channel home and the one piece of timing
 * sugar that keeps the common case from being a footgun.
 *
 * It arrives as the global `patcher` inside the script — declare it at the top of the
 * source (`declare const patcher: PluginPageScriptApi`) to type-check a script written
 * as a template literal.
 */
interface PluginPageScriptApi {
    /**
     * Call one of this plugin's own rpc methods, and nothing else.
     *
     * This is the whole reason a page script beats a userscript: a page cannot read
     * a token from the user's keychain, open a database or reach a host the site's
     * CSP forbids, and the plugin's backend can do all three. Input and result
     * cross as JSON, so both must be JSON-serialisable, and both are bounded.
     *
     * Rejects — never throws synchronously — if the plugin is not running, the
     * method does not exist, the page has since navigated somewhere the plugin does
     * not declare, or the script is calling faster than the browser will carry.
     */
    rpc(method: string, input?: unknown): Promise<unknown>;
    /**
     * Run `callback` once the document has been parsed, or immediately if it
     * already has.
     *
     * A page script starts before the page's first element exists, which is what
     * makes it powerful and what makes `document.body.append(...)` at the top level
     * a crash. Anything touching the DOM goes in here; anything that has to happen
     * before the page's own scripts (patching `fetch`, taking a global) stays
     * outside it.
     */
    ready(callback: () => void): void;
}
/**
 * The plugin's own code, run in pages on the sites this plugin declared.
 *
 * The declaration is data, like a page style: the browser holds the source and
 * hands it to a matching document, so nothing is asked of the plugin as the user
 * browses and a page that matches nothing costs nothing.
 *
 * What the browser promises about running it — all of it measured, none of it
 * inherited from Chrome's content scripts:
 *
 * - It runs **before the page's own first script**, when the document exists and
 *   the parser has produced nothing (`document.documentElement` is null). Use
 *   `patcher.ready` for DOM work.
 * - It runs in an **isolated world of this plugin's own**. The page cannot see
 *   `patcher` or anything the script defines, and cannot shadow what it reads. Two
 *   scripts of the same plugin share that world; another plugin's scripts do not.
 * - **Main frame only.** An iframe is out of reach, as it is for a page style.
 * - A script registered while a matching page is already open runs when that page
 *   is **next loaded**.
 * - An error at the top level lands in the page's console — where Patcher's
 *   observation log collects it for agents — and does not stop the next script.
 */
interface PluginBrowserPageScriptRegistration {
    /** Unique within this plugin: [a-zA-Z0-9_-]+. */
    id: string;
    /**
     * Which of the plugin's declared sites this script is for. Each entry must be
     * one of the patterns in `patcher.sites`, exactly as for a page style: the manifest
     * is what the user read, so code may pick from that list but never widen it.
     */
    matches: string[];
    /**
     * The script, as source text. It is wrapped in a function before it runs, so
     * top-level `const` stays out of the world's globals, and `patcher` is in scope.
     */
    code: string;
}
/**
 * A search engine the user can pick for the browser's address bar.
 *
 * Data only — the browser holds the template and formats it, so nothing is asked
 * of the plugin when the user presses Enter. That is what makes this possible at
 * all: what Enter does is resolved synchronously from the typed text, and a
 * provider that had to be awaited could never own it.
 *
 * The consequence worth knowing: an engine need not search. Any `https` address
 * with `%s` in it is one, and so is a **loopback** address — including your own
 * `patcher.http.route`, which is how "Enter asks an agent" is built.
 */
interface PluginBrowserSearchEngineRegistration {
    /** Unique within this plugin: [a-zA-Z0-9_-]+. Stored in the user's setting. */
    id: string;
    /** Shown in the setting's list. */
    name: string;
    /**
     * Absolute URL with `%s` where the query goes, escaped by the browser. `https`
     * only, apart from loopback: a search is every word typed into the address bar,
     * and sending that in the clear to another machine is not a plugin's call.
     */
    urlTemplate: string;
}
/** The page the site-info popover is describing. */
interface PluginBrowserSiteInfoContext {
    /** The browser tab whose padlock was clicked. */
    tabId: string;
    /** The page's address. Never empty — a tab with no page asks nobody. */
    url: string;
    /** `example.com`, or `example.com:8443` when the port is not the default. */
    host: string;
}
/** One line in a provider's section: a name and what it says. */
interface PluginBrowserSiteInfoRow {
    label: string;
    value: string;
}
interface PluginBrowserSiteInfoProviderRegistration {
    /** Unique within this plugin: [a-zA-Z0-9_-]+. */
    id: string;
    /** The section heading, e.g. "Passwords". */
    label: string;
    /**
     * What this plugin knows about the site, asked each time the popover opens.
     *
     * Return `null` — or no rows — to show nothing, which is what a provider with
     * nothing to say about *this* site should do rather than a row reading "none".
     * Time-boxed like an omnibox suggestion: the popover is already open, so a
     * provider that hangs is dropped rather than waited for.
     */
    describe(context: PluginBrowserSiteInfoContext): PluginBrowserSiteInfoRow[] | null | Promise<PluginBrowserSiteInfoRow[] | null>;
}
/** What a find action was run with. */
interface PluginBrowserFindContext {
    /** The browser tab whose find bar the button was pressed in. */
    tabId: string;
    pageUrl: string;
    /** What the user had typed. Never empty — an empty bar offers no actions. */
    query: string;
}
/** A PDF the browser opened but could not read as text. */
interface PluginBrowserPdfDocument {
    /** The browser tab the document is open in. */
    tabId: string;
    /** Where it came from — fetchable again with `patcher.browser.storage` cookies. */
    pageUrl: string;
    title: string | null;
}
/**
 * Read a PDF the browser could not, which is what makes OCR a plugin rather
 * than a feature.
 *
 * Asked **only** for a document the browser has already parsed and found no
 * text in: a scan, or pages that are images of text. A PDF with a text layer
 * never reaches a provider, so this is not a way to intercept ordinary reads —
 * it is the one case where the browser has nothing and something else might.
 *
 * Providers are asked in plugin id order and the first non-empty answer wins.
 * Return null to decline; declining, throwing and running out of time are the
 * same answer, and the agent is told the document has no text layer.
 */
type PluginBrowserPdfTextProvider = (document: PluginBrowserPdfDocument) => string | null | Promise<string | null>;
/** A link another app asked macOS to open, handed here because Patcher is the
 * user's default browser. */
interface PluginBrowserExternalLink {
    /** The address. Always `http(s)`: the shell drops every other scheme. */
    url: string;
}
/** What a handler decided about one such link. */
interface PluginBrowserExternalLinkDecision {
    /** Open this address instead of the one that arrived. Must be `http(s)`. */
    url?: string;
    /**
     * True when the plugin dealt with the link itself and Patcher should open no tab —
     * a link routed to a workspace, filed for later, answered by an agent.
     */
    handled?: boolean;
}
/**
 * Decide where a link the *system* handed Patcher goes.
 *
 * This is the seam the "which browser opens what" apps exist for, and it only
 * exists while Patcher is the default browser: the link was clicked in Mail, Slack or
 * a terminal, and Patcher is what macOS launched with it.
 *
 * Handlers are asked in plugin id order and the **first decision wins** — a
 * rewritten address, or `handled` for a link the plugin took over. Return null to
 * decline; declining, throwing and running out of time are the same answer, and
 * the link opens in a tab exactly as it would with no plugins at all. The user is
 * waiting on a click, so the time box is short.
 */
type PluginBrowserExternalLinkHandler = (link: PluginBrowserExternalLink) => PluginBrowserExternalLinkDecision | null | Promise<PluginBrowserExternalLinkDecision | null>;
interface PluginBrowserFindActionRegistration {
    /** Unique within this plugin: [a-zA-Z0-9_-]+. */
    id: string;
    /** The button label, shown after the browser's own find controls. */
    title: string;
    /**
     * Runs server-side when the user presses the button. Fire-and-forget, like a
     * context-menu item: the find bar does not wait for it, so report progress
     * through your own surfaces rather than by returning something.
     */
    run(context: PluginBrowserFindContext): void | Promise<void>;
}
/** A page about to be written to the browser's history store. */
interface PluginBrowserHistoryVisit {
    /**
     * The surface the visit happened on — an agent thread's id, or the browser
     * surface's own. History is stored per scope, which is why the new-tab screen
     * of one thread shows that thread's pages.
     */
    scopeId: string;
    url: string;
    title: string | null;
    visitedAt: number;
}
/** What to record instead. Omitted fields keep what the visit carried. */
interface PluginBrowserHistoryRewrite {
    url?: string;
    title?: string | null;
}
/**
 * Decide what the browser remembers about a page — see
 * `patcher.browser.registerHistoryFilter`.
 *
 * Return nothing to accept the visit as it stands, a rewrite to change what is
 * stored (strip tracking parameters, retitle a page whose own title is
 * useless), or `null` to drop it, which is how "never record this site" is
 * built without the browser knowing what a private site is.
 *
 * Filters run before the write, in plugin id order, each seeing the previous
 * one's result; the first `null` ends it. A filter that throws or runs out of
 * time is skipped, so a broken plugin loses its say rather than the user's
 * history.
 */
type PluginBrowserHistoryFilter = (visit: PluginBrowserHistoryVisit) => PluginBrowserHistoryRewrite | null | void | Promise<PluginBrowserHistoryRewrite | null | void>;
/**
 * One tab of the browser surface.
 *
 * `live` is the field to read before anything else. A tab only has a real page
 * behind it once it has been the active tab while the browser surface was open,
 * so tab bookkeeping works for every tab while reading a page or replaying its
 * history only works for a live one. When `live` is false the navigation flags
 * are false because they are unknown, not because the answer is no.
 *
 * Live is **earned once and then kept**: switching away hides the view but
 * leaves the page loaded and running, so a tab the user is not looking at is
 * still readable and drivable. Closing the tab ends it, and so does restarting
 * the app — nothing is live again until it has been shown again.
 *
 * `tabs.open({ activate: false })` is live too, and that is a deliberate
 * exception rather than the general rule: a tab opened in the background gets a
 * hidden view and loads its URL, because "open this without taking the window
 * away from the user" is worthless if the next read fails. What stays cold is
 * the tab nobody asked to load — one restored from a previous session, which
 * holds a URL and nothing else until it is shown. A background job over
 * *restored* tabs therefore still has to bring each one forward once per run of
 * the app; one over tabs it opened itself does not.
 */
interface PluginBrowserTab {
    tabId: string;
    url: string;
    title: string | null;
    active: boolean;
    live: boolean;
    loading: boolean;
    canGoBack: boolean;
    canGoForward: boolean;
}
interface PluginBrowserCallOptions {
    /**
     * Abandons the wait — not the page. A navigation already under way keeps
     * going; only this call stops waiting for it. Pass a tool's `ctx.signal` so an
     * abandoned turn does not sit out the timeout.
     */
    signal?: AbortSignal;
    /** 1–60000ms, default 10000. */
    timeoutMs?: number;
}
interface PluginBrowserTabs {
    list(options?: PluginBrowserCallOptions): Promise<PluginBrowserTab[]>;
    /**
     * Open a tab. Omit `url` for the browser's new-tab screen.
     *
     * `activate` defaults to true. Passing false opens the tab **without moving
     * the user's focus off what they were reading**, and the tab is still live: it
     * loads in a hidden view and this call waits for it, so the page can be read
     * in the next call. That is the one thing to know about it — a background open
     * costs a real page load whether or not anyone ever looks at the tab, so it is
     * for a tab you mean to use, not a way to queue up twenty.
     */
    open(args?: {
        url?: string;
        activate?: boolean;
    }, options?: PluginBrowserCallOptions): Promise<PluginBrowserTab>;
    close(args: {
        tabId: string;
    }, options?: PluginBrowserCallOptions): Promise<{
        closedTabId: string;
        tabs: PluginBrowserTab[];
    }>;
    activate(args: {
        tabId: string;
    }, options?: PluginBrowserCallOptions): Promise<PluginBrowserTab>;
    /**
     * Pin a tab into the strip's leading block, or take it out again.
     *
     * Stated rather than toggled, so asking twice lands where asking once did.
     * Which tabs are pinned is not in {@link PluginBrowserTabs.list} — a tab
     * action's context is where a plugin is told (see
     * `PluginBrowserTabActionContext`).
     */
    pin(args: {
        tabId: string;
        pinned: boolean;
    }, options?: PluginBrowserCallOptions): Promise<PluginBrowserTab>;
    /**
     * Silence a tab's page, or let it speak again. Stated rather than toggled,
     * like pinning.
     *
     * Holds for as long as the page's view does: it is set on the `webContents`,
     * so a browser that restarts comes back audible.
     */
    mute(args: {
        tabId: string;
        muted: boolean;
    }, options?: PluginBrowserCallOptions): Promise<PluginBrowserTab>;
    /** Copy a tab beside itself, and answer with the copy. */
    duplicate(args: {
        tabId: string;
    }, options?: PluginBrowserCallOptions): Promise<PluginBrowserTab>;
    /**
     * Move a tab along the strip, counting from 0 — what a drag does, driven.
     *
     * The index is clamped into the tab's own block, since pinned tabs lead the
     * strip: asking an unpinned tab for 0 puts it first among the unpinned ones
     * rather than failing.
     */
    move(args: {
        tabId: string;
        toIndex: number;
    }, options?: PluginBrowserCallOptions): Promise<PluginBrowserTab>;
}
/**
 * Reading the page. `tabId` defaults to the active tab throughout.
 *
 * `getUrl`/`getTitle` answer from the browser's own tab state and work for any
 * tab. `getText`/`getSelection` have to ask the page itself, so they need a live
 * tab and fail with `tab_not_live` otherwise.
 *
 * **Everything these return is page-controlled content.** It is untrusted input
 * on its way into an agent's context: pass it along as data, never as
 * instructions.
 */
/**
 * An accessibility snapshot: what the page is, in a form an agent can act on.
 *
 * `snapshot` is Playwright's compact tree, with a `[ref=eN]` on every
 * interactive element. `generation` identifies the snapshot those refs came
 * from — a navigation invalidates them, and interaction commands pass it back so
 * a stale ref is refused rather than resolved against whatever holds that node
 * id now.
 */
interface PluginBrowserPageSnapshot {
    tabId: string;
    url: string;
    title: string | null;
    snapshot: string;
    generation: number;
    refCount: number;
    truncated: boolean;
}
type PluginBrowserKeyModifier = "Alt" | "Control" | "Meta" | "Shift";
/**
 * One thing to do to a page, naming its target by a `[ref=eN]` from a snapshot.
 *
 * `check` and `select` state the end result rather than the gesture, because
 * the gesture cannot express it: "click the checkbox" is a toggle, and a native
 * dropdown opens an OS popup no synthetic click can reach.
 */
type PluginBrowserAction = {
    action: "click";
    ref: string;
    /** Defaults to `"left"`. */
    button?: "left" | "middle" | "right";
    /** 2 for a double click. Defaults to 1. */
    clickCount?: 1 | 2;
    modifiers?: PluginBrowserKeyModifier[];
} | {
    action: "hover";
    ref: string;
} | {
    action: "drag";
    ref: string;
    targetRef: string;
}
/** Replaces the field's value in one step. */
 | {
    action: "fill";
    ref: string;
    text: string;
}
/** Sends one key event per character, for fields that watch keystrokes. */
 | {
    action: "type";
    ref: string;
    text: string;
}
/** Omit `ref` to press the key at whatever the page has focused. */
 | {
    action: "press";
    key: string;
    ref?: string;
} | {
    action: "select";
    ref: string;
    values: string[];
} | {
    action: "check";
    ref: string;
    checked: boolean;
}
/**
 * Hands the page the contents of local files, by absolute path on the machine
 * running the desktop app.
 */
 | {
    action: "upload";
    ref: string;
    paths: string[];
}
/** Emulated viewport size; both zero restores the panel's own size. */
 | {
    action: "resize";
    width: number;
    height: number;
};
/** Where a tab ended up. */
interface PluginBrowserPageState {
    tabId: string;
    url: string;
    title: string | null;
}
/**
 * A capture of what a tab is showing. `base64` rather than bytes because that is
 * what crossed the wire: a caller forwarding it on (into a tool result, say)
 * would otherwise pay for a decode and a re-encode, and one that wants the bytes
 * spends a single `Buffer.from(base64, "base64")`.
 *
 * `width`/`height` are the captured pixels. For a viewport capture those are
 * device pixels, larger than the CSS viewport on a retina display; for a
 * full-page capture they are CSS pixels, because that capture is rendered at
 * 1:1. `fullPage` says which, and `truncated` says the document was longer than
 * one capture can hold and this is its top.
 */
interface PluginBrowserScreenshot extends PluginBrowserPageState {
    mimeType: "image/png" | "image/jpeg";
    base64: string;
    width: number;
    height: number;
    fullPage: boolean;
    truncated: boolean;
}
interface PluginBrowserPdf extends PluginBrowserPageState {
    base64: string;
    byteLength: number;
}
/** One line the page wrote to its console. Page-authored, like page text. */
interface PluginBrowserConsoleEntry {
    level: "debug" | "info" | "warning" | "error";
    text: string;
    /** Script URL the message came from; empty when the page gave none. */
    source: string;
    line: number;
    timestamp: number;
}
/**
 * One request the tab finished. `status` is null when there was no response —
 * `error` then carries Chromium's `net::ERR_*` name, including for a request
 * Patcher's own session firewall refused.
 */
interface PluginBrowserNetworkEntry {
    method: string;
    url: string;
    /** Chromium's resource type (`mainFrame`, `xhr`, `script`, …). */
    resourceType: string;
    status: number | null;
    fromCache: boolean;
    error: string | null;
    timestamp: number;
}
/**
 * A slice of one of a tab's logs.
 *
 * `droppedCount` is what makes the slice honest: the buffers are fixed-size
 * rings filled from the moment the tab was created, so a busy page loses its
 * oldest entries, and the requested limit cuts more. Read it before concluding a
 * page logged nothing.
 */
interface PluginBrowserLog<TEntry> extends PluginBrowserPageState {
    entries: TEntry[];
    droppedCount: number;
}
interface PluginBrowserPage {
    /**
     * Snapshot the page's accessibility tree. Needs a live tab, like the text
     * reads, and additionally attaches the browser debugger to that tab — which
     * fails while DevTools is open on it (`debugger_unavailable`).
     */
    snapshot(args?: {
        tabId?: string;
        maxDepth?: number;
        selector?: string;
    }, options?: PluginBrowserCallOptions): Promise<PluginBrowserPageSnapshot>;
    /**
     * Act on the page: click, fill, press, and the rest.
     *
     * One method rather than ten, because every action shares the same preamble
     * (resolve the ref, check the generation, wait for the element to be
     * actionable) and the difference between them is data, not control flow.
     *
     * **Waits before acting.** The element must be attached, visible, settled,
     * enabled and on top at the point being clicked; that wait is what makes an
     * action a command rather than a race, and it is why no caller should sleep
     * before calling this. Failure to become actionable is `not_actionable`, with
     * the reason in the message.
     *
     * `generation` is the snapshot the refs came from. Passing it refuses a ref
     * that a newer snapshot has since reassigned; omitting it accepts that race.
     * Navigation invalidates every ref either way (`unknown_ref`).
     *
     * Resolves with where the tab ended up, since the common actions navigate.
     */
    act(args: {
        action: PluginBrowserAction;
        tabId?: string;
        generation?: number;
    }, options?: PluginBrowserCallOptions): Promise<PluginBrowserPageState>;
    /**
     * Answer the JavaScript dialog a tab is blocked on. Resolves false when there
     * was none — including when the user answered it first, which is not a
     * failure. Only tabs the shell has taken dialogs over for can have one; a tab
     * nobody has automated still shows Chromium's own modal.
     */
    /**
     * Capture what the tab is showing.
     *
     * The visible viewport by default, or the whole scrollable document with
     * `fullPage`. Defaults to JPEG at quality 80, which is the right trade for
     * looking at a page; ask for PNG when exact pixels matter.
     *
     * **`fullPage` is not free.** A composited capture is a viewport by
     * construction, so the whole document has to come from the browser debugger —
     * which fails while the user has DevTools open on that tab
     * (`debugger_unavailable`), and which the viewport capture never touches. It
     * stops short of taking the tab's dialogs over, so a page that alerts still
     * shows the user Chromium's own modal. A document past ~16k CSS pixels comes
     * back as its top, with `truncated` set.
     */
    screenshot(args?: {
        tabId?: string;
        format?: "png" | "jpeg";
        /** 1–100, JPEG only. */
        quality?: number;
        /** The whole document instead of the viewport. Defaults to false. */
        fullPage?: boolean;
    }, options?: PluginBrowserCallOptions): Promise<PluginBrowserScreenshot>;
    /**
     * Print the tab to a PDF. Unlike a screenshot this is the whole document, so
     * it is also the one call that can come back `result_too_large`. Give it a
     * longer `timeoutMs` than the default: rendering a long page is not fast.
     */
    pdf(args?: {
        tabId?: string;
    }, options?: PluginBrowserCallOptions): Promise<PluginBrowserPdf>;
    /**
     * What the page has written to its console, newest last.
     *
     * Recorded from the moment the tab was created rather than from the first
     * automation call, so this answers for a tab nobody has driven. `limit`
     * defaults to 100 and counts back from the most recent.
     */
    console(args?: {
        tabId?: string;
        limit?: number;
    }, options?: PluginBrowserCallOptions): Promise<PluginBrowserLog<PluginBrowserConsoleEntry>>;
    /**
     * What the tab has requested, newest last. Recorded like the console log, and
     * tab-scoped rather than page-scoped: a navigation does not clear it, so the
     * redirect chain that led to the current page is still in there.
     */
    network(args?: {
        tabId?: string;
        limit?: number;
    }, options?: PluginBrowserCallOptions): Promise<PluginBrowserLog<PluginBrowserNetworkEntry>>;
    handleDialog(args: {
        accept: boolean;
        tabId?: string;
        promptText?: string;
    }, options?: PluginBrowserCallOptions): Promise<boolean>;
    /**
     * Scale the page, and resolve with what it became.
     *
     * `factor` is a multiplier where 1 is 100%, and one outside Chrome's own
     * 0.25–5 is **refused** rather than quietly clamped — a call that reported a
     * factor nobody asked for would be worse than an error. The answer is read
     * back rather than echoed, because Chromium is the one that decides — and it
     * remembers zoom **per site**, so this also sets what that site looks like the
     * next time any tab opens it.
     */
    zoom(args: {
        factor: number;
        tabId?: string;
    }, options?: PluginBrowserCallOptions): Promise<number>;
    getUrl(args?: {
        tabId?: string;
    }, options?: PluginBrowserCallOptions): Promise<string>;
    getTitle(args?: {
        tabId?: string;
    }, options?: PluginBrowserCallOptions): Promise<string | null>;
    /**
     * The page's rendered text, or one element's.
     *
     * `selector` narrows the read to what a CSS selector matches — the whole
     * point being that a caller who says "the article" gets the article and not a
     * document with the article in it. The two are not the same read underneath:
     * the unscoped one runs a constant script in an isolated world and needs no
     * debugger, while a scoped one has to ask the browser which element the
     * selector means, so it **attaches the tab's debugger** exactly as
     * {@link PluginBrowserPage.snapshot} does — and can therefore fail with
     * `debugger_unavailable`, `invalid_selector` or `no_match`, none of which an
     * unscoped read produces.
     */
    getText(args?: {
        tabId?: string;
        maxLength?: number;
        selector?: string;
    }, options?: PluginBrowserCallOptions): Promise<{
        text: string;
        truncated: boolean;
    }>;
    getSelection(args?: {
        tabId?: string;
    }, options?: PluginBrowserCallOptions): Promise<{
        text: string;
    }>;
}
/**
 * One cookie, in Playwright's `storageState` shape.
 *
 * That is the interop decision of this group: a file assembled from these loads
 * into Playwright, and one Playwright wrote loads back here. `expires` is
 * seconds since the epoch, or -1 for a cookie that dies with the session.
 *
 * **`value` is the login.** These come from `session.cookies`, not
 * `document.cookie`, so `httpOnly` ones are included — which is the point, since
 * those are the ones that hold a session, and also why anything that logs or
 * forwards this is handling credentials.
 */
interface PluginBrowserCookie {
    name: string;
    value: string;
    /** A leading dot means a domain cookie; without one it is host-only. */
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Strict" | "Lax" | "None";
}
/**
 * A cookie to write. Only the name and value are required; a cookie with no
 * domain of its own is written against the tab's URL, and the rest default to a
 * host-only, non-secure, `Lax` session cookie.
 */
interface PluginBrowserCookieInput {
    name: string;
    value: string;
    domain?: string;
    path?: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "Strict" | "Lax" | "None";
}
interface PluginBrowserStorageItem {
    name: string;
    value: string;
}
/** `session` is per-tab and dies with it; `local` is per-origin and does not. */
type PluginBrowserStorageArea = "local" | "session";
interface PluginBrowserCookies extends PluginBrowserPageState {
    cookies: PluginBrowserCookie[];
}
interface PluginBrowserStorageItems extends PluginBrowserPageState {
    area: PluginBrowserStorageArea;
    items: PluginBrowserStorageItem[];
    /**
     * The origin held more than the bridge will carry, so this is a part of it.
     * Worth checking before saving state: a partial state restores a session that
     * only partly works.
     */
    truncated: boolean;
}
/**
 * What a write landed and what the browser refused — a cookie whose domain and
 * scheme disagree, or an item past the origin's quota. A partial write is a
 * realistic outcome and a silent one is expensive, so both numbers come back.
 */
interface PluginBrowserStorageWrite {
    applied: number;
    rejected: number;
}
/**
 * A tab's stored state: cookies, `localStorage`, `sessionStorage`.
 *
 * Everything is scoped to one tab — cookies to the URL that tab is on, web
 * storage to its origin — so reading state for a site means opening it in a tab
 * first. `tabId` defaults to the active tab, as everywhere else.
 *
 * **This is credential access, not page content.** In a browser holding the
 * user's real logins, what `cookies()` returns for a signed-in site *is* that
 * session, and `setCookies` puts one into the user's browser for real. Say so
 * in any tool built on it rather than describing it as "reading settings".
 */
interface PluginBrowserStorage {
    cookies(args?: {
        tabId?: string;
    }, options?: PluginBrowserCallOptions): Promise<PluginBrowserCookies>;
    /**
     * Write cookies. A cookie carrying its own `domain` is written to that
     * domain rather than to the tab's, which is what makes a saved state restore
     * the session it came from.
     */
    setCookies(args: {
        cookies: PluginBrowserCookieInput[];
        tabId?: string;
    }, options?: PluginBrowserCallOptions): Promise<PluginBrowserStorageWrite>;
    /** Omit `name` to clear every cookie the tab's URL carries. */
    clearCookies(args?: {
        name?: string;
        tabId?: string;
    }, options?: PluginBrowserCallOptions): Promise<{
        removed: number;
    }>;
    /** Needs a live tab: web storage is read out of the page itself. */
    items(args: {
        area: PluginBrowserStorageArea;
        tabId?: string;
    }, options?: PluginBrowserCallOptions): Promise<PluginBrowserStorageItems>;
    setItems(args: {
        area: PluginBrowserStorageArea;
        items: PluginBrowserStorageItem[];
        tabId?: string;
    }, options?: PluginBrowserCallOptions): Promise<PluginBrowserStorageWrite>;
    /** Omit `name` to clear the whole area. */
    clearItems(args: {
        area: PluginBrowserStorageArea;
        name?: string;
        tabId?: string;
    }, options?: PluginBrowserCallOptions): Promise<{
        removed: number;
    }>;
}
/**
 * A response the tab should be given instead of the network's.
 *
 * `pattern` is Playwright's URL glob — `**` crosses path separators, `*` stops
 * at one — so a pattern written from Playwright's documentation means here what
 * it means there.
 */
interface PluginBrowserRoute {
    pattern: string;
    /** Defaults to 200. */
    status?: number;
    /** Defaults to `application/json` for a body that looks like JSON. */
    contentType?: string;
    /** Defaults to empty. */
    body?: string;
    headers?: {
        name: string;
        value: string;
    }[];
}
interface PluginBrowserRouteState {
    pattern: string;
    status: number;
    contentType: string;
    body: string;
    headers: {
        name: string;
        value: string;
    }[];
    /** How many requests this route has answered. Zero means it never fired. */
    matched: number;
}
interface PluginBrowserRoutes extends PluginBrowserPageState {
    routes: PluginBrowserRouteState[];
    offline: boolean;
}
/**
 * What an expression returned, as JSON text — `"42"`, `"\"hello\""`,
 * `"undefined"`. Text rather than a value because a page can return anything,
 * and a caller that wants structure knows what it asked for and can `JSON.parse`
 * it. `truncated` means the answer was longer than the bridge carries.
 */
interface PluginBrowserEvaluated extends PluginBrowserPageState {
    value: string;
    truncated: boolean;
}
/**
 * Driving a tab past the paths that make the rest of this API safe.
 *
 * These are grouped by how much they hand over rather than by what they do.
 * `evaluate` runs your JavaScript in a page that may hold the user's live
 * logins, in the page's own world — it can read anything the page can, and
 * change anything the user could. The mouse calls act at raw viewport
 * coordinates: no ref, no actionability check, so they land on whatever is at
 * that point, which is the price of reaching a canvas the accessibility tree
 * cannot describe. `route` rewrites what the page receives from the network,
 * and `setOffline` cuts it off.
 *
 * Use them where the safer paths genuinely cannot reach, and say plainly in any
 * tool built on them what they are.
 */
interface PluginBrowserControl {
    /**
     * Run a function in the page and return what it returned. The expression is a
     * function: `() => document.title`, or `(el) => el.value` with a `ref` from a
     * snapshot naming the element to pass in.
     */
    evaluate(args: {
        expression: string;
        ref?: string;
        tabId?: string;
        generation?: number;
    }, options?: PluginBrowserCallOptions): Promise<PluginBrowserEvaluated>;
    /** Move the pointer. Where it lands is where the next press acts. */
    mouseMove(args: {
        x: number;
        y: number;
        tabId?: string;
    }, options?: PluginBrowserCallOptions): Promise<PluginBrowserPageState>;
    /** Press or release, at the last `mouseMove` point (0,0 until you move). */
    mouseButton(args: {
        down: boolean;
        button?: "left" | "middle" | "right";
        tabId?: string;
    }, options?: PluginBrowserCallOptions): Promise<PluginBrowserPageState>;
    mouseWheel(args: {
        deltaX?: number;
        deltaY?: number;
        tabId?: string;
    }, options?: PluginBrowserCallOptions): Promise<PluginBrowserPageState>;
    /** Add or replace a route. A second route for the same pattern replaces it. */
    route(args: PluginBrowserRoute & {
        tabId?: string;
    }, options?: PluginBrowserCallOptions): Promise<PluginBrowserRoutes>;
    routes(args?: {
        tabId?: string;
    }, options?: PluginBrowserCallOptions): Promise<PluginBrowserRoutes>;
    /** Omit `pattern` to remove every route on the tab. */
    unroute(args?: {
        pattern?: string;
        tabId?: string;
    }, options?: PluginBrowserCallOptions): Promise<PluginBrowserRoutes>;
    /**
     * Per tab, not per browser: one tab can be offline while the user keeps
     * browsing in the next one. Lasts as long as the tab's debugger session.
     */
    setOffline(args: {
        offline: boolean;
        tabId?: string;
    }, options?: PluginBrowserCallOptions): Promise<PluginBrowserPageState>;
}
/** One command a trace remembers. `error` is the failure's code, or null. */
interface PluginBrowserTraceStep {
    seq: number;
    /** Milliseconds since the trace started. */
    at: number;
    command: string;
    detail: string;
    ok: boolean;
    error: string | null;
    /** Base64 JPEG of the visible tab, when the trace was asked for pictures. */
    image: string | null;
}
interface PluginBrowserTrace {
    steps: PluginBrowserTraceStep[];
    /** Steps and pictures the recording did not keep, so a gap is never silent. */
    droppedSteps: number;
    droppedImages: number;
    durationMs: number;
}
interface PluginBrowserVideo extends PluginBrowserPageState {
    /** Base64 JPEGs in order, each stamped with where it belongs in time. */
    frames: {
        at: number;
        base64: string;
    }[];
    chapters: {
        at: number;
        title: string;
    }[];
    droppedFrames: number;
    durationMs: number;
}
/**
 * Recording a session, in two halves that record different things.
 *
 * The **trace** is Patcher's own log of the browser commands this app ran — what was
 * asked for, what came back, optionally a picture after each step. It is not
 * Playwright's trace format and no Playwright viewer will open it; it is a JSON
 * log meant to be read.
 *
 * The **video** is frames of one tab, taken by the browser itself. It comes back
 * as JPEGs and timings rather than a playable file: Patcher ships no video encoder,
 * so turning the frames into one is a job for `ffmpeg` and the caller.
 */
interface PluginBrowserRecording {
    /** Begins the log. One at a time; starting a second one fails. */
    traceStart(args?: {
        screenshots?: boolean;
    }, options?: PluginBrowserCallOptions): Promise<void>;
    /** Ends it and hands it over — the only way to read a trace. */
    traceStop(options?: PluginBrowserCallOptions): Promise<PluginBrowserTrace>;
    /** Films a tab. Frames per second defaults to 5; the tab must be visible. */
    videoStart(args?: {
        fps?: number;
        tabId?: string;
    }, options?: PluginBrowserCallOptions): Promise<void>;
    /** Marks a moment in the film, for whoever reads it later. */
    videoChapter(args: {
        title: string;
        tabId?: string;
    }, options?: PluginBrowserCallOptions): Promise<void>;
    videoStop(args?: {
        tabId?: string;
    }, options?: PluginBrowserCallOptions): Promise<PluginBrowserVideo>;
}
interface PluginBrowserNavigation {
    /**
     * Open `url` (http/https only) in a tab. On a tab with no live view the URL is
     * stored and loads when that tab is next opened, so this is the one navigation
     * call that still does something useful off-screen.
     */
    open(args: {
        url: string;
        tabId?: string;
        newTab?: boolean;
    }, options?: PluginBrowserCallOptions): Promise<PluginBrowserTab>;
    back(args?: {
        tabId?: string;
    }, options?: PluginBrowserCallOptions): Promise<PluginBrowserTab>;
    forward(args?: {
        tabId?: string;
    }, options?: PluginBrowserCallOptions): Promise<PluginBrowserTab>;
    reload(args?: {
        tabId?: string;
    }, options?: PluginBrowserCallOptions): Promise<PluginBrowserTab>;
}
/**
 * Why a browser call failed, carried as `code` on a thrown error whose `name` is
 * `"BrowserCommandError"`. Match on `name` rather than `instanceof` — no runtime
 * class from the host ships to plugins.
 *
 * Other error names worth handling: `"BrowserHostUnavailableError"` (no browser
 * window is connected at all), `"BrowserCommandTimeoutError"`, and
 * `"BrowserCommandAbortedError"`.
 */
type PluginBrowserErrorCode = "no_active_tab" | "unknown_tab" | "tab_not_live" | "desktop_unavailable" | "unsupported_command" | "blocked_url" | "page_read_timeout" | "page_read_failed" | "debugger_unavailable" | "stale_refs" | "unknown_ref" | "invalid_selector" | "no_match" | "not_actionable" | "unsupported_key" | "result_too_large" | "evaluation_failed" | "too_many_routes" | "already_recording" | "not_recording" | "invalid_command";
interface PluginBrowserStatus {
    connected: boolean;
    /** How many app windows could serve a browser call right now. */
    windowCount: number;
}
interface PluginBrowser {
    /**
     * Register an omnibox provider for the browser surface's address bar
     * (`browser.omnibox.providers`). Rows appear in the same ranked list as the
     * browser's own address, search, open-tab and history rows, labelled with
     * `label` so their source is visible. Multiple providers per plugin; ids must
     * be unique within the plugin.
     */
    registerOmniboxProvider(provider: PluginOmniboxProviderRegistration): void;
    /**
     * Take over what happens to a file the browser downloaded
     * (`browser.downloads.handlers`). Runs after Patcher has written it to the user's
     * downloads folder — see {@link PluginBrowserDownloadHandler} for what a
     * handler may do with it and why it cannot prevent the write.
     *
     * Additive: several handlers, in this plugin or across plugins, all run.
     */
    registerDownloadHandler(handler: PluginBrowserDownloadHandler): void;
    /**
     * Add an entry to the right-click menu of a browsed page
     * (`browser.contextMenu.items`).
     *
     * Items are **declared**, not asked for at click time: the shell holds the
     * list so a right-click opens without waiting on the server. The consequence
     * worth knowing is that `title` and `when` are fixed at registration — an
     * item cannot decide its own label from what was clicked.
     *
     * Entries appear below the browser's own, in plugin id order.
     */
    registerContextMenuItem(item: PluginBrowserContextMenuItemRegistration): void;
    /**
     * Add a button to the browser's find bar (`browser.find.actions`), carrying
     * whatever the user has typed into it.
     *
     * The find bar is the one place that knows what the user is looking for on
     * this page, which is what makes it worth extending: "search this across my
     * tabs", "look it up in our docs", "ask an agent about it". The bar's own
     * counter and arrows are the browser's; contributed buttons sit after them.
     *
     * Declared like context-menu items, and with the same consequence: `title` is
     * fixed at registration, so a button cannot rename itself from the query.
     */
    registerFindAction(action: PluginBrowserFindActionRegistration): void;
    /**
     * Add an entry to a browser tab's context menu (`browser.tab.actions`) — the
     * tab **action** point.
     *
     * The tab strip is where a browser keeps what the user is holding open, so
     * this is the place for what a plugin does *to one of them*: send it to an
     * agent, file it, sync it, open it somewhere else. Patcher's own entries — pin,
     * duplicate, mute, close — come first and contributed entries follow, in
     * plugin id order.
     *
     * Declared like context-menu items, and with the same consequence: `title` is
     * fixed at registration, so an entry cannot rename itself from the tab it is
     * shown on. To *mark* a tab instead of acting on one, see
     * `contentScript.experimental_setBrowserTabStatus`.
     */
    registerTabAction(action: PluginBrowserTabActionRegistration): void;
    /**
     * Add a section to the browser's site-info popover — what opens when the user
     * clicks the padlock in the address bar (`browser.siteInfo.sections`).
     *
     * The popover is the one place in the browser that is *about the site* rather
     * than about the page, which is what makes it worth extending: saved logins for
     * this host, trackers blocked on it, whether it is on the user's own allowlist.
     *
     * Patcher's own section — what it can honestly say about the connection — comes
     * first; contributed sections follow in plugin id order. Rows are text, not
     * controls: a section reports, and anything to *do* belongs on the tab or page
     * menu where a click has somewhere to go.
     */
    registerSiteInfoProvider(provider: PluginBrowserSiteInfoProviderRegistration): void;
    /**
     * Put a control in the browser's toolbar (`browser.toolbar.items`) — the
     * address row, beside Patcher's own downloads and open-externally buttons.
     *
     * The row is where a browser keeps what applies to *the page you are looking
     * at right now*, which is what this point is for: a star that knows whether
     * this page is saved, a reader mode, "open this in the other browser". Patcher's own
     * controls keep their places and contributed ones sit between the address bar
     * and them, in plugin id order.
     *
     * **One per plugin**, unlike the menus: a menu grows downwards for free and
     * this row does not, and a plugin that needs a second control has a panel of
     * its own to put it in.
     *
     * Costs `toolbar.register` rather than sharing a permission with the menus,
     * because it is not like them: `state` is handed the address of every page the
     * user opens, without the user asking for anything.
     */
    registerToolbarItem(item: PluginBrowserToolbarItemRegistration): void;
    /**
     * Add a section to the browser's new-tab screen (`browser.newTab.widgets`) —
     * see {@link PluginBrowserNewTabWidgetRegistration}.
     *
     * A new tab is the one moment the browser has nothing to show, which is what
     * makes it worth extending: saved pages, a reading list, the tabs you closed
     * yesterday. Patcher's own "Recently visited" comes first and contributed sections
     * follow in plugin id order.
     *
     * Costs `newTab.register`. Nothing about the user's browsing is handed over —
     * a new tab has no page — so what the permission buys is the placement itself.
     */
    registerNewTabWidget(widget: PluginBrowserNewTabWidgetRegistration): void;
    /**
     * Offer a search engine for the browser's address bar
     * (`browser.searchEngines`) — see
     * {@link PluginBrowserSearchEngineRegistration}.
     *
     * Offering is not choosing: the engine appears in the setting's list, and it is
     * used only once the user picks it. Patcher's own engines come first, then
     * contributed ones in plugin id order.
     */
    registerSearchEngine(engine: PluginBrowserSearchEngineRegistration): void;
    /**
     * Apply CSS to pages on the sites this plugin declared (`browser.pageStyles`)
     * — see {@link PluginBrowserPageStyleRegistration}.
     *
     * The cheapest way onto a page, and the first one: hiding a banner, widening a
     * column or restyling a site the user has to look at all day is one rule, runs
     * no code in the page, and reads nothing back.
     *
     * Costs `pageStyle.register` **and** the sites in `patcher.sites`: the permission
     * says the plugin restyles pages, the manifest's sites say which ones, and
     * `matches` picks from that list. Declaring neither reaches nothing.
     */
    registerPageStyle(style: PluginBrowserPageStyleRegistration): void;
    /**
     * Run this plugin's own code in pages on the sites it declared
     * (`browser.pageScripts`) — see {@link PluginBrowserPageScriptRegistration}
     * for what the browser promises about running it, and
     * {@link PluginPageScriptApi} for what the code is handed.
     *
     * Everything a page style cannot do: read the page, add a control to it,
     * answer a click by asking this plugin's backend. The script's `patcher.rpc` reaches
     * *this plugin's* rpc methods and nothing else, which is what keeps a program
     * in an untrusted page from being a program in Patcher.
     *
     * Costs `pageScript.register` **and** the sites in `patcher.sites` — a separate
     * permission from `pageStyle.register` over the same list, because a stylesheet
     * that cannot read the page and a program that can are not the same thing to
     * agree to.
     */
    registerPageScript(script: PluginBrowserPageScriptRegistration): void;
    /**
     * Answer HTTP authentication challenges for browsed pages
     * (`browser.auth.providers`) — see {@link PluginBrowserAuthProvider}.
     *
     * Additive: providers are asked in plugin id order and the first one to
     * return credentials wins. Nothing else in the browser is delegated this way,
     * deliberately — a certificate error stays the user's decision, because
     * "trust this server anyway" is not a credential a plugin can look up.
     */
    registerAuthProvider(provider: PluginBrowserAuthProvider): void;
    /**
     * Supply the text of a PDF the browser could not read
     * (`browser.pdf.textProviders`) — see {@link PluginBrowserPdfTextProvider}
     * for when a provider is asked and why that is the only time.
     *
     * Additive: providers are asked in plugin id order until one answers.
     */
    registerPdfTextProvider(provider: PluginBrowserPdfTextProvider): void;
    /**
     * Route a link the system handed Patcher, while Patcher is the user's default browser
     * (`browser.externalLink.handlers`) — see
     * {@link PluginBrowserExternalLinkHandler}.
     *
     * Additive: handlers are asked in plugin id order until one decides. Costs
     * `externalLink.handle`, which is a standing read of every address the user
     * opens from outside Patcher.
     */
    registerExternalLinkHandler(handler: PluginBrowserExternalLinkHandler): void;
    /**
     * See every page before it enters the browser's history, and rewrite or drop
     * it (`browser.history.filters`) — see {@link PluginBrowserHistoryFilter}.
     *
     * Reading and editing the store afterwards is `patcher.sdk.browserHistory`; this
     * is the only place a plugin sees a visit as it happens.
     *
     * Additive: every registered filter runs, across plugins, in plugin id order.
     */
    registerHistoryFilter(filter: PluginBrowserHistoryFilter): void;
    /**
     * Drive the browser surface's tabs, pages and navigation.
     *
     * These need a **connected browser window** — the Patcher desktop app with its
     * browser surface — which is never guaranteed and is certainly absent while
     * factories run. Call them from handlers, tools and services, never at load
     * time, and expect `BrowserHostUnavailableError` when nothing is connected.
     */
    readonly tabs: PluginBrowserTabs;
    readonly page: PluginBrowserPage;
    readonly navigation: PluginBrowserNavigation;
    readonly storage: PluginBrowserStorage;
    readonly control: PluginBrowserControl;
    readonly recording: PluginBrowserRecording;
    /** Synchronous, so it is safe to read from `patcher.agents.configure()`. */
    getStatus(): PluginBrowserStatus;
}
interface PluginEvents {
    /**
     * Add a thread lifecycle listener. Multiple listeners for the same event are
     * additive and run independently in registration order.
     */
    on<E extends PluginThreadEventName>(event: E, handler: PluginThreadEventHandler<E>): void;
}
interface PluginServerApi {
    /**
     * This Patcher server's own loopback base URL (e.g. "http://127.0.0.1:38986"),
     * which serves the SPA + /api + /ws. For plugins that proxy or relay
     * traffic back to the server itself (e.g. a tunnel). Bind-gated like
     * `patcher.sdk`: reading it before the server is listening throws, so prefer
     * reading it from handlers, services, and timers.
     */
    readonly loopbackBaseUrl: string;
}
interface PluginStatusApi {
    /**
     * Mark this plugin `needs-configuration` (with a message shown in
     * `patcher plugin list` and the UI) instead of failing — e.g. a factory or
     * service that finds no API key configured. Cleared on the next load;
     * saving settings does not auto-reload in V1, so ask the user to
     * `patcher plugin reload <id>` after configuring.
     */
    needsConfiguration(message: string): void;
}
/**
 * The API object handed to a plugin's factory (design §4). Implemented by
 * the Patcher server; this contract is what plugin `server.ts` files compile
 * against.
 */
interface PatcherPluginApi {
    /** The plugin's own id (namespaces storage, routes, commands). */
    readonly pluginId: string;
    /** Leveled, plugin-scoped logger. */
    readonly log: PluginLogger;
    /** Declarative settings (design §4.2). */
    readonly settings: PluginSettings;
    /** Namespaced KV + per-plugin database (design §4.3). */
    readonly storage: PluginStorage;
    /** HTTP routes under /api/v1/plugins/<id>/http/* (design §4.6). */
    readonly http: PluginHttp;
    /** RPC methods under /api/v1/plugins/<id>/rpc/<method> (design §4.6). */
    readonly rpc: PluginRpc;
    /** Ephemeral push to connected frontends (design §4.7). */
    readonly realtime: PluginRealtime;
    /** Long-lived services + cron schedules (design §4.8). */
    readonly background: PluginBackground;
    /** Agent-facing `patcher` CLI subcommand (design §4.4). */
    readonly cli: PluginCli;
    /** Per-turn agent context contributions (design §4.4). */
    readonly agents: PluginAgents;
    /** Host-rendered UI contributions (design §4.9). */
    readonly ui: PluginUi;
    /** Browser-surface contributions (`browser.omnibox.providers`). */
    readonly browser: PluginBrowser;
    /** Additive plugin lifecycle listeners (design §4.5). */
    readonly events: PluginEvents;
    /** Plugin-reported status (needs-configuration). */
    readonly status: PluginStatusApi;
    /** Read-only facts about the running server (loopback base URL). */
    readonly server: PluginServerApi;
    /** Server-to-daemon host control-plane declarations. */
    /**
     * The full Patcher SDK, bound to this server over loopback (design §4.1).
     * Bind-gated: reading this before the host binds the SDK throws. The real
     * server binds it before loading plugins, so it is available from the
     * moment factories run there — but isolated harnesses may not, so prefer
     * using it from handlers, services, and timers for portability.
     * `threads.spawn` defaults `origin` to "plugin" and `originPluginId` to
     * this plugin's id so spawned threads are attributed automatically.
     */
    readonly sdk: PatcherSdk;
    /**
     * Register cleanup to run on reload/disable/shutdown. Hooks run LIFO.
     * The sanctioned place to clear timers and close connections.
     */
    onDispose(hook: () => void | Promise<void>): void;
}

export { PLUGIN_CLI_OUTPUT_MAX_BYTES, defineRpcContract };
export type { ComposerCustomization, ComposerPlusMenuItem, ComposerRichTextSpec, ComposerStructuredDraft, ComposerView, JsonValue, MarkdownProps, NewThreadComposerProps, NewThreadRequest, PatcherContext, PatcherNavigate, PatcherPluginApi, PluginAgentConfiguration, PluginAgentConfigurationContext, PluginAgentToolContentPart, PluginAgentToolContext, PluginAgentToolExperimentalStatusLabels, PluginAgentToolRegistrationBase, PluginAgentToolResult, PluginAgentToolSelection, PluginAgents, PluginAppBuilder, PluginAppComposer, PluginAppContentScripts, PluginAppDefinition, PluginAppSetup, PluginAppSlots, PluginBackground, PluginBrowser, PluginBrowserAction, PluginBrowserAuthChallenge, PluginBrowserAuthCredentials, PluginBrowserAuthProvider, PluginBrowserCallOptions, PluginBrowserConsoleEntry, PluginBrowserContextMenuContext, PluginBrowserContextMenuItemRegistration, PluginBrowserContextMenuWhen, PluginBrowserControl, PluginBrowserCookie, PluginBrowserCookieInput, PluginBrowserCookies, PluginBrowserDownload, PluginBrowserDownloadHandler, PluginBrowserDownloadState, PluginBrowserErrorCode, PluginBrowserEvaluated, PluginBrowserExternalLink, PluginBrowserExternalLinkDecision, PluginBrowserExternalLinkHandler, PluginBrowserFindActionRegistration, PluginBrowserFindContext, PluginBrowserHistoryFilter, PluginBrowserHistoryRewrite, PluginBrowserHistoryVisit, PluginBrowserKeyModifier, PluginBrowserLog, PluginBrowserNavigation, PluginBrowserNetworkEntry, PluginBrowserNewTabContext, PluginBrowserNewTabRow, PluginBrowserNewTabWidgetRegistration, PluginBrowserPage, PluginBrowserPageScriptRegistration, PluginBrowserPageSnapshot, PluginBrowserPageState, PluginBrowserPageStyleRegistration, PluginBrowserPdf, PluginBrowserPdfDocument, PluginBrowserPdfTextProvider, PluginBrowserRecording, PluginBrowserRoute, PluginBrowserRouteState, PluginBrowserRoutes, PluginBrowserScreenshot, PluginBrowserSearchEngineRegistration, PluginBrowserSiteInfoContext, PluginBrowserSiteInfoProviderRegistration, PluginBrowserSiteInfoRow, PluginBrowserStatus, PluginBrowserStorage, PluginBrowserStorageArea, PluginBrowserStorageItem, PluginBrowserStorageItems, PluginBrowserStorageWrite, PluginBrowserTab, PluginBrowserTabActionContext, PluginBrowserTabActionRegistration, PluginBrowserTabStatus, PluginBrowserTabs, PluginBrowserToolbarContext, PluginBrowserToolbarItemRegistration, PluginBrowserToolbarState, PluginBrowserTrace, PluginBrowserTraceStep, PluginBrowserVideo, PluginCli, PluginCliCommandInfo, PluginCliContext, PluginCliExecutionResult, PluginCliOutputLimitError, PluginCliRegistration, PluginCliResult, PluginCommandRegistration, PluginComposerApi, PluginComposerMention, PluginComposerScope, PluginComposerTextEffect, PluginComposerThreadRowStatus, PluginContentScriptContext, PluginContentScriptDisposer, PluginContentScriptRegistration, PluginEvents, PluginFileOpenerProps, PluginFileOpenerRegistration, PluginFileOpenerSource, PluginHomepageSectionProps, PluginHomepageSectionRegistration, PluginHttp, PluginHttpAuthMode, PluginHttpHandler, PluginInteractionCancelReason, PluginInteractionRequest, PluginInteractionResult, PluginKeybinding, PluginKeybindingShortcut, PluginKvStorage, PluginLeadingPanelProps, PluginLeadingPanelRegistration, PluginLogger, PluginMentionItem, PluginMentionProviderRegistration, PluginMentionSearchContext, PluginMentionTrigger, PluginMessageActionContext, PluginMessageActionRegistration, PluginMessageActionThreadPanelOptions, PluginMessageDirectiveMessage, PluginMessageDirectiveOpenWorkspaceFile, PluginMessageDirectiveProps, PluginMessageDirectiveRegistration, PluginNavPanelProps, PluginNavPanelRegistration, PluginNewThreadPanelActionContext, PluginNewThreadPanelActionRegistration, PluginNewThreadPanelProps, PluginOmniboxAction, PluginOmniboxProviderRegistration, PluginOmniboxRunContext, PluginOmniboxRunResult, PluginOmniboxSuggestContext, PluginOmniboxSuggestion, PluginPageScriptApi, PluginPendingInteractionProps, PluginPendingInteractionRegistration, PluginPendingInteractionView, PluginRealtime, PluginRealtimeConnectionState, PluginRpc, PluginRpcCallArgs, PluginRpcClient, PluginRpcContract, PluginRpcError, PluginRpcErrorCode, PluginRpcHandlers, PluginRpcIssuePathSegment, PluginRpcMethodContract, PluginRpcResult, PluginRpcValidationIssue, PluginSdkApp, PluginServerApi, PluginSettingDescriptor, PluginSettingDescriptors, PluginSettingValue, PluginSettings, PluginSettingsHandle, PluginSettingsSectionProps, PluginSettingsSectionRegistration, PluginSettingsState, PluginSettingsValues, PluginSidebarFooterActionContext, PluginSidebarFooterActionProps, PluginSidebarFooterActionRegistration, PluginSidebarProject, PluginSidebarPullRequest, PluginSidebarSplitPane, PluginSidebarThread, PluginSidebarThreadActions, PluginSidebarThreadActivity, PluginSidebarThreadIndicator, PluginSidebarThreadPullRequestState, PluginSidebarThreadSplit, PluginSidebarThreadsState, PluginSidebarWorkspaceKind, PluginStatusApi, PluginStorage, PluginThreadEventHandler, PluginThreadEventName, PluginThreadEventPayloads, PluginThreadHeaderActionProps, PluginThreadHeaderActionRegistration, PluginThreadListProps, PluginThreadListRegistration, PluginThreadPanelActionContext, PluginThreadPanelActionRegistration, PluginThreadPanelProps, PluginUi, StandardSchemaV1, StandardSchemaV1InferInput, StandardSchemaV1InferOutput, StandardSchemaV1Issue, StandardSchemaV1Result, ThreadChatMessageAction, ThreadChatMessageReference, ThreadChatProps };
