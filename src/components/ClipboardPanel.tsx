import { useCallback, useEffect, useState } from "react"
import { Clipboard, Copy, RefreshCw, Send } from "lucide-react"
import type { ClipboardItem, RemoteDevice } from "../lib/types"
import type { ServerConfig } from "../lib/serverConfig"
import { buildApiUrl } from "../lib/serverConfig"
import { DebugLogger } from "../lib/debugLogger"

interface ClipboardPanelProps {
  config: ServerConfig | null
  deviceName: string
}

export function ClipboardPanel({ config, deviceName }: ClipboardPanelProps) {
  const [text, setText] = useState("")
  const [targetDeviceId, setTargetDeviceId] = useState("")
  const [devices, setDevices] = useState<RemoteDevice[]>([])
  const [latest, setLatest] = useState<ClipboardItem | null>(null)
  const [history, setHistory] = useState<ClipboardItem[]>([])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const fetchClipboardAndDevices = useCallback(async () => {
    if (!config) {
      setStatus("服务器配置无效")
      return
    }
    setLoading(true)
    try {
      const [clipRes, devRes] = await Promise.all([
        fetch(buildApiUrl(config, "/api/clipboard")),
        fetch(buildApiUrl(config, "/api/devices")),
      ])
      if (!clipRes.ok) throw new Error(`HTTP ${clipRes.status}`)
      const clipData = (await clipRes.json()) as {
        clipboard?: ClipboardItem | null
        history?: ClipboardItem[]
      }
      setLatest(clipData.clipboard ?? null)
      setHistory(clipData.history ?? [])
      if (devRes.ok) {
        const devData = (await devRes.json()) as { devices?: RemoteDevice[] }
        setDevices(devData.devices ?? [])
      }
    } catch (err: unknown) {
      setStatus(`获取失败：${err instanceof Error ? err.message : "网络错误"}`)
    } finally {
      setLoading(false)
    }
  }, [config])

  useEffect(() => {
    void fetchClipboardAndDevices()
  }, [fetchClipboardAndDevices])

  const handleReadLocalClipboard = async () => {
    try {
      const clipText = await navigator.clipboard.readText()
      if (!clipText) {
        setStatus("本地剪贴板暂无文字内容")
        return
      }
      setText(clipText)
      setStatus("已读取本地剪贴板")
    } catch {
      setStatus("浏览器未授予剪贴板读取权限，请直接在文本框中粘贴（Ctrl+V / Cmd+V）")
    }
  }

  const handleSendClipboard = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!config) {
      setStatus("服务器配置无效")
      return
    }
    if (!text.trim()) {
      setStatus("发送内容不能为空")
      return
    }
    setLoading(true)
    setStatus("正在同步剪贴板…")
    try {
      const res = await fetch(buildApiUrl(config, "/api/clipboard"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.trim(),
          source: `Web (${deviceName})`,
          deviceId: targetDeviceId || undefined,
        }),
      })
      const result = (await res.json()) as { ok?: boolean; error?: string }
      if (!res.ok || !result.ok) {
        throw new Error(result.error || `HTTP ${res.status}`)
      }
      setText("")
      setStatus("已发送至服务器剪贴板")
      DebugLogger.log("Synced clipboard text to server")
      await fetchClipboardAndDevices()
    } catch (err: unknown) {
      setStatus(`同步失败：${err instanceof Error ? err.message : "网络错误"}`)
    } finally {
      setLoading(false)
    }
  }

  const handleCopyText = async (value: string, id: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopiedId(id)
      setStatus("已复制到本地剪贴板")
    } catch {
      setStatus("复制失败：请手动选择文本复制")
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">剪贴板互传</h1>
            <p className="mt-1 text-sm text-slate-600">
              将文本同步至公共剪贴板或定向推送给指定在线设备，也可一键拉取服务端最新剪贴板内容。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void fetchClipboardAndDevices()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            刷新剪贴板
          </button>
        </div>

        <form onSubmit={handleSendClipboard} className="mt-5 space-y-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="输入或粘贴文字内容，发送后可同步到服务器剪贴板或指定设备…"
            rows={4}
            className="w-full rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none"
          />

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void handleReadLocalClipboard()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <Clipboard className="h-3.5 w-3.5" />
              读取本地剪贴板
            </button>

            <select
              value={targetDeviceId}
              onChange={(e) => setTargetDeviceId(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 focus:border-blue-500 focus:outline-none"
            >
              <option value="">全部在线设备（公共剪贴板）</option>
              {devices.map((device) => (
                <option key={device.id} value={device.id}>
                  定向推送至：{device.name}
                </option>
              ))}
            </select>

            <button
              type="submit"
              disabled={loading || !text.trim()}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <Send className="h-3.5 w-3.5" />
              发送到服务器
            </button>
          </div>
        </form>

        {status && (
          <p className="mt-3 text-xs text-blue-700">{status}</p>
        )}
      </section>

      {/* Latest Clipboard */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">服务器最新剪贴板</h2>
          {latest && (
            <span className="text-xs text-slate-500 tabular-nums">
              来源：{latest.source} · {new Date(latest.updatedAt).toLocaleTimeString()}
            </span>
          )}
        </div>

        {latest ? (
          <div className="mt-4 space-y-3">
            <pre className="max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-sm text-slate-800 whitespace-pre-wrap break-all">
              {latest.text}
            </pre>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => void handleCopyText(latest.text, latest.id)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700 whitespace-nowrap shrink-0"
              >
                <Copy className="h-3.5 w-3.5" />
                复制到本地剪贴板
              </button>
              {copiedId === latest.id && (
                <span className="text-xs font-medium text-emerald-700">已复制到剪贴板</span>
              )}
            </div>
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-500">
            当前暂无剪贴板同步记录。手机端或网页端发送后将在此显示。
          </p>
        )}

        {history.length > 1 && (
          <div className="mt-6 border-t border-slate-100 pt-5">
            <h3 className="text-sm font-semibold text-slate-900">
              历史记录（{history.length} 条）
            </h3>
            <div className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200">
              {history.slice(1, 15).map((item) => (
                <div key={item.id} className="flex items-start justify-between gap-4 p-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-slate-500 tabular-nums">
                      {item.source} · {new Date(item.updatedAt).toLocaleString()}
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-800 break-all">
                      {item.text}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCopyText(item.text, item.id)}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
                  >
                    <Copy className="h-3 w-3" />
                    {copiedId === item.id ? "已复制" : "复制"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
