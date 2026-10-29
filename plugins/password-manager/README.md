# Password manager

**Password manager** is preinstalled and enabled in Patcher. Disable it in
Settings → Plugins if you prefer another manager; that choice survives restarts
and updates. Builtin plugins cannot be uninstalled from Settings. Open an HTTPS
login page and select
**Use here** in its side panel to grant that exact origin. Reload the page if you
want form hints on an already open tab.

Enter the username and password in the site's form, choose a new account label
and select **Save new login**. Review the request in browser chrome, then confirm
the native dialog. The first Save seals the chosen policy: Require Touch ID or
Confirm every action. Each later action requires fresh approval.

Choose a saved account to **Fill**, **Update from form** or **Delete**. Fill does
not submit the form. Update captures the current form after approval; it never
overwrites an account automatically. Hints do not establish login success. Save
works while the live form remains available; after navigation, return to the
login form and enter the credentials again.

The MVP accepts a single visible enabled password field and at most one
username/email field in a main-frame form with a same-origin action. Ambiguous,
hidden, readonly, new-password and cross-origin forms are refused. Use manual
entry for unsupported forms.

The plugin receives metadata and statuses only. Passwords stay in the protected
core vault until approved capture/fill. Disable the plugin to stop its actions;
encrypted records remain. A removal persisted by an earlier build is respected;
reinstallation needs fresh site grants and the same source identity. Delete each
account explicitly to remove its record.
There is no reveal, export, import, clipboard, sync or automatic fill/save.
