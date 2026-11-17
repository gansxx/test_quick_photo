import { useCallback, useEffect, useState } from "react"
import { Copy, Download, ExternalLink, Image as ImageIcon, RefreshCw, Search, Send } from "lucide-react"
import type { RemoteDevice, ServerSettings, UploadedFile } from "../lib/types"
import type { ServerConfig } from "../lib/serverConfig"
import { buildApiUrl, formatFileBytes } from "../lib/serverConfig"
import { convertImageToPngBlob } from "../lib/imageProcessing"

interface ServerFilesPanelProps {
  config: ServerConfig | null
}

type FileFilter = "all" | "images" | "other"

export function ServerFilesPanel({ config }: ServerFilesPanelProps) {
  const [files, setFiles] = useState<UploadedFile[]>([])
  const [devices, setDevices] = useState<RemoteDevice[]>([])
  const [serverSettings, setServerSettings] = useState<ServerSettings>({
    copyUploadedImageToClipboard: true,
  })
  const [loading, setLoading] = useState(false)
  const [settingsStatus, setSettingsStatus] = useState<string | null>(null)
  const [sendStatus, setSendStatus] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [filter, setFilter] = useState<FileFilter>("all")
  const [selectedDeviceId, setSelectedDeviceId] = useState("")
  const [sendFile, setSendFile] = useState<File | null>(null)

  const refreshAll = useCallback(async () => {
    if (!config) return
    setLoading(true)
    try {
      const [filesRes, devicesRes, settingsRes] = await Promise.all([
        fetch(buildApiUrl(config, "/api/files")),
        fetch(buildApiUrl(config, "/api/devices")),
        fetch(buildApiUrl(config, "/api/settings")),
      ])
      if (filesRes.ok) {
        const data = (await filesRes.json()) as { files?: UploadedFile[] }
        setFiles(data.files ?? [])
      }
      if (devicesRes.ok) {
        const data = (await devicesRes.json()) as { devices?: RemoteDevice[] }
        const list = data.devices ?? []
        setDevices(list)
        if (list.length > 0 && !list.some((d) => d.id === selectedDeviceId)) {
          setSelectedDeviceId(list[0].id)
        }
      }
      if (settingsRes.ok) {
        const data = (await settingsRes.json()) as { settings?: ServerSettings }
        if (data.settings) setServerSettings(data.settings)
      }
    } finally {
      setLoading(false)
    }
  }, [config, selectedDeviceId])

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  const handleToggleCopyImage = async (checked: boolean) => {
    if (!config) return
    setServerSettings({ copyUploadedImageToClipboard: checked })
    setSettingsStatus("正在保存设置…")
    try {
      const res = await fetch(buildApiUrl(config, "/api/settings"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ copyUploadedImageToClipboard: checked }),
      })
      const result = (await res.json()) as {
        ok?: boolean
        settings?: ServerSettings
        error?: string
      }
      if (res.ok && result.ok && result.settings) {
        setServerSettings(result.settings)
        setSettingsStatus(
          result.settings.copyUploadedImageToClipboard
            ? "已开启：客户端上传图片时自动复制到服务端系统剪贴板"
            : "已关闭：客户端上传图片时不自动复制到系统剪贴板"
        )
      } else {
        setSettingsStatus(`保存失败：${result.error || res.status}`)
      }
    } catch (err: unknown) {
      setSettingsStatus(`请求失败：${err instanceof Error ? err.message : "网络错误"}`)
    }
  }

  const handleSendToDevice = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!config || !sendFile || !selectedDeviceId) return
    setSendStatus("正在发送到目标设备…")
    try {
      const form = new FormData()
      form.append("file", sendFile)
      form.append("deviceId", selectedDeviceId)
      const res = await fetch(buildApiUrl(config, "/api/send"), {
        method: "POST",
        body: form,
      })
      const result = (await res.json()) as { error?: string }
      if (!res.ok) {
        setSendStatus(`发送失败：${result.error || res.status}`)
      } else {
        setSendStatus("已投递到目标设备收件箱")
        setSendFile(null)
      }
    } catch (err: unknown) {
      setSendStatus(`发送失败：${err instanceof Error ? err.message : "网络错误"}`)
    }
  }

  const fileUrl = (name: string) => {
    if (!config) return `/api/files/${encodeURIComponent(name)}`
    const path = `/api/files/${encodeURIComponent(name)}`
    const built = buildApiUrl(config, path)
    return built.startsWith("/") ? `${window.location.origin}${built}` : built
  }

  const handleCopyText = async (name: string, markdown = false) => {
    const url = fileUrl(name)
    await navigator.clipboard.writeText(markdown ? `![${name}](${url})` : url)
    setCopiedKey(`${name}:${markdown ? "markdown" : "url"}`)
  }

  const handleCopyImage = async (name: string) => {
    try {
      const url = fileUrl(name)
      const pngBlob = await convertImageToPngBlob(url)
      if (typeof ClipboardItem !== "undefined") {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": pngBlob })])
        setCopiedKey(`${name}:image`)
        return
      }
    } catch {
      // Fallback to copying URL
    }
    await handleCopyText(name, false)
  }

  const filteredFiles = files.filter((file) => {
    const isImage = file.contentType.startsWith("image/")
    if (filter === "images" && !isImage) return false
    if (filter === "other" && isImage) return false
    if (searchQuery.trim()) {
      return file.name.toLowerCase().includes(searchQuery.trim().toLowerCase())
    }
    return true
  })

  return (
    <div className="space-y-6">
      {/* Top two cards: Server Setting + Targeted Send */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-base font-semibold text-slate-900">服务端接收设置</h2>
          <label className="mt-4 flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={serverSettings.copyUploadedImageToClipboard}
              onChange={(e) => void handleToggleCopyImage(e.target.checked)}
              className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm font-medium text-slate-800">
              客户端上传图片时，自动将图片复制到服务端系统剪贴板
            </span>
          </label>
          <p className="mt-2 text-xs text-slate-500">
            开启后，当手机或网页通过 <code className="rounded bg-slate-100 px-1 py-0.5">POST /api/upload</code> 上传图片时，服务端会自动写入系统剪贴板。
          </p>
          {settingsStatus && (
            <p className="mt-2.5 text-xs text-blue-700">{settingsStatus}</p>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900">定向发送至在线设备</h2>
            <span className="text-xs text-slate-500 tabular-nums">
              {devices.length} 台设备在线
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            目标客户端须先打开“接收文件”界面以保持在线登记状态。
          </p>
          <form onSubmit={handleSendToDevice} className="mt-4 flex flex-wrap items-center gap-2.5">
            <input
              type="file"
              onChange={(e) => setSendFile(e.target.files?.[0] ?? null)}
              required
              className="max-w-full flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 file:mr-2.5 file:rounded file:border-0 file:bg-slate-100 file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-slate-700"
            />
            <select
              value={selectedDeviceId}
              onChange={(e) => setSelectedDeviceId(e.target.value)}
              disabled={devices.length === 0}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 focus:border-blue-500 focus:outline-none disabled:opacity-60"
            >
              {devices.length === 0 ? (
                <option value="">暂无在线设备</option>
              ) : (
                devices.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.name}
                  </option>
                ))
              )}
            </select>
            <button
              type="submit"
              disabled={devices.length === 0 || !sendFile}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <Send className="h-3.5 w-3.5" />
              发送至设备
            </button>
          </form>
          {sendStatus && <p className="mt-2.5 text-xs text-blue-700">{sendStatus}</p>}
        </section>
      </div>

      {/* Received Files Section */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">
              已接收文件（<span className="tabular-nums">{files.length}</span>）
            </h1>
            <p className="mt-1 text-xs text-slate-500">
              支持查看原图、复制图片到剪贴板、复制直链与 Markdown 图片链接。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索文件名…"
                className="w-44 rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
              />
            </div>

            <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1">
              {(
                [
                  { id: "all", label: "全部" },
                  { id: "images", label: "图片" },
                  { id: "other", label: "文件" },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFilter(item.id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    filter === item.id
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => void refreshAll()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              刷新
            </button>
          </div>
        </div>

        {filteredFiles.length === 0 ? (
          <div className="mt-6 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-6 py-12 text-center">
            <ImageIcon className="mx-auto h-8 w-8 text-slate-400" />
            <p className="mt-3 text-sm font-medium text-slate-700">
              {files.length === 0 ? "尚未收到文件" : "没有匹配筛选条件的文件"}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              在“拍摄上传”页拍照或上传文件后，文件会立即出现在此处。
            </p>
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            {filteredFiles.map((file) => {
              const url = fileUrl(file.name)
              const isImage = file.contentType.startsWith("image/")
              const copiedThis = copiedKey?.startsWith(`${file.name}:`)
              return (
                <article
                  key={file.name}
                  className="flex gap-4 rounded-xl border border-slate-200 bg-white p-4"
                >
                  {isImage && (
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="h-24 w-32 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
                    >
                      <img
                        src={url}
                        alt={file.name}
                        className="h-full w-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    </a>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="break-all text-sm font-medium text-slate-900">{file.name}</p>
                    <p className="mt-1 text-xs text-slate-500 tabular-nums">
                      {formatFileBytes(file.bytes)} · {new Date(file.modifiedAt).toLocaleString()}
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
                      >
                        {isImage ? (
                          <ExternalLink className="h-3 w-3" />
                        ) : (
                          <Download className="h-3 w-3" />
                        )}
                        {isImage ? "查看原图" : "下载文件"}
                      </a>
                      {isImage && (
                        <button
                          type="button"
                          onClick={() => void handleCopyImage(file.name)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
                        >
                          <Copy className="h-3 w-3" />
                          复制图片
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleCopyText(file.name, false)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
                      >
                        复制链接
                      </button>
                      {isImage && (
                        <button
                          type="button"
                          onClick={() => void handleCopyText(file.name, true)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
                        >
                          复制 Markdown
                        </button>
                      )}
                    </div>
                    {copiedThis && (
                      <p className="mt-2 text-xs font-medium text-emerald-700">已复制到剪贴板</p>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
