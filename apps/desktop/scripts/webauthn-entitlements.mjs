/** Only the signed main app needs access to its device-bound WebAuthn keys. */
export function createWebAuthnEntitlements(source, teamId, bundleId) {
  if (
    !/^[A-Z0-9]{10}$/u.test(teamId) ||
    !["app.patcher.desktop", "app.patcher.desktop.nightly"].includes(bundleId)
  ) {
    throw new Error("Invalid WebAuthn signing Team ID or bundle ID.");
  }
  if (
    source.includes("keychain-access-groups") ||
    !source.includes("</dict>")
  ) {
    throw new Error("Unexpected base WebAuthn entitlements.");
  }
  return source.replace(
    "</dict>",
    `<key>keychain-access-groups</key>\n    <array><string>${teamId}.${bundleId}.webauthn</string></array>\n  </dict>`,
  );
}
