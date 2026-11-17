import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export type ServerSettings = {
  copyUploadedImageToClipboard: boolean
}

const SETTINGS_FILE = ".quick-photo-settings.json"

const DEFAULT_SETTINGS: ServerSettings = {
  copyUploadedImageToClipboard: true,
}

export async function getServerSettings(base = process.cwd()): Promise<ServerSettings> {
  const target = path.join(base, "uploads", SETTINGS_FILE)
  try {
    const raw = await readFile(target, "utf8")
    const parsed = JSON.parse(raw) as Partial<ServerSettings>
    return {
      copyUploadedImageToClipboard:
        typeof parsed.copyUploadedImageToClipboard === "boolean"
          ? parsed.copyUploadedImageToClipboard
          : DEFAULT_SETTINGS.copyUploadedImageToClipboard,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export async function updateServerSettings(
  patch: Partial<ServerSettings>,
  base = process.cwd()
): Promise<ServerSettings> {
  const current = await getServerSettings(base)
  const next: ServerSettings = {
    ...current,
    ...(typeof patch.copyUploadedImageToClipboard === "boolean"
      ? { copyUploadedImageToClipboard: patch.copyUploadedImageToClipboard }
      : {}),
  }
  const dir = path.join(base, "uploads")
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, SETTINGS_FILE), JSON.stringify(next, null, 2))
  return next
}

function resolveWindowsPowerShellPath(): string {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR
  if (systemRoot) {
    const candidate = path.join(
      systemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe"
    )
    if (existsSync(candidate)) return candidate
  }
  return "powershell.exe"
}

function buildWindowsClipboardEncodedCommand(winFilePath: string): string {
  const escapedPath = winFilePath.replace(/'/g, "''")
  const psScript = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Windows.Forms",
    "Add-Type -AssemblyName System.Drawing",
    `$bytes = [System.IO.File]::ReadAllBytes('${escapedPath}')`,
    "$ms = New-Object System.IO.MemoryStream(, $bytes)",
    "$img = [System.Drawing.Image]::FromStream($ms)",
    "$bmp = New-Object System.Drawing.Bitmap($img)",
    "$img.Dispose()",
    "$ms.Dispose()",
    "[System.Windows.Forms.Clipboard]::SetDataObject($bmp, $true, 10, 150)",
    "$bmp.Dispose()",
  ].join("\n")
  return Buffer.from(psScript, "utf16le").toString("base64")
}

async function runWindowsPowerShellClipboard(winFilePath: string, exePath = "powershell.exe") {
  const encoded = buildWindowsClipboardEncodedCommand(winFilePath)
  await execFileAsync(
    exePath,
    ["-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand", encoded],
    {
      timeout: 20000,
      windowsHide: true,
    }
  )
}

function formatExecError(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as {
      stderr?: string
      stdout?: string
      message?: string
      killed?: boolean
      signal?: string
    }
    const detail = (e.stderr || e.stdout || "").trim()
    if (detail) return detail
    if (e.killed) return `命令执行超时或被终止 (${e.signal || "timeout"})`
    if (e.message) return e.message
  }
  return String(err)
}

export async function copyImageFileToSystemClipboard(
  filePath: string,
  mimeType = "image/jpeg"
): Promise<{ copied: boolean; error?: string }> {
  const resolved = path.resolve(filePath)
  try {
    if (process.platform === "win32") {
      await runWindowsPowerShellClipboard(resolved, resolveWindowsPowerShellPath())
      return { copied: true }
    }

    if (process.platform === "darwin") {
      const escaped = resolved.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
      const appleScript = `set the clipboard to (read (POSIX file "${escaped}") as JPEG picture)`
      await execFileAsync("osascript", ["-e", appleScript], { timeout: 10000 })
      return { copied: true }
    }

    if (process.platform === "linux") {
      try {
        const { stdout: wslPath } = await execFileAsync("wslpath", ["-w", resolved], {
          timeout: 3000,
        })
        const winPath = wslPath.trim()
        if (winPath) {
          await runWindowsPowerShellClipboard(winPath, "powershell.exe")
          return { copied: true }
        }
      } catch {
        // Not WSL
      }

      if (process.env.WAYLAND_DISPLAY) {
        try {
          await execFileAsync("sh", ["-c", `wl-copy --type "${mimeType}" < "${resolved}"`], {
            timeout: 5000,
          })
          return { copied: true }
        } catch {
          // Fall through
        }
      }

      if (process.env.DISPLAY) {
        try {
          await execFileAsync("xclip", ["-selection", "clipboard", "-t", mimeType, "-i", resolved], {
            timeout: 5000,
          })
          return { copied: true }
        } catch {
          // Fall through
        }
      }

      return {
        copied: false,
        error: "当前 Linux 环境未检测到图形桌面剪贴板（DISPLAY / WAYLAND_DISPLAY / xclip / wl-copy）",
      }
    }

    return { copied: false, error: `不支持的操作系统平台: ${process.platform}` }
  } catch (err: unknown) {
    return {
      copied: false,
      error: formatExecError(err),
    }
  }
}
