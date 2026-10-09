import { installCredentialRelease } from "./credential-release-preload.js";
import { installSecureKeyboardReporting } from "./secure-keyboard-preload.js";

installSecureKeyboardReporting(true);

installCredentialRelease();
