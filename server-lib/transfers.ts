import { mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"

export type RemoteDevice = { id: string; name: string; lastSeen: string }
export type Delivery = {
  token: string
  deviceId: string
  filename: string
  displayName: string
  contentType: string
  bytes: number
  createdAt: string
}

type TransferState = { devices: RemoteDevice[]; deliveries: Delivery[] }

const STATE_FILE = ".quick-photo-transfers.json"
const ACTIVE_FOR_MS = 90_000

async function readState(base = process.cwd()): Promise<TransferState> {
  const target = path.join(base, "uploads", STATE_FILE)
  return JSON.parse(
    await readFile(target, "utf8").catch(() => '{"devices":[],"deliveries":[]}')
  ) as TransferState
}

async function writeState(state: TransferState, base = process.cwd()) {
  const dir = path.join(base, "uploads")
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, STATE_FILE), JSON.stringify(state))
}

function prune(state: TransferState) {
  const now = Date.now()
  state.devices = state.devices.filter((device) => now - Date.parse(device.lastSeen) < ACTIVE_FOR_MS)
  return state
}

export async function heartbeatDevice(id: string, name: string, base = process.cwd()) {
  if (!/^[a-f0-9-]{16,64}$/i.test(id)) throw new Error("Invalid device id")
  const state = prune(await readState(base))
  const device = {
    id,
    name: name.slice(0, 80) || "Web Client",
    lastSeen: new Date().toISOString(),
  }
  state.devices = [...state.devices.filter((item) => item.id !== id), device]
  await writeState(state, base)
  return device
}

export async function listDevices(base = process.cwd()) {
  const state = prune(await readState(base))
  await writeState(state, base)
  return state.devices.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))
}

export async function createDeliveryFromBuffer(
  params: {
    buffer: Buffer
    originalName: string
    mimeType: string
    deviceId: string
  },
  base = process.cwd()
) {
  if (!params.buffer || params.buffer.length === 0) {
    return { status: 400, body: { error: "请选择要发送的文件" } }
  }
  const state = prune(await readState(base))
  if (!state.devices.some((device) => device.id === params.deviceId)) {
    return {
      status: 404,
      body: { error: "目标设备不在线，请在客户端打开接收文件页" },
    }
  }
  const original =
    params.originalName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "file.bin"
  const token = crypto.randomUUID()
  const filename = `delivery_${token}_${original}`
  const dir = path.join(base, "uploads")
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, filename), params.buffer)
  const delivery: Delivery = {
    token,
    deviceId: params.deviceId,
    filename,
    displayName: original,
    contentType: params.mimeType || "application/octet-stream",
    bytes: params.buffer.length,
    createdAt: new Date().toISOString(),
  }
  state.deliveries.push(delivery)
  await writeState(state, base)
  return { status: 201, body: { ok: true, delivery } }
}

export async function inbox(deviceId: string, base = process.cwd()) {
  return (await readState(base)).deliveries.filter((delivery) => delivery.deviceId === deviceId)
}

export async function waitForInboxUpdate(deviceId: string, base = process.cwd()) {
  const deadline = Date.now() + 25_000
  do {
    if ((await inbox(deviceId, base)).length > 0) return true
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  } while (Date.now() < deadline)
  return false
}

export async function getDelivery(deviceId: string, token: string, base = process.cwd()) {
  return (await inbox(deviceId, base)).find((delivery) => delivery.token === token)
}

export async function acknowledgeDelivery(deviceId: string, token: string, base = process.cwd()) {
  const state = await readState(base)
  const target = state.deliveries.find(
    (delivery) => delivery.deviceId === deviceId && delivery.token === token
  )
  const count = state.deliveries.length
  state.deliveries = state.deliveries.filter(
    (delivery) => !(delivery.deviceId === deviceId && delivery.token === token)
  )
  await writeState(state, base)
  if (target) {
    await unlink(path.join(base, "uploads", target.filename)).catch(() => undefined)
  }
  return count !== state.deliveries.length
}
