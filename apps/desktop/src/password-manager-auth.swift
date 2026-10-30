import AppKit
import LocalAuthentication

// Device-owner authentication offers Touch ID and the real macOS account
// password fallback. No password is handled by Electron or this helper.
let application = NSApplication.shared
application.setActivationPolicy(.accessory)
let context = LAContext()
context.localizedCancelTitle = "Cancel"
context.touchIDAuthenticationAllowableReuseDuration = 0
let reason = CommandLine.arguments.dropFirst().first ?? "Manage your saved passwords"
var error: NSError?
guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else { exit(2) }
context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { success, _ in
    DispatchQueue.main.async { exit(success ? 0 : 1) }
}
application.run()
