import { describe, expect, it } from "vitest";
import { createConnection } from "../../src/connection.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";
import {
  allowEnvSetupScriptConsent,
  deleteEnvSetupScriptConsent,
  forgetEnvSetupScriptQuestion,
  hasEnvSetupScriptAllowance,
  listEnvSetupScriptConsents,
  recordEnvSetupScriptAllowance,
  recordEnvSetupScriptQuestion,
} from "../../src/data/env-setup-script-consents.js";
import { createProject } from "../../src/data/projects.js";
import { upsertHost } from "../../src/data/hosts.js";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);

function setup() {
  const db = createConnection(":memory:");
  migrate(db);
  const host = upsertHost(db, noopNotifier, {
    name: "test-host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/repos/thing" },
  });
  const sighting = {
    projectId: project.id,
    hostId: host.id,
    sourcePath: "/repos/thing",
    scriptSha256: SHA_A,
    scriptPath: "/repos/thing-wt/.patcher-env-setup.sh",
    scriptByteLength: 120,
  };
  return { db, host, project, sighting };
}

describe("env setup script consents", () => {
  it("answers only for the machine, checkout and bytes it was given", () => {
    const { db, sighting } = setup();
    recordEnvSetupScriptAllowance(db, noopNotifier, sighting);

    expect(hasEnvSetupScriptAllowance(db, sighting)).toBe(true);
    // Each part of the key on its own is enough to make it a different question.
    expect(
      hasEnvSetupScriptAllowance(db, { ...sighting, hostId: "host_other" }),
    ).toBe(false);
    expect(
      hasEnvSetupScriptAllowance(db, {
        ...sighting,
        sourcePath: "/repos/elsewhere",
      }),
    ).toBe(false);
    expect(
      hasEnvSetupScriptAllowance(db, { ...sighting, scriptSha256: SHA_B }),
    ).toBe(false);
  });

  it("keeps one unanswered question per checkout, the newest", () => {
    const { db, project, sighting } = setup();
    recordEnvSetupScriptQuestion(db, noopNotifier, sighting);
    recordEnvSetupScriptQuestion(db, noopNotifier, {
      ...sighting,
      scriptSha256: SHA_B,
      scriptByteLength: 200,
    });

    // The question is "this repository's script wants to run", and the bytes it
    // wants to run are whatever the checkout holds now — so an hourly schedule
    // against a script an agent keeps editing leaves one row, not one per run.
    expect(listEnvSetupScriptConsents(db, project.id)).toEqual([
      expect.objectContaining({ status: "asked", scriptSha256: SHA_B }),
    ]);
  });

  it("does not let a question overwrite an allow", () => {
    const { db, project, sighting } = setup();
    recordEnvSetupScriptAllowance(db, noopNotifier, sighting);
    recordEnvSetupScriptQuestion(db, noopNotifier, sighting);

    expect(hasEnvSetupScriptAllowance(db, sighting)).toBe(true);
    expect(listEnvSetupScriptConsents(db, project.id)).toEqual([
      expect.objectContaining({ status: "allowed" }),
    ]);
  });

  it("drops a question a decline answered, and leaves an allow standing", () => {
    const { db, project, sighting } = setup();
    recordEnvSetupScriptQuestion(db, noopNotifier, {
      ...sighting,
      scriptSha256: SHA_B,
    });
    recordEnvSetupScriptAllowance(db, noopNotifier, sighting);

    forgetEnvSetupScriptQuestion(db, noopNotifier, {
      ...sighting,
      scriptSha256: SHA_B,
    });
    forgetEnvSetupScriptQuestion(db, noopNotifier, sighting);

    expect(listEnvSetupScriptConsents(db, project.id)).toEqual([
      expect.objectContaining({ status: "allowed", scriptSha256: SHA_A }),
    ]);
  });

  it("answers and forgets a row only through the project that holds it", () => {
    const { db, host, project, sighting } = setup();
    recordEnvSetupScriptQuestion(db, noopNotifier, sighting);
    const [question] = listEnvSetupScriptConsents(db, project.id);
    const { project: otherProject } = createProject(db, noopNotifier, {
      name: "other-project",
      source: { type: "local_path", hostId: host.id, path: "/repos/other" },
    });

    expect(
      allowEnvSetupScriptConsent(db, noopNotifier, {
        projectId: otherProject.id,
        consentId: question!.id,
      }),
    ).toBeNull();
    expect(
      deleteEnvSetupScriptConsent(db, noopNotifier, {
        projectId: otherProject.id,
        consentId: question!.id,
      }),
    ).toBe(false);

    expect(
      allowEnvSetupScriptConsent(db, noopNotifier, {
        projectId: project.id,
        consentId: question!.id,
      }),
    ).toMatchObject({ status: "allowed" });
    expect(hasEnvSetupScriptAllowance(db, sighting)).toBe(true);
    expect(
      deleteEnvSetupScriptConsent(db, noopNotifier, {
        projectId: project.id,
        consentId: question!.id,
      }),
    ).toBe(true);
    expect(listEnvSetupScriptConsents(db, project.id)).toEqual([]);
  });
});
