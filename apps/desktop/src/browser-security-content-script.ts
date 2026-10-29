// Runs in the page's world, with no Electron imports, IPC or privileged bridge.
import { installWebAuthnCompatibility } from "./browser-webauthn-policy.js";

installWebAuthnCompatibility();
