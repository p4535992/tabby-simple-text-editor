import { Injectable, NgModule } from '@angular/core'
import { AppService } from 'tabby-core'

const MAX_FILE_SIZE = 8 * 1024 * 1024

const BLOCKED_EXTENSIONS = new Set([
  'exe', 'dll', 'com', 'msi', 'sys', 'scr',
  'so', 'dylib', 'a', 'o', 'obj', 'lib',
  'bin', 'dat', 'iso', 'img', 'dmg',
  'zip', '7z', 'rar', 'tar', 'gz', 'bz2', 'xz', 'zst',
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'tiff',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'mp3', 'wav', 'flac', 'ogg', 'mp4', 'mkv', 'avi', 'mov', 'webm',
  'woff', 'woff2', 'ttf', 'otf',
  'class', 'jar', 'war', 'ear', 'pyc', 'pyo', 'wasm',
  'sqlite', 'sqlite3', 'db', 'mdb', 'accdb',
  'apk', 'ipa', 'deb', 'rpm'
])

const TEXT_EXTENSIONS = new Set([
  'txt', 'text', 'log', 'md', 'markdown', 'rst',
  'conf', 'config', 'cfg', 'ini', 'properties', 'env',
  'yaml', 'yml', 'toml', 'json', 'jsonc', 'xml', 'csv', 'tsv',
  'html', 'htm', 'css', 'scss', 'sass', 'less',
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx',
  'py', 'rb', 'php', 'pl', 'pm', 'lua', 'r',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
  'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh',
  'cs', 'java', 'kt', 'kts', 'go', 'rs', 'swift',
  'sql', 'graphql', 'gql', 'proto',
  'dockerfile', 'makefile', 'gradle',
  'service', 'socket', 'timer', 'mount', 'target',
  'gitignore', 'gitattributes', 'editorconfig'
])

type SftpLike = {
  readFile: (...args: any[]) => any
  writeFile: (...args: any[]) => any
  stat?: (...args: any[]) => any
}

type RemoteStat = {
  size?: number
  mtime?: number | Date
  modifyTime?: number
}

interface OpenedFile {
  path: string
  content: string
  stat: RemoteStat | null
}

@Injectable()
export class SimpleTextEditorService {
  private overlay: HTMLDivElement | null = null
  private launcher: HTMLButtonElement | null = null
  private textarea: HTMLTextAreaElement | null = null
  private status: HTMLDivElement | null = null
  private title: HTMLDivElement | null = null

  private remotePath = ''
  private originalText = ''
  private dirty = false
  private markAnchor: number | null = null
  private movingText: string | null = null
  private lastSearch = ''
  private initialStat: RemoteStat | null = null
  private sftp: SftpLike | null = null
  private globalKeyHandler: ((event: KeyboardEvent) => void) | null = null

  constructor (private readonly app: AppService) {}

