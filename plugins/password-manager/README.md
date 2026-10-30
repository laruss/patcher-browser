# Password Manager

Password manager is preinstalled and enabled. It works on HTTP and HTTPS sites,
including pages operated by an agent. Disable it in **Extensions** to stop
saving and filling; encrypted records are retained and the choice survives updates.

Open **Patcher → Password Manager** in the macOS application menu. The separate
page provides search, website/account details, manual addition, editing and deletion.
Passwords are masked. Showing, editing or deleting a saved password requires a
fresh system authentication with Touch ID or the macOS login password.

A single saved login fills automatically. With multiple logins, focus the username
field to choose an account. Filled fields remain editable and can be cleared.
The browser does not submit the form. After a submitted form disappears or a
successful navigation leaves the login form, a compact Save/Update proposal opens
over the page. Saving and accepting a website update do not require OS authentication.

Old records keep their original protection until one system confirmation migrates
them. Migration preserves every record, password and identifier. It is offered on
first use of an old record and can also be started on the manager page.

Core owns form observation, the menu and the manager page. The plugin contributes
no toolbar key or site panel. It never receives plaintext passwords. Passwords are
encrypted with the existing OS-wrapped vault key; pending form captures are bounded
in main-process memory and expire or are discarded on tab close, lock or disable.
