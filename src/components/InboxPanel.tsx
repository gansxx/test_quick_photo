import { useCallback, useEffect, useRef, useState } from "react"
import { Copy, Download, Inbox, RefreshCw, Wifi } from "lucide-react"
import type { ReceiveSaveLocation, RemoteDelivery } from "../lib/types"
import type { ServerConfig } from "../lib/serverConfig"
import { buildApiUrl, formatFileBytes, formatServerDisplay, serverTestStatus } from "../lib/serverConfig"
import { DebugLogger } from "../lib/debugLogger"

interface InboxPanelProps {
  config: ServerConfig | null
  deviceId: string
  deviceName: string
  onDeviceNameChange: (name: string) => void
  saveLocation: ReceiveSaveLocation
}

export function InboxPanel({
  config,
  deviceId,
  deviceName,
  onDeviceNameChange,
  saveLocation,
}: InboxPanelProps) {
  const [deliveries, setDeliveries] = useState<RemoteDelivery[]>([])
  const [status, setStatus] = useState("正在登记设备并等待接收文件…")
  const [loading, setLoading] = useState(false)
  const [previewText, setPreviewText] = useState<{ name: string; text: string } | null>(null)
  const activeRef = useRef(true)

  const refreshInbox = useCallback(async () => {
    if (!config) {
      setStatus("服务器地址或端口无效")
      return
    }
    setLoading(true)
    try {
      const regRes = await fetch(buildApiUrl(config, "/api/devices"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deviceId, name: deviceName }),
      })
      if (!regRes.ok) {
        throw new Error(`设备登记 HTTP ${regRes.status}`)
      }
      const inboxRes = await fetch(
        buildApiUrl(config, `/api/devices/${encodeURIComponent(deviceId)}/inbox`)
      )
      if (!inboxRes.ok) {
        throw new Error(`HTTP ${inboxRes.status}`)
      }
      const data = (await inboxRes.json()) as { deliveries?: RemoteDelivery[] }
      const list = data.deliveries ?? []
      if (activeRef.current) {
        setDeliveries(list)
        setStatus(`设备已在线（${deviceName}）· 已读取 ${list.length} 个待接收文件`)
      }
    } catch (err: unknown) {
      if (activeRef.current) {
        setStatus(`读取失败：${err instanceof Error ? err.message : "网络错误"}`)
      }
    } finally {
      if (activeRef.current) setLoading(false)
    }
  }, [config, deviceId, deviceName])

  useEffect(() => {
    activeRef.current = true
    void refreshInbox()

    if (!config) return
    const controller = new AbortController()

    async function pollEvents() {
      while (activeRef.current && !controller.signal.aborted && config) {
        try {
          const res = await fetch(
            buildApiUrl(config, `/api/devices/${encodeURIComponent(deviceId)}/events`),
            { signal: controller.signal }
          )
          if (res.ok) {
            const payload = (await res.json()) as { hasUpdates?: boolean }
            if (payload.hasUpdates && activeRef.current) {
              await refreshInbox()
            }
          } else {
            await new Promise((r) => setTimeout(r, 3000))
          }
        } catch {
          if (controller.signal.aborted) break
          await new Promise((r) => setTimeout(r, 3000))
        }
      }
    }

    void pollEvents()
    return () => {
      activeRef.current = false
      controller.abort()
    }
  }, [config, deviceId, refreshInbox])

  const handleTestConnection = async () => {
    if (!config) {
      setStatus("服务器地址或端口无效")
      return
    }
    setStatus("正在测试连接…")
    try {
      const res = await fetch(buildApiUrl(config, "/api/health"))
      setStatus(serverTestStatus(res.status))
    } catch (err: unknown) {
      setStatus(`无法连接服务器：${err instanceof Error ? err.message : "网络错误"}`)
    }
  }

  const handleDownloadAndAck = async (delivery: RemoteDelivery) => {
    if (!config) return
    const displayName = delivery.displayName || delivery.filename
    setStatus(`正在接收 ${displayName}…`)
    try {
      const url = buildApiUrl(
        config,
        `/api/devices/${encodeURIComponent(deviceId)}/inbox/${encodeURIComponent(delivery.token)}`
      )
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()

      if (saveLocation === "system_downloads" || !delivery.contentType.startsWith("text/")) {
        const objectUrl = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = objectUrl
        a.download = displayName
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(objectUrl)
      } else {
        const text = await blob.text()
        setPreviewText({ name: displayName, text })
      }

      await fetch(url, { method: "DELETE" })
      DebugLogger.log(`Received and acknowledged ${displayName}`)
      setStatus(`已接收并保存 ${displayName}`)
      await refreshInbox()
    } catch (err: unknown) {
      setStatus(`接收失败：${err instanceof Error ? err.message : "网络错误"}`)
    }
  }

  const handleCopyTextDelivery = async (delivery: RemoteDelivery) => {
    if (!config) return
    setStatus("正在读取文本…")
    try {
      const url = buildApiUrl(
        config,
        `/api/devices/${encodeURIComponent(deviceId)}/inbox/${encodeURIComponent(delivery.token)}`
      )
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const text = await res.text()
      await navigator.clipboard.writeText(text)
      setPreviewText({ name: delivery.displayName || delivery.filename, text })
      setStatus("已复制到本地剪贴板")
      DebugLogger.log(`Copied delivery text from ${delivery.filename}`)
    } catch (err: unknown) {
      setStatus(`读取或复制文本失败：${err instanceof Error ? err.message : "网络错误"}`)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">接收服务器文件</h1>
            <p className="mt-1 text-sm text-slate-600">
              保持本页面开启即可自动维持在线状态；当电脑或服务端向此设备定向推送文件或剪贴板文本时，将实时刷新收件箱。
            </p>
            <p className="mt-1 font-mono text-xs text-slate-500">
              服务器：{config ? formatServerDisplay(config) : "未配置"} · 设备 ID：{deviceId.slice(0, 8)}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleTestConnection}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <Wifi className="h-3.5 w-3.5" />
              测试连接
            </button>
            <button
              type="button"
              onClick={() => void refreshInbox()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              刷新文件
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
            <span>本机设备名称：</span>
            <input
              type="text"
              value={deviceName}
              onChange={(e) => onDeviceNameChange(e.target.value)}
              maxLength={40}
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
            />
          </label>
          <span className="text-xs text-slate-500">{status}</span>
        </div>

        {previewText && (
          <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50/50 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-slate-900">
                已接收文本：{previewText.name}
              </span>
              <button
                type="button"
                onClick={() => setPreviewText(null)}
                className="text-xs text-slate-500 hover:text-slate-900"
              >
                收起
              </button>
            </div>
            <pre className="mt-2 max-h-40 overflow-y-auto rounded border border-slate-200 bg-white p-3 text-xs text-slate-800 whitespace-pre-wrap break-all">
              {previewText.text}
            </pre>
          </div>
        )}

        <div className="mt-5">
          {deliveries.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-6 py-12 text-center">
              <Inbox className="h-8 w-8 text-slate-400" />
              <p className="mt-3 text-sm font-medium text-slate-700">收件箱暂无待接收文件</p>
              <p className="mt-1 text-xs text-slate-500">
                可在“服务端文件”或“剪贴板”页选择目标设备（{deviceName}）向此收件箱推送内容。
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-200 rounded-xl border border-slate-200">
              {deliveries.map((item) => {
                const name = item.displayName || item.filename
                const isText =
                  item.contentType.startsWith("text/") ||
                  name.toLowerCase().endsWith(".txt") ||
                  name.toLowerCase().includes("clipboard")
                return (
                  <div
                    key={item.token}
                    className="flex flex-wrap items-center justify-between gap-4 p-4"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900">{name}</p>
                      <p className="mt-1 text-xs text-slate-500 tabular-nums">
                        {formatFileBytes(item.bytes)} · {item.contentType}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isText && (
                        <button
                          type="button"
                          onClick={() => void handleCopyTextDelivery(item)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          复制文本
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleDownloadAndAck(item)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700 whitespace-nowrap shrink-0"
                      >
                        <Download className="h-3.5 w-3.5" />
                        接收并保存
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
