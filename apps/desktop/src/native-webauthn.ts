import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { app, systemPreferences } from "electron";

/** Called only after codesign has verified the effective app signature. */
export function verifiedWebAuthnGroup(
  signature: string,
  entitlements: unknown,
  expectedBundleId: string,
): string | null {
  const identifier = /^Identifier=(.+)$/mu.exec(signature)?.[1];
  const team = /^TeamIdentifier=([A-Z0-9]{10})$/mu.exec(signature)?.[1];
  if (
    !team ||
    identifier !== expectedBundleId ||
    /^Signature=adhoc$/mu.test(signature) ||
    !/^Authority=.+$/mu.test(signature) ||
    !entitlements ||
    typeof entitlements !== "object"
  )
    return null;
  const group = `${team}.${identifier}.webauthn`;
  const groups = (entitlements as Record<string, unknown>)[
    "keychain-access-groups"
  ];
  return Array.isArray(groups) && groups.includes(group) ? group : null;
}

function command(
  file: string,
  args: string[],
  input?: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolveResult, reject) => {
    const child = execFile(
      file,
      args,
      { encoding: "utf8", timeout: 5_000, maxBuffer: 256 * 1024 },
      (error, stdout, stderr) => {
        if (error) reject(error);
        else resolveResult({ stdout, stderr });
      },
    );
    child.stdin?.on("error", reject);
    child.stdin?.end(input);
  });
}

/** No environment variable or source plist can stand in for an effective signature. */
export async function configureNativeWebAuthn(
  expectedBundleId: string,
): Promise<boolean> {
  if (process.platform !== "darwin" || !app.isPackaged) return false;
  let group: string | null;
  try {
    if (!systemPreferences.canPromptTouchID()) return false;
    const bundle = resolve(dirname(process.execPath), "..", "..");
    const signature = await command("/usr/bin/codesign", [
      "--display",
      "--verbose=4",
      bundle,
    ]);
    // Avoid hashing the bundle for builds that cannot use a Team access group.
    if (
      /^Signature=adhoc$/mu.test(signature.stderr) ||
      !/^TeamIdentifier=[A-Z0-9]{10}$/mu.test(signature.stderr)
    )
      return false;
    group = verifiedWebAuthnGroup(
      signature.stderr,
      await readEffectiveWebAuthnEntitlements(bundle),
      expectedBundleId,
    );
    if (!group) return false;
    // Reading signature metadata alone never authorizes native credentials.
    await command("/usr/bin/codesign", [
      "--verify",
      "--strict",
      "-R=anchor apple generic",
      bundle,
    ]);
  } catch (error) {
    console.warn(
      "Native Touch ID passkey signature check failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return false;
  }
  try {
    app.configureWebAuthn({
      touchID: { keychainAccessGroup: group, promptReason: "sign in to $1" },
    });
    return true;
  } catch (error) {
    // Unsupported/incorrectly signed builds keep the bounded native fallback.
    console.warn(
      "Native Touch ID passkey configuration failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return false;
  }
}

export async function readEffectiveWebAuthnEntitlements(
  bundle: string,
): Promise<unknown> {
  const effective = await command("/usr/bin/codesign", [
    "--display",
    "--entitlements",
    "-",
    "--xml",
    bundle,
  ]);
  const parsed = await command(
    "/usr/bin/plutil",
    ["-convert", "json", "-o", "-", "-"],
    effective.stdout,
  );
  return JSON.parse(parsed.stdout);
}
