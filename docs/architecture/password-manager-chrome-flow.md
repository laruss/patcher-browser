# Password Manager: browser integration

The UX and action policy follow the user's 2026-10-30 requirements and
[Chrome's password-manager behavior](https://support.google.com/chrome/answer/95606?hl=en).
This supersedes the original manager's manual per-site panel and per-fill approvals.

- The preinstalled plugin is the enable/disable switch. Enabling it adds
  **Patcher → Password Manager** to the macOS application menu. There is no
  per-site toolbar key or side panel. Existing disabled/removal choices survive.
  Menu visibility reads authenticated plugin metadata and follows plugin-change
  events independently of Keychain availability. Credential access still uses
  the owned private pipe. Its 30-second greeting deadline tolerates cold process
  startup and blocking Keychain initialization.
- The separate app tab provides search by website/username, grouped entries,
  masked details, manual addition, editing and deletion. Opening a website card
  uses `LAContext.deviceOwnerAuthentication`: Touch ID or the macOS account login
  password. Approval unlocks all manager entries for a fixed five minutes,
  measured with a monotonic native clock. Opening another card, reveal, copy,
  edit and delete reuse the remaining time and never extend it. Passwords stay
  masked until explicitly revealed; each username and password has a copy icon.
  Native copy does not return plaintext to the renderer. No master password is introduced.
  App blur and closing the page hide revealed passwords while preserving the
  remaining interval. Screen lock, sleep, runtime replacement and disabling the
  plugin reset the interval. Expiry hides revealed values and cancels edits.
  Native actions recheck the trusted foreground manager frame and the deadline
  after asynchronous reads. The optional session API uses a separate IPC channel;
  older shells/SPAs keep their existing per-operation policy.
- One saved login fills automatically; multiple accounts can be selected at the
  username field. Suggestions preserve keyboard focus, support typing and arrow
  keys, and expose only metadata in a closed shadow root. Filled fields remain
  editable and clearing them does not cause another automatic fill.
- Core observes main-frame forms, including dynamic forms, username-first flows,
  current/new-password changes and website password-visibility toggles. Submission
  captures a bounded draft before navigation. A disappearing form or completed
  navigation can offer Save/Update; replacement retry forms discard the draft.
  Same-document submission follows Chromium's successful-AJAX/navigation signals
  and form-disappearance checks; unrelated requests do not have to finish. Saving requires explicit acceptance, not OS auth.
- HTTP and HTTPS are supported with exact-origin matching, including protocol and
  port. Autofill on agent-operated pages is explicitly authorized by the user.

Passwords stay in core. The plugin receives neither plaintext nor a reveal API.
The owned server stores ciphertext in `protected_credentials`; Electron keeps the
existing OS-wrapped vault key and authenticates metadata with the envelope seal.
The new format 2 seals the `system-auth` policy. Format 1 policies retain their
original meaning until one system confirmation migrates all records, preserving
passwords, IDs and account labels. Cancellation changes nothing.

Management calls use new channels and an optional preload API. The owned private
pipe probes an existing method before using the new store method, so older peers
can reject the capability without disconnecting. Existing SDK credential contracts
and the host-daemon protocol remain unchanged.

Drafts expire after 120 seconds and are discarded on lock, disable, close or
runtime replacement. A fill is bound to the current document, origin and exact
input; type, autocomplete, form and username association are rechecked after
asynchronous reads. Newer explicit account choices supersede pending fills.
Filled password nodes remain redacted in AX snapshots after a website reveals
them. The website can read credentials released into its form; this also applies
to permitted site scripts and agent interactions.

`apps/desktop/scripts/smoke-protected-credentials.mjs` runs real Electron with an
isolated temporary profile, real manager UI, native menu/IPC, AES envelopes and a
fixture system-auth adapter. It covers save/update/navigation, SPA failures,
account choice under CSP, editing, clear-field behavior, redaction and disabling.
It also checks entry authentication, independent masked copy actions, approval
reuse, and refusal to copy after locking. Unit tests advance the monotonic clock
across the exact five-minute boundary and expire in-flight reads.
It also delays renderer focus until after authentication completes, covering the
macOS focus-return race. Authenticated reveal/edit replies wait privately in the
preload for foreground focus; background replies are discarded.
Physical system authentication was checked on 2026-10-30 using the packaged native
helper: one approval opened masked test details, then copy and reveal reused
that approval without another system prompt.
This check uses `PATCHER_PASSWORD_QA_REAL_AUTH=1` with
`PATCHER_PASSWORD_QA_AUTH_HELPER` pointing to the packaged helper; it requires a
person to confirm Touch ID or the macOS login password.
The packaged smoke also starts the real launcher/server with fresh and existing
temporary profiles, delaying the first key-backend availability call by 6.5 seconds
to cover the previously broken cold-start handshake.
Signed platform passkeys and phone QR acceptance remain deferred Phase 8 work,
until an official Apple Developer account and signing are available.