  activate (): void {
    if (this.globalKeyHandler) {
      return
    }

    this.globalKeyHandler = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.altKey && event.key.toLowerCase() === 'e') {
        event.preventDefault()
        void this.openPrompt()
      }
    }

    window.addEventListener('keydown', this.globalKeyHandler, true)
    this.installLauncher()
  }

  private installLauncher (): void {
    if (document.getElementById('tabby-simple-text-editor-launcher')) {
      return
    }

    const button = document.createElement('button')
    button.id = 'tabby-simple-text-editor-launcher'
    button.textContent = 'TXT'
    button.title = 'Simple Text Editor — Ctrl+Alt+E'
    button.style.cssText = [
      'position:fixed',
      'right:14px',
      'bottom:14px',
      'z-index:2147483000',
      'height:30px',
      'min-width:42px',
      'padding:0 9px',
      'border:1px solid rgba(255,255,255,.22)',
      'border-radius:5px',
      'background:#20242b',
      'color:#e6e6e6',
      'font:600 11px/1 system-ui,sans-serif',
      'box-shadow:0 2px 10px rgba(0,0,0,.25)',
      'cursor:pointer',
      'opacity:.82'
    ].join(';')
    button.addEventListener('mouseenter', () => { button.style.opacity = '1' })
    button.addEventListener('mouseleave', () => { button.style.opacity = '.82' })
    button.addEventListener('click', () => void this.openPrompt())

    document.body.appendChild(button)
    this.launcher = button
  }

  async openPrompt (): Promise<void> {
    if (this.overlay) {
      this.textarea?.focus()
      return
    }

    const suggested = this.remotePath || '/etc/hosts'
    const path = window.prompt('Remote text file to edit:', suggested)
    if (!path) {
      return
    }

    try {
      const opened = await this.loadRemoteFile(path.trim())
      this.openEditor(opened)
    } catch (error) {
      window.alert('Simple Text Editor: ' + this.errorMessage(error))
    }
  }

  private async loadRemoteFile (path: string): Promise<OpenedFile> {
    this.assertPathAllowed(path)

    const sftp = await this.resolveSftpClient()
    const stat = await this.tryStat(sftp, path)

    if (typeof stat?.size === 'number' && stat.size > MAX_FILE_SIZE) {
      throw new Error(
        'File too large (' + this.formatBytes(stat.size) + '). ' +
        'The editor limit is ' + this.formatBytes(MAX_FILE_SIZE) + '.'
      )
    }

    const raw = await this.callFsMethod(sftp, 'readFile', [path])
    const buffer = this.asBuffer(raw)

    if (buffer.length > MAX_FILE_SIZE) {
      throw new Error(
        'File too large (' + this.formatBytes(buffer.length) + '). ' +
        'The editor limit is ' + this.formatBytes(MAX_FILE_SIZE) + '.'
      )
    }

    const binaryReason = this.detectBinary(buffer)
    if (binaryReason) {
      throw new Error('Refusing to open binary/non-text file: ' + binaryReason)
    }

    const content = buffer.toString('utf8')
    this.sftp = sftp

    return { path, content, stat }
  }

  private assertPathAllowed (path: string): void {
    if (!path || path.includes('\0')) {
      throw new Error('Invalid path.')
    }

    const name = path.split('/').pop()?.toLowerCase() ?? ''
    const dot = name.lastIndexOf('.')
    const extension = dot > 0 ? name.slice(dot + 1) : name

    if (BLOCKED_EXTENSIONS.has(extension)) {
      throw new Error('Blocked file type: .' + extension)
    }

    // Known text extensions are accepted immediately. Unknown/extensionless files
    // still go through content sniffing, so files such as /etc/hosts remain usable.
    void TEXT_EXTENSIONS.has(extension)
  }

  private detectBinary (buffer: Buffer): string | null {
    if (buffer.length === 0) {
      return null
    }

    const prefix = buffer.subarray(0, Math.min(buffer.length, 512))

    if (prefix.length >= 2 && prefix[0] === 0x4d && prefix[1] === 0x5a) {
      return 'Windows PE/MZ executable signature detected'
    }
    if (prefix.length >= 4 &&
        prefix[0] === 0x7f && prefix[1] === 0x45 &&
        prefix[2] === 0x4c && prefix[3] === 0x46) {
      return 'ELF executable/binary signature detected'
    }
    if (prefix.length >= 4 &&
        prefix[0] === 0x50 && prefix[1] === 0x4b &&
        (prefix[2] === 0x03 || prefix[2] === 0x05 || prefix[2] === 0x07)) {
      return 'ZIP/container signature detected'
    }
    if (prefix.length >= 5 && prefix.subarray(0, 5).toString('ascii') === '%PDF-') {
      return 'PDF signature detected'
    }
    if (prefix.length >= 8 &&
        prefix[0] === 0x89 && prefix[1] === 0x50 &&
        prefix[2] === 0x4e && prefix[3] === 0x47) {
      return 'PNG image signature detected'
    }
    if (prefix.length >= 3 &&
        prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff) {
      return 'JPEG image signature detected'
    }

    let nulCount = 0
    let suspiciousControls = 0
    for (const byte of prefix) {
      if (byte === 0) {
        nulCount++
      } else if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) {
        suspiciousControls++
      }
    }

    if (nulCount > 0) {
      return 'NUL bytes detected'
    }

    if (suspiciousControls / prefix.length > 0.08) {
      return 'too many non-text control bytes'
    }

    const decoded = buffer.toString('utf8')
    const replacements = (decoded.match(/\uFFFD/g) ?? []).length
    if (decoded.length > 0 && replacements / decoded.length > 0.01) {
      return 'content is not valid UTF-8 text'
    }

    return null
  }

  private openEditor (file: OpenedFile): void {
    this.remotePath = file.path
    this.originalText = file.content
    this.dirty = false
    this.markAnchor = null
    this.movingText = null
    this.initialStat = file.stat

    const overlay = document.createElement('div')
    overlay.id = 'tabby-simple-text-editor-overlay'
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:2147483600',
      'display:flex',
      'flex-direction:column',
      'background:#12151a',
      'color:#e6e6e6',
      'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace'
    ].join(';')

    const top = document.createElement('div')
    top.style.cssText = [
      'height:34px',
      'display:flex',
      'align-items:center',
      'padding:0 10px',
      'border-bottom:1px solid #30353d',
      'background:#1b1f25',
      'font-size:12px'
    ].join(';')

    const title = document.createElement('div')
    title.style.cssText = 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'
    top.appendChild(title)

    const close = document.createElement('button')
    close.textContent = '×'
    close.title = 'Close (F10)'
    close.style.cssText = this.smallButtonCss()
    close.addEventListener('click', () => void this.closeEditor())
    top.appendChild(close)

    const textarea = document.createElement('textarea')
    textarea.spellcheck = false
    textarea.value = file.content
    textarea.wrap = 'off'
    textarea.style.cssText = [
      'flex:1',
      'width:100%',
      'resize:none',
      'border:0',
      'outline:0',
      'padding:10px 12px',
      'box-sizing:border-box',
      'background:#12151a',
      'color:#e7e7e7',
      'caret-color:#ffffff',
      'font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
      'tab-size:4',
      'white-space:pre'
    ].join(';')

    const status = document.createElement('div')
    status.style.cssText = [
      'min-height:24px',
      'display:flex',
      'align-items:center',
      'padding:0 10px',
      'border-top:1px solid #30353d',
      'background:#1b1f25',
      'font-size:11px',
      'white-space:nowrap',
      'overflow:hidden'
    ].join(';')

    const functionBar = document.createElement('div')
    functionBar.style.cssText = [
      'min-height:32px',
      'display:flex',
      'align-items:stretch',
      'border-top:1px solid #30353d',
      'background:#0f1115',
      'overflow-x:auto'
    ].join(';')

    const actions: Array<[string, string, () => void | Promise<void>]> = [
      ['F1', 'Help', () => this.showHelp()],
      ['F2', 'Save', () => this.save()],
      ['F3', 'Mark', () => this.toggleMark()],
      ['F4', 'Replace', () => this.replace()],
      ['F5', 'Copy', () => this.copySelection()],
      ['F6', 'Move', () => this.moveSelection()],
      ['F7', 'Find', () => this.find()],
      ['F8', 'Delete', () => this.deleteSelectionOrLine()],
      ['F10', 'Quit', () => this.closeEditor()]
    ]

    for (const [key, label, action] of actions) {
      const button = document.createElement('button')
      button.innerHTML = '<span style="opacity:.65;margin-right:4px">' + key + '</span>' + label
      button.style.cssText = [
        'border:0',
        'border-right:1px solid #30353d',
        'padding:0 10px',
        'background:#171a1f',
        'color:#e6e6e6',
        'font:11px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace',
        'cursor:pointer',
        'white-space:nowrap'
      ].join(';')
      button.addEventListener('click', () => void action())
      functionBar.appendChild(button)
    }

    textarea.addEventListener('input', () => {
      this.dirty = textarea.value !== this.originalText
      this.updateStatus()
    })
    textarea.addEventListener('click', () => this.updateStatus())
    textarea.addEventListener('keyup', () => this.updateStatus())
    textarea.addEventListener('scroll', () => this.updateStatus())
    textarea.addEventListener('keydown', event => this.handleEditorKeydown(event))

    overlay.append(top, textarea, status, functionBar)
    document.body.appendChild(overlay)

    this.overlay = overlay
    this.textarea = textarea
    this.status = status
    this.title = title

    if (this.launcher) {
      this.launcher.style.display = 'none'
    }

    this.updateStatus()
    textarea.focus()
  }

  private handleEditorKeydown (event: KeyboardEvent): void {
    const key = event.key.toUpperCase()

    const commands: Record<string, () => void | Promise<void>> = {
      F1: () => this.showHelp(),
      F2: () => this.save(),
      F3: () => this.toggleMark(),
      F4: () => this.replace(),
      F5: () => this.copySelection(),
      F6: () => this.moveSelection(),
      F7: () => this.find(),
      F8: () => this.deleteSelectionOrLine(),
      F10: () => this.closeEditor()
    }

    if (commands[key]) {
      event.preventDefault()
      event.stopPropagation()
      void commands[key]()
      return
    }

    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      const lower = event.key.toLowerCase()
      if (lower === 's') {
        event.preventDefault()
        void this.save()
        return
      }
      if (lower === 'f') {
        event.preventDefault()
        this.find()
        return
      }
      if (lower === 'h') {
        event.preventDefault()
        this.replace()
        return
      }
    }

    if (this.markAnchor !== null &&
        ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
      const anchor = this.markAnchor
      window.requestAnimationFrame(() => {
        if (!this.textarea || this.markAnchor === null) {
          return
        }
        const caret = this.textarea.selectionDirection === 'backward'
          ? this.textarea.selectionStart
          : this.textarea.selectionEnd
        this.textarea.setSelectionRange(
          Math.min(anchor, caret),
          Math.max(anchor, caret),
          caret < anchor ? 'backward' : 'forward'
        )
        this.updateStatus()
      })
    }
  }

  private async save (): Promise<void> {
    if (!this.textarea || !this.sftp) {
      return
    }

    try {
      if (this.initialStat) {
        const latest = await this.tryStat(this.sftp, this.remotePath)
        if (latest && this.statChanged(this.initialStat, latest)) {
          const overwrite = window.confirm(
            'The remote file appears to have changed since it was opened.\n\n' +
            'Overwrite the remote version anyway?'
          )
          if (!overwrite) {
            this.setTransientStatus('Save cancelled: remote file changed.')
            return
          }
        }
      }

      const data = Buffer.from(this.textarea.value, 'utf8')
      await this.callFsMethod(this.sftp, 'writeFile', [this.remotePath, data])

      this.originalText = this.textarea.value
      this.dirty = false
      this.initialStat = await this.tryStat(this.sftp, this.remotePath)
      this.setTransientStatus('Saved ' + this.remotePath)
    } catch (error) {
      window.alert('Save failed: ' + this.errorMessage(error))
    }

    this.updateStatus()
  }

  private toggleMark (): void {
    const textarea = this.textarea
    if (!textarea) {
      return
    }

    if (this.markAnchor === null) {
      this.markAnchor = textarea.selectionStart
      textarea.setSelectionRange(this.markAnchor, this.markAnchor)
      this.setTransientStatus('Mark ON — move the cursor, then press F3 again to finish.')
    } else {
      this.markAnchor = null
      this.setTransientStatus('Mark OFF.')
    }

    textarea.focus()
    this.updateStatus()
  }

  private replace (): void {
    const textarea = this.textarea
    if (!textarea) {
      return
    }

    const find = window.prompt('Find:', this.lastSearch)
    if (!find) {
      return
    }

    const replacement = window.prompt('Replace with:', '')
    if (replacement === null) {
      return
    }

    this.lastSearch = find

    if (window.confirm('Replace all occurrences?\nChoose Cancel to replace only the next occurrence.')) {
      const next = textarea.value.split(find).join(replacement)
      if (next !== textarea.value) {
        textarea.value = next
        this.onProgrammaticEdit()
        this.setTransientStatus('Replaced all occurrences.')
      } else {
        this.setTransientStatus('Text not found.')
      }
      return
    }

    const from = textarea.selectionEnd
    let index = textarea.value.indexOf(find, from)
    if (index < 0 && from > 0) {
      index = textarea.value.indexOf(find, 0)
    }
    if (index < 0) {
      this.setTransientStatus('Text not found.')
      return
    }

    textarea.setRangeText(replacement, index, index + find.length, 'select')
    this.onProgrammaticEdit()
    textarea.focus()
  }

  private async copySelection (): Promise<void> {
    const textarea = this.textarea
    if (!textarea) {
      return
    }

    const text = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)
    if (!text) {
      this.setTransientStatus('Nothing selected.')
      return
    }

    try {
      await navigator.clipboard.writeText(text)
      this.setTransientStatus('Selection copied.')
    } catch {
      textarea.focus()
      document.execCommand('copy')
      this.setTransientStatus('Selection copied.')
    }
  }

  private moveSelection (): void {
    const textarea = this.textarea
    if (!textarea) {
      return
    }

    if (this.movingText !== null) {
      const caret = textarea.selectionStart
      textarea.setRangeText(this.movingText, caret, caret, 'end')
      this.movingText = null
      this.onProgrammaticEdit()
      this.setTransientStatus('Moved block inserted.')
      textarea.focus()
      return
    }

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    if (start === end) {
      this.setTransientStatus('Select a block first, then press F6.')
      return
    }

    this.movingText = textarea.value.slice(start, end)
    textarea.setRangeText('', start, end, 'start')
    this.onProgrammaticEdit()
    this.setTransientStatus('Block picked up — place cursor and press F6 again.')
    textarea.focus()
  }

  private find (): void {
    const textarea = this.textarea
    if (!textarea) {
      return
    }

    const query = window.prompt('Find:', this.lastSearch)
    if (!query) {
      return
    }

    this.lastSearch = query
    const from = textarea.selectionEnd
    let index = textarea.value.indexOf(query, from)

    if (index < 0 && from > 0) {
      index = textarea.value.indexOf(query, 0)
    }

    if (index < 0) {
      this.setTransientStatus('Text not found.')
      return
    }

    textarea.focus()
    textarea.setSelectionRange(index, index + query.length)
    this.updateStatus()
  }

  private deleteSelectionOrLine (): void {
    const textarea = this.textarea
    if (!textarea) {
      return
    }

    const start = textarea.selectionStart
    const end = textarea.selectionEnd

    if (start !== end) {
      textarea.setRangeText('', start, end, 'start')
      this.onProgrammaticEdit()
      textarea.focus()
      return
    }

    const value = textarea.value
    const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1
    let lineEnd = value.indexOf('\n', start)
    if (lineEnd < 0) {
      lineEnd = value.length
    } else {
      lineEnd += 1
    }

    textarea.setRangeText('', lineStart, lineEnd, 'start')
    this.onProgrammaticEdit()
    textarea.focus()
  }

  private showHelp (): void {
    window.alert(
      'Simple Text Editor\n\n' +
      'Ctrl+Alt+E  Open remote file\n' +
      'F2          Save\n' +
      'F3          Start/stop mark\n' +
      'F4          Replace\n' +
      'F5          Copy selection\n' +
      'F6          Move selected block\n' +
      'F7          Find\n' +
      'F8          Delete selection/current line\n' +
      'F10         Close\n\n' +
      'Also supported: Ctrl+S, Ctrl+F, Ctrl+H and native undo/redo.'
    )
  }

  private async closeEditor (): Promise<void> {
    if (!this.overlay) {
      return
    }

    if (this.dirty) {
      const close = window.confirm('The file has unsaved changes. Close without saving?')
      if (!close) {
        return
      }
    }

    this.overlay.remove()
    this.overlay = null
    this.textarea = null
    this.status = null
    this.title = null
    this.sftp = null
    this.markAnchor = null
    this.movingText = null

    if (this.launcher) {
      this.launcher.style.display = ''
    }
  }

  private onProgrammaticEdit (): void {
    if (!this.textarea) {
      return
    }

    this.dirty = this.textarea.value !== this.originalText
    this.updateStatus()
  }

  private updateStatus (): void {
    if (!this.textarea || !this.status || !this.title) {
      return
    }

    const pos = this.textarea.selectionEnd
    const before = this.textarea.value.slice(0, pos)
    const lines = before.split('\n')
    const line = lines.length
    const column = (lines[lines.length - 1]?.length ?? 0) + 1
    const selection = Math.abs(this.textarea.selectionEnd - this.textarea.selectionStart)

    this.title.textContent =
      (this.dirty ? '* ' : '') + this.remotePath + ' — Simple Text Editor'

    this.status.textContent = [
      'Ln ' + line,
      'Col ' + column,
      selection ? 'Sel ' + selection : '',
      this.markAnchor !== null ? 'MARK' : '',
      this.movingText !== null ? 'MOVE' : '',
      'UTF-8',
      'SSH/SFTP',
      this.dirty ? 'modified' : 'saved'
    ].filter(Boolean).join('   ')
  }

  private setTransientStatus (message: string): void {
    if (!this.status) {
      return
    }

    this.status.textContent = message
    window.setTimeout(() => this.updateStatus(), 1800)
  }

  private async resolveSftpClient (): Promise<SftpLike> {
    const tab: any = (this.app as any).activeTab
    if (!tab) {
      throw new Error('No active Tabby tab. Open an SSH session first.')
    }

    const candidates = [
      tab.sftp,
      tab.session?.sftp,
      tab.session?.sftpClient,
      tab.session?.client,
      tab.sshSession?.sftp,
      tab.sshSession?.client,
      tab.client,
      tab.connection,
      tab.session,
      tab.sshSession
    ].filter(Boolean)

    for (const candidate of candidates) {
      if (this.looksLikeSftp(candidate)) {
        return candidate as SftpLike
      }
    }

    for (const candidate of candidates) {
      for (const methodName of ['sftp', 'getSftp', 'getSFTP', 'openSftp', 'openSFTP']) {
        if (typeof candidate?.[methodName] !== 'function') {
          continue
        }

        try {
          const result = await this.callFactory(candidate, methodName)
          if (this.looksLikeSftp(result)) {
            return result as SftpLike
          }
        } catch {
          // Try the next runtime shape. Tabby SSH internals differ between versions.
        }
      }
    }

    throw new Error(
      'The active tab does not expose an SFTP client that this MVP can use. ' +
      'Make sure the active tab is a connected SSH session. ' +
      'If this persists, send me the Tabby version and I can adapt the transport binding.'
    )
  }

  private looksLikeSftp (value: any): value is SftpLike {
    return Boolean(
      value &&
      typeof value.readFile === 'function' &&
      typeof value.writeFile === 'function'
    )
  }

  private async callFactory (target: any, methodName: string): Promise<any> {
    const method = target[methodName].bind(target)

    return await new Promise((resolve, reject) => {
      let settled = false

      const callback = (error: any, value: any) => {
        if (settled) {
          return
        }
        settled = true
        if (error) {
          reject(error)
        } else {
          resolve(value)
        }
      }

      try {
        const result = method(callback)
        if (result && typeof result.then === 'function') {
          result.then((value: any) => {
            if (!settled) {
              settled = true
              resolve(value)
            }
          }, (error: any) => {
            if (!settled) {
              settled = true
              reject(error)
            }
          })
        } else if (result && this.looksLikeSftp(result) && !settled) {
          settled = true
          resolve(result)
        }
      } catch (error) {
        reject(error)
      }
    })
  }

  private async callFsMethod (target: any, methodName: string, args: any[]): Promise<any> {
    const method = target?.[methodName]
    if (typeof method !== 'function') {
      throw new Error('SFTP client does not support ' + methodName + '().')
    }

    return await new Promise((resolve, reject) => {
      let settled = false
      const callback = (error: any, value: any) => {
        if (settled) {
          return
        }
        settled = true
        if (error) {
          reject(error)
        } else {
          resolve(value)
        }
      }

      try {
        const result = method.apply(target, [...args, callback])
        if (result && typeof result.then === 'function') {
          result.then((value: any) => {
            if (!settled) {
              settled = true
              resolve(value)
            }
          }, (error: any) => {
            if (!settled) {
              settled = true
              reject(error)
            }
          })
        }
      } catch (error) {
        reject(error)
      }
    })
  }

  private async tryStat (sftp: SftpLike, path: string): Promise<RemoteStat | null> {
    if (typeof sftp.stat !== 'function') {
      return null
    }

    try {
      const stat = await this.callFsMethod(sftp, 'stat', [path])
      return stat ?? null
    } catch {
      return null
    }
  }

  private statChanged (before: RemoteStat, after: RemoteStat): boolean {
    const beforeSize = before.size
    const afterSize = after.size
    const beforeTime = this.extractMtime(before)
    const afterTime = this.extractMtime(after)

    if (typeof beforeSize === 'number' &&
        typeof afterSize === 'number' &&
        beforeSize !== afterSize) {
      return true
    }

    if (beforeTime !== null && afterTime !== null && beforeTime !== afterTime) {
      return true
    }

    return false
  }

  private extractMtime (stat: RemoteStat): number | null {
    if (stat.mtime instanceof Date) {
      return stat.mtime.getTime()
    }
    if (typeof stat.mtime === 'number') {
      return stat.mtime
    }
    if (typeof stat.modifyTime === 'number') {
      return stat.modifyTime
    }
    return null
  }

  private asBuffer (value: any): Buffer {
    if (Buffer.isBuffer(value)) {
      return value
    }
    if (value instanceof Uint8Array) {
      return Buffer.from(value)
    }
    if (typeof value === 'string') {
      return Buffer.from(value, 'utf8')
    }
    if (value?.data && Array.isArray(value.data)) {
      return Buffer.from(value.data)
    }
    throw new Error('Unsupported SFTP read result.')
  }

  private errorMessage (error: unknown): string {
    if (error instanceof Error) {
      return error.message
    }
    return String(error)
  }

  private formatBytes (bytes: number): string {
    if (bytes < 1024) {
      return bytes + ' B'
    }
    if (bytes < 1024 * 1024) {
      return (bytes / 1024).toFixed(1) + ' KiB'
    }
    return (bytes / (1024 * 1024)).toFixed(1) + ' MiB'
  }

  private smallButtonCss (): string {
    return [
      'width:28px',
      'height:26px',
      'border:1px solid #3c424c',
      'border-radius:4px',
      'background:#252a32',
      'color:#e7e7e7',
      'font:18px/1 sans-serif',
      'cursor:pointer'
    ].join(';')
  }
}

@NgModule({
  providers: [SimpleTextEditorService]
})
export default class SimpleTextEditorPluginModule {
  constructor (editor: SimpleTextEditorService) {
    editor.activate()
  }
}
