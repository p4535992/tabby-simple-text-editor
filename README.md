# tabby-simple-text-editor

A small Midnight Commander-style text editor for **Tabby**, focused on editing text files on the currently active SSH session.

This repository currently contains an MVP intended for direct testing.

## What it does

- Opens a remote file from the active Tabby SSH session.
- Reads and writes through an SFTP client exposed by that active session.
- Full-screen editor overlay inside Tabby.
- Midnight Commander-inspired function keys:
  - **F1** help
  - **F2** save
  - **F3** mark/select
  - **F4** replace
  - **F5** copy
  - **F6** move selected block
  - **F7** find
  - **F8** delete selection/current line
  - **F10** close
- Also supports **Ctrl+S**, **Ctrl+F**, **Ctrl+H** and native undo/redo.
- Shows line, column, selection size and modified/saved state.
- Warns before overwriting a file that appears to have changed remotely.

## Opening the editor

1. Connect to a server with an SSH tab in Tabby.
2. Keep that SSH tab active.
3. Press **Ctrl+Alt+E**, or click the small **TXT** button in the lower-right corner.
4. Enter an absolute remote path, for example:

```
/etc/hosts
/etc/nginx/nginx.conf
/home/user/app/.env
```

## Text/binary safety

The plugin is intentionally conservative.

It blocks common non-text extensions before reading them, including:

- executables and libraries: `.exe`, `.dll`, `.so`, `.dylib`, `.class`, `.wasm`
- archives/images/media: `.zip`, `.7z`, `.png`, `.jpg`, `.mp4`, etc.
- office/PDF files
- database files such as `.sqlite` and `.db`
- package/disk images such as `.apk`, `.deb`, `.rpm`, `.iso`, `.dmg`

It also inspects the file contents and rejects files when it finds binary signatures such as:

- Windows PE/MZ
- ELF
- ZIP/container
- PDF
- PNG/JPEG
- NUL bytes
- excessive control bytes
- clearly invalid UTF-8

Unknown extensions and extensionless files are allowed **only when their contents pass the text check**, so files such as `/etc/hosts`, `Dockerfile`, shell scripts, configs and logs can still be edited.

The current maximum file size is **8 MiB**.

## Build

Requirements:

- Node.js
- npm

Then:

```bash
npm install
npm run build
```

The compiled plugin entry point is:

```
dist/index.js
```

To create a local installable package:

```bash
npm pack
```

This produces a file similar to:

```
tabby-simple-text-editor-0.1.0.tgz
```

Install the resulting local package in the Tabby plugins environment, then restart/reload Tabby.

## MVP limitation: Tabby SSH/SFTP binding

The editor itself is self-contained, but Tabby versions can expose the active SSH client using slightly different runtime object shapes.

The MVP probes the active tab for common SFTP/client locations and factories:

- `tab.sftp`
- `tab.session.sftp`
- `tab.session.sftpClient`
- `tab.session.client`
- `tab.sshSession.client`
- `tab.client`
- `tab.connection`
- `sftp()`, `getSftp()`, `getSFTP()`, `openSftp()`, `openSFTP()`

If your Tabby build exposes SFTP differently, the plugin will show a clear error instead of attempting unsafe shell parsing.

If that happens, note the **Tabby version** and the exact error message. The transport adapter is isolated so it can be adjusted without changing the editor UI.

## Current scope

This first version intentionally does not yet include:

- remote directory/file browser
- syntax highlighting
- multiple files/tabs
- non-UTF-8 encodings
- privileged save through `sudo`
- direct integration into a Tabby SFTP file context menu

Those are natural follow-up steps after confirming the SFTP binding on the Tabby version being tested.
