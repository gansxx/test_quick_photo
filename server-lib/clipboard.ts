import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"

export type ClipboardItem = {
  id: string
  text: string
  source: string
  deviceId?: string
  updatedAt: string
}

type ClipboardState = {
  latest: ClipboardItem | null
  history: ClipboardItem[]
}

const STATE_FILE = ".quick-photo-clipboard.json"
const MAX_HISTORY = 30

async function readState(base = process.cwd()): Promise<ClipboardState> {
  const target = path.join(base, "uploads", STATE_FILE)
  return JSON.parse(
    await readFile(target, "utf8").catch(() => '{"latest":null,"history":[]}')
  ) as ClipboardState
}

async function writeState(state: ClipboardState, base = process.cwd()) {
  const dir = path.join(base, "uploads")
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, STATE_FILE), JSON.stringify(state))
}

export async function getLatestClipboard(base = process.cwd()): Promise<ClipboardItem | null> {
  const state = await readState(base)
  return state.latest
}

export async function listClipboardHistory(base = process.cwd()): Promise<ClipboardItem[]> {
  const state = await readState(base)
  return state.history || []
}

export async function setClipboard(
  text: string,
  source = "Web",
  deviceId?: string,
  base = process.cwd()
): Promise<ClipboardItem> {
  const cleanText = text.trim()
  if (!cleanText) {
    throw new Error("剪贴板内容不能为空")
  }
  const state = await readState(base)
  const item: ClipboardItem = {
    id: crypto.randomUUID(),
    text: cleanText,
    source: source.slice(0, 80) || "Unknown",
    deviceId: deviceId?.slice(0, 80),
    updatedAt: new Date().toISOString(),
  }
  state.latest = item
  state.history = [
    item,
    ...(state.history || []).filter((h) => h.text !== cleanText),
  ].slice(0, MAX_HISTORY)
  await writeState(state, base)
  return item
}
