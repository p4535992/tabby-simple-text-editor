# v0.1.0-alpha.1 — test prerelease

First installable test candidate for Tabby Simple Text Editor.

## Included

- Full-screen text editor inside Tabby.
- Opens a remote path from the active SSH session.
- SFTP read/write adapter with runtime probing for common Tabby SSH client shapes.
- Midnight Commander-inspired shortcuts:
  - F1 Help
  - F2 Save
  - F3 Mark
  - F4 Replace
  - F5 Copy
  - F6 Move
  - F7 Find
  - F8 Delete
  - F10 Quit
- Ctrl+Alt+E launcher and small TXT button.
- Ctrl+S / Ctrl+F / Ctrl+H aliases.
- UTF-8 text validation.
- Binary/executable protection based on extension and content signatures.
- Protection against common PE/MZ, ELF, ZIP/container, PDF, PNG/JPEG and NUL-containing files.
- Remote-change warning before overwrite.
- Current normal-editor size limit: 8 MiB.

## Not yet included in this alpha

The large-log architecture discussed for the next iteration is not yet part of alpha.1:

- chunked/range reading of multi-GB logs
- virtualized line rendering
- sparse line index
- streaming search
- follow/tail mode
- F11 whitespace visualization
- F12 tab visualization/configuration

These are intended for the next test iteration after confirming the basic Tabby/SFTP integration.

## Suggested smoke test

1. Connect to a test server in Tabby over SSH.
2. Create a harmless remote file:
   ```sh
   printf 'hello\nworld\n' > /tmp/tabby-editor-test.txt
   ```
3. Open the plugin with Ctrl+Alt+E.
4. Enter:
   ```
   /tmp/tabby-editor-test.txt
   ```
5. Edit the file and save with F2.
6. Re-open/check the file from the shell.
7. Test F3/F5/F7/F8/F10.
8. Try opening a known binary such as an executable or image and confirm it is rejected.

## Important test feedback

If opening a remote file fails, record:

- Tabby version
- OS
- exact plugin error message
- whether the active session is SSH
- whether Tabby's own SFTP browser works in that same connection
