import express from "express"
import multer from "multer"
import dgram from "node:dgram"
import os from "node:os"
import path from "node:path"
import { readFile } from "node:fs/promises"
import { contentTypeFor, isSafeFilename, listUploadedFiles } from "./server-lib/files.ts"
import { saveFileBuffer, savePhotoBuffer } from "./server-lib/upload.ts"
import { getLatestClipboard, listClipboardHistory, setClipboard } from "./server-lib/clipboard.ts"
import {
  acknowledgeDelivery,
  createDeliveryFromBuffer,
  getDelivery,
  heartbeatDevice,
  inbox,
  listDevices,
  waitForInboxUpdate,
} from "./server-lib/transfers.ts"
import { getServerSettings, updateServerSettings } from "./server-lib/settings.ts"

const PORT = Number(
  process.env.QUICK_PHOTO_PORT ?? process.env.DEFAULT_APP_PORT ?? 3000
)
const DISCOVERY_PORT = 45879
const DISCOVERY_REQUEST = "DISCOVER_QUICK_PHOTO"

const app = express()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 },
})

app.use(express.json({ limit: "10mb" }))

app.use((_, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  next()
})

app.options("/api/{*path}", (_, res) => {
  res.status(204).end()
})

app.get("/api/health", (_, res) => {
  res.json({
    ok: true,
    service: "quick-photo",
    timestamp: new Date().toISOString(),
  })
})

app.get("/api/discover", (req, res) => {
  const interfaces = os.networkInterfaces()
  const addresses: string[] = []
  for (const entries of Object.values(interfaces)) {
    if (!entries) continue
    for (const entry of entries) {
      if (entry.family === "IPv4" && !entry.internal) {
        addresses.push(entry.address)
      }
    }
  }
  const reqHost = req.hostname || "localhost"
  res.json({
    ok: true,
    service: "quick-photo",
    host: addresses[0] || reqHost,
    addresses,
    port: PORT,
  })
})

app.post("/api/upload", upload.single("photo"), async (req, res) => {
  const file = req.file
  if (!file) {
    res.status(400).json({ error: "请以 photo 字段提交图片" })
    return
  }
  const result = await savePhotoBuffer({
    buffer: file.buffer,
    mimeType: file.mimetype || "image/jpeg",
  })
  res.status(result.status).json(result.body)
})

app.post("/api/upload-file", upload.single("file"), async (req, res) => {
  const file = req.file
  if (!file) {
    res.status(400).json({ error: "请以 file 字段提交文件" })
    return
  }
  const result = await saveFileBuffer({
    buffer: file.buffer,
    originalName: file.originalname || "upload.bin",
    mimeType: file.mimetype || "application/octet-stream",
  })
  res.status(result.status).json(result.body)
})

app.get("/api/files", async (_, res) => {
  res.json({ files: await listUploadedFiles() })
})

app.get("/api/files/:name", async (req, res) => {
  const name = req.params.name
  if (!isSafeFilename(name)) {
    res.status(404).send("Not found")
    return
  }
  try {
    const bytes = await readFile(path.join(process.cwd(), "uploads", name))
    res.setHeader("Content-Type", contentTypeFor(name))
    res.setHeader("Cache-Control", "private, max-age=3600")
    res.send(bytes)
  } catch {
    res.status(404).send("Not found")
  }
})

app.get("/api/clipboard", async (_, res) => {
  const [latest, history] = await Promise.all([
    getLatestClipboard(),
    listClipboardHistory(),
  ])
  res.json({ ok: true, clipboard: latest, history })
})

app.post("/api/clipboard", async (req, res) => {
  try {
    const body = (req.body ?? {}) as { text?: string; source?: string; deviceId?: string }
    const text = String(body.text ?? "")
    const source = String(body.source ?? "Web")
    const deviceId = body.deviceId ? String(body.deviceId) : undefined

    if (!text.trim()) {
      res.status(400).json({ ok: false, error: "剪贴板文本不能为空" })
      return
    }

    const saved = await setClipboard(text, source, deviceId)

    if (deviceId) {
      try {
        await createDeliveryFromBuffer({
          buffer: Buffer.from(text, "utf8"),
          originalName: `clipboard_${Date.now()}.txt`,
          mimeType: "text/plain; charset=utf-8",
          deviceId,
        })
      } catch (err) {
        console.warn("Failed to create device delivery for clipboard:", err)
      }
    }

    res.status(201).json({ ok: true, clipboard: saved })
  } catch (err: unknown) {
    res.status(500).json({
      ok: false,
      error: err instanceof Error ? err.message : "未知错误",
    })
  }
})

app.get("/api/devices", async (_, res) => {
  res.json({ devices: await listDevices() })
})

app.post("/api/devices", async (req, res) => {
  try {
    const body = (req.body ?? {}) as { id?: string; name?: string }
    const device = await heartbeatDevice(body.id ?? "", body.name ?? "")
    res.json({ device })
  } catch {
    res.status(400).json({ error: "设备登记失败" })
  }
})

app.get("/api/devices/:id/inbox", async (req, res) => {
  res.json({ deliveries: await inbox(req.params.id) })
})

app.get("/api/devices/:id/events", async (req, res) => {
  res.setHeader("Cache-Control", "no-store")
  res.json({ hasUpdates: await waitForInboxUpdate(req.params.id) })
})

app.get("/api/devices/:id/inbox/:token", async (req, res) => {
  const { id, token } = req.params
  const delivery = await getDelivery(id, token)
  if (!delivery) {
    res.status(404).send("Not found")
    return
  }
  try {
    const bytes = await readFile(path.join(process.cwd(), "uploads", delivery.filename))
    res.setHeader("Content-Type", delivery.contentType)
    res.setHeader("Content-Disposition", `attachment; filename="${delivery.filename}"`)
    res.send(bytes)
  } catch {
    res.status(404).send("Not found")
  }
})

app.delete("/api/devices/:id/inbox/:token", async (req, res) => {
  const { id, token } = req.params
  const ack = await acknowledgeDelivery(id, token)
  res.status(ack ? 204 : 404).end()
})

app.post("/api/send", upload.single("file"), async (req, res) => {
  const file = req.file
  const deviceId = String((req.body as { deviceId?: string } | undefined)?.deviceId ?? "")
  if (!file) {
    res.status(400).json({ error: "请选择要发送的文件" })
    return
  }
  const result = await createDeliveryFromBuffer({
    buffer: file.buffer,
    originalName: file.originalname || "file.bin",
    mimeType: file.mimetype || "application/octet-stream",
    deviceId,
  })
  res.status(result.status).json(result.body)
})

app.get("/api/settings", async (_, res) => {
  const settings = await getServerSettings()
  res.json({ ok: true, settings })
})

app.post("/api/settings", async (req, res) => {
  try {
    const body = (req.body ?? {}) as { copyUploadedImageToClipboard?: boolean }
    const settings = await updateServerSettings({
      copyUploadedImageToClipboard: body.copyUploadedImageToClipboard,
    })
    res.json({ ok: true, settings })
  } catch (err: unknown) {
    res.status(400).json({
      ok: false,
      error: err instanceof Error ? err.message : "保存配置失败",
    })
  }
})

function startUdpDiscovery() {
  try {
    const socket = dgram.createSocket("udp4")
    socket.on("error", () => {
      socket.close()
    })
    socket.on("message", (message, remote) => {
      if (message.toString() !== DISCOVERY_REQUEST) return
      const payload = JSON.stringify({ service: "quick-photo", port: PORT })
      socket.send(Buffer.from(payload), remote.port, remote.address)
    })
    socket.bind(DISCOVERY_PORT, () => {
      try {
        socket.setBroadcast(true)
      } catch {
        // Ignore broadcast flag errors
      }
    })
  } catch {
    // Ignore UDP bind errors in restricted environments
  }
}

async function startServer() {
  const isProd =
    process.env.NODE_ENV === "production" || process.argv.includes("--prod")
  if (!isProd) {
    const { createServer: createViteServer } = await import("vite")
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    })
    app.use(vite.middlewares)
  } else {
    const distDir = path.join(process.cwd(), "dist")
    app.use(express.static(distDir))
    app.get("/{*path}", (_, res) => {
      res.sendFile(path.join(distDir, "index.html"))
    })
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Quick Photo server listening on http://0.0.0.0:${PORT}`)
    startUdpDiscovery()
  })
}

startServer()
