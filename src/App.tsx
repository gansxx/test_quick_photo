import { useEffect, useMemo, useState } from "react"
import { Camera } from "lucide-react"
import { CaptureWorkspace } from "./components/CaptureWorkspace"
import { PhotoReviewModal } from "./components/PhotoReviewModal"
import { InboxPanel } from "./components/InboxPanel"
import { ClipboardPanel } from "./components/ClipboardPanel"
import { ServerFilesPanel } from "./components/ServerFilesPanel"
import { SettingsPanel } from "./components/SettingsPanel"
import type {
  AppTab,
  CaptureMode,
  PhotoRetentionLocation,
  ReceiveSaveLocation,
  RetainedPhoto,
} from "./lib/types"
import {
  buildApiUrl,
  getDefaultServerHostPort,
  parseServerConfig,
  uploadStatus,
} from "./lib/serverConfig"
import { DEFAULT_GITHUB_RELEASE_URL } from "./lib/appUpdate"
import {
  deleteRetainedPhoto,
  listRetainedPhotos,
  retainPhoto,
  trimRetainedPhotos,
} from "./lib/photoRetention"
import { DebugLogger } from "./lib/debugLogger"

const STORAGE_KEYS = {
  host: "qp_host",
  port: "qp_port",
  captureMode: "qp_capture_mode",
  retentionLimit: "qp_retention_limit",
  retentionLocation: "qp_retention_location",
  receiveSaveLocation: "qp_receive_save_location",
  githubReleaseUrl: "qp_github_release_url",
  deviceId: "qp_transfer_device_id",
  deviceName: "qp_transfer_device_name",
}

function getOrCreateDeviceId(): string {
  const existing = localStorage.getItem(STORAGE_KEYS.deviceId)
  if (existing && /^[a-f0-9-]{16,64}$/i.test(existing)) return existing
  const created = crypto.randomUUID()
  localStorage.setItem(STORAGE_KEYS.deviceId, created)
  return created
}

function getDefaultDeviceName(): string {
  const stored = localStorage.getItem(STORAGE_KEYS.deviceName)
  if (stored) return stored
  const ua = navigator.userAgent
  if (/Android/i.test(ua)) return "Android Web"
  if (/iPhone|iPad/i.test(ua)) return "iOS Web"
  if (/Windows/i.test(ua)) return "Windows Web"
  if (/Mac/i.test(ua)) return "Mac Web"
  return "Web Client"
}

export function App() {
  const defaults = useMemo(() => getDefaultServerHostPort(), [])

  const [activeTab, setActiveTab] = useState<AppTab>("capture")
  const [host, setHost] = useState<string>(
    () => localStorage.getItem(STORAGE_KEYS.host) || defaults.host
  )
  const [port, setPort] = useState<string>(
    () => localStorage.getItem(STORAGE_KEYS.port) || defaults.port
  )
  const [captureMode, setCaptureMode] = useState<CaptureMode>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.captureMode)
    return saved === "normal" ? "normal" : "document"
  })
  const [retentionLimit, setRetentionLimit] = useState<number>(() => {
    const parsed = Number.parseInt(
      localStorage.getItem(STORAGE_KEYS.retentionLimit) || "3",
      10
    )
    return Number.isFinite(parsed) ? Math.min(20, Math.max(1, parsed)) : 3
  })
  const [retentionLocation, setRetentionLocation] = useState<PhotoRetentionLocation>(() =>
    localStorage.getItem(STORAGE_KEYS.retentionLocation) === "app_storage"
      ? "app_storage"
      : "system_gallery"
  )
  const [receiveSaveLocation, setReceiveSaveLocation] = useState<ReceiveSaveLocation>(() =>
    localStorage.getItem(STORAGE_KEYS.receiveSaveLocation) === "app_storage"
      ? "app_storage"
      : "system_downloads"
  )
  const [githubReleaseUrl, setGithubReleaseUrl] = useState<string>(
    () => localStorage.getItem(STORAGE_KEYS.githubReleaseUrl) || DEFAULT_GITHUB_RELEASE_URL
  )

  const [deviceId] = useState<string>(() => getOrCreateDeviceId())
  const [deviceName, setDeviceName] = useState<string>(() => getDefaultDeviceName())

  const [status, setStatus] = useState<string>("准备就绪")
  const [discovering, setDiscovering] = useState<boolean>(false)
  const [retainedPhotos, setRetainedPhotos] = useState<RetainedPhoto[]>(() =>
    listRetainedPhotos()
  )

  const [reviewPhoto, setReviewPhoto] = useState<{
    blob: Blob
    url: string
    kind: string
  } | null>(null)
  const [uploading, setUploading] = useState<boolean>(false)
  const [cameraTriggerCount, setCameraTriggerCount] = useState<number>(0)

  const serverConfig = useMemo(() => parseServerConfig(host, port), [host, port])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.captureMode, captureMode)
  }, [captureMode])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.deviceName, deviceName)
  }, [deviceName])

  const uploadEndpointDisplay = serverConfig
    ? buildApiUrl(serverConfig, "/api/upload").startsWith("/")
      ? `${window.location.origin}/api/upload`
      : buildApiUrl(serverConfig, "/api/upload")
    : "服务器配置无效"

  const handlePhotoCaptured = async (blob: Blob, url: string, kind: string) => {
    setReviewPhoto({ blob, url, kind })
    setStatus("拍摄完成，请预览后确认上传")
    DebugLogger.log(`Captured photo (${kind}, ${blob.size} bytes); waiting for confirmation`)
    try {
      const retained = await retainPhoto(blob, kind, retentionLocation, retentionLimit)
      setRetainedPhotos(retained.photos)
      DebugLogger.log(`Photo retention: ${retained.status}`)
    } catch {
      // Ignore retention storage errors
    }
  }

  const handleConfirmUpload = async () => {
    if (!reviewPhoto) return
    if (!serverConfig) {
      setStatus("服务器地址或端口无效")
      DebugLogger.log("Upload rejected: invalid server config")
      return
    }
    setUploading(true)
    setStatus("正在上传…")
    const endpoint = buildApiUrl(serverConfig, "/api/upload")
    DebugLogger.log(`Starting upload to ${endpoint}`)

    try {
      const form = new FormData()
      form.append("photo", reviewPhoto.blob, `quick_photo_${Date.now()}.jpg`)
      const res = await fetch(endpoint, { method: "POST", body: form })
      const text = await res.text()
      const msg = uploadStatus(res.status, text)
      setStatus(msg)
      DebugLogger.log(`Upload completed: HTTP ${res.status}`)
      if (res.ok) {
        setReviewPhoto(null)
      }
    } catch (err: unknown) {
      const errMsg = `上传失败：${err instanceof Error ? err.message : "网络错误"}`
      setStatus(errMsg)
      DebugLogger.log(`Upload failed: ${errMsg}`)
    } finally {
      setUploading(false)
    }
  }

  const handleGenericFileSelected = async (file: File) => {
    if (!serverConfig) {
      setStatus("服务器地址或端口无效")
      return
    }
    setStatus(`正在上传文件 ${file.name}…`)
    const endpoint = buildApiUrl(serverConfig, "/api/upload-file")
    DebugLogger.log(`Uploading generic file ${file.name} to ${endpoint}`)
    try {
      const form = new FormData()
      form.append("file", file, file.name)
      const res = await fetch(endpoint, { method: "POST", body: form })
      if (res.ok) {
        setStatus(`文件已发送到服务器：${file.name}`)
        DebugLogger.log(`Generic file uploaded: ${file.name}`)
      } else {
        setStatus(`文件上传失败：HTTP ${res.status}`)
      }
    } catch (err: unknown) {
      setStatus(`文件上传失败：${err instanceof Error ? err.message : "网络错误"}`)
    }
  }

  const handleDiscoverServer = async () => {
    setDiscovering(true)
    setStatus("正在探测局域网接收服务器…")
    DebugLogger.log("Probing server discovery endpoint")
    try {
      const res = await fetch("/api/discover")
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as {
        ok?: boolean
        host?: string
        addresses?: string[]
        port?: number
      }
      if (data.ok) {
        const nextHost = window.location.hostname || data.host || defaults.host
        const nextPort = window.location.port || String(data.port || defaults.port)
        setHost(nextHost)
        setPort(nextPort)
        localStorage.setItem(STORAGE_KEYS.host, nextHost)
        localStorage.setItem(STORAGE_KEYS.port, nextPort)
        const lanNote = data.addresses?.length
          ? `（局域网 IP：${data.addresses.join(", ")}:${data.port}）`
          : ""
        setStatus(`已连接服务器：${nextHost}:${nextPort}${lanNote}`)
        DebugLogger.log(`Discovered server ${nextHost}:${nextPort}`)
      } else {
        setStatus("未发现可用服务器")
      }
    } catch {
      setStatus("未发现服务器；请确认服务正在运行")
      DebugLogger.log("Server discovery failed")
    } finally {
      setDiscovering(false)
    }
  }

  const handleSaveSettings = (next: {
    host: string
    port: string
    captureMode: CaptureMode
    retentionLimit: number
    retentionLocation: PhotoRetentionLocation
    receiveSaveLocation: ReceiveSaveLocation
    githubReleaseUrl: string
  }) => {
    setHost(next.host)
    setPort(next.port)
    setCaptureMode(next.captureMode)
    setRetentionLimit(next.retentionLimit)
    setRetentionLocation(next.retentionLocation)
    setReceiveSaveLocation(next.receiveSaveLocation)
    setGithubReleaseUrl(next.githubReleaseUrl)

    localStorage.setItem(STORAGE_KEYS.host, next.host)
    localStorage.setItem(STORAGE_KEYS.port, next.port)
    localStorage.setItem(STORAGE_KEYS.captureMode, next.captureMode)
    localStorage.setItem(STORAGE_KEYS.retentionLimit, String(next.retentionLimit))
    localStorage.setItem(STORAGE_KEYS.retentionLocation, next.retentionLocation)
    localStorage.setItem(STORAGE_KEYS.receiveSaveLocation, next.receiveSaveLocation)
    localStorage.setItem(STORAGE_KEYS.githubReleaseUrl, next.githubReleaseUrl)

    setRetainedPhotos(trimRetainedPhotos(next.retentionLimit))
    DebugLogger.log("Saved application settings")
  }

  const handleUseRetained = (photo: RetainedPhoto) => {
    fetch(photo.dataUrl)
      .then((res) => res.blob())
      .then((blob) => {
        setReviewPhoto({ blob, url: photo.dataUrl, kind: photo.kind })
      })
      .catch(() => undefined)
  }

  const navItems: { id: AppTab; label: string }[] = [
    { id: "capture", label: "拍摄上传" },
    { id: "inbox", label: "接收文件" },
    { id: "clipboard", label: "剪贴板" },
    { id: "files", label: "服务端文件" },
    { id: "settings", label: "设置" },
  ]

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Three-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-xs">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-8 px-4 py-3.5 sm:px-6">
          {/* Zone 1: Single-line Brand Wordmark */}
          <button
            type="button"
            onClick={() => setActiveTab("capture")}
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            Quick Photo
          </button>

          {/* Zone 2: 5 concise single-line navigation links */}
          <nav
            className="flex items-center gap-5 overflow-x-auto text-sm font-medium"
            aria-label="主导航"
          >
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`border-b-2 py-1 transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === item.id
                    ? "border-blue-600 text-slate-900"
                    : "border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900"
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {/* Zone 3: Primary CTA */}
          <button
            type="button"
            onClick={() => {
              setActiveTab("capture")
              setCameraTriggerCount((c) => c + 1)
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700 whitespace-nowrap shrink-0"
          >
            <Camera className="h-3.5 w-3.5" />
            开始拍摄
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        {activeTab === "capture" && (
          <CaptureWorkspace
            captureMode={captureMode}
            onCaptureModeChange={setCaptureMode}
            uploadEndpoint={uploadEndpointDisplay}
            status={status}
            discovering={discovering}
            onDiscoverServer={() => void handleDiscoverServer()}
            onPhotoCaptured={(blob, url, kind) => void handlePhotoCaptured(blob, url, kind)}
            onGenericFileSelected={(file) => void handleGenericFileSelected(file)}
            retainedPhotos={retainedPhotos}
            retentionLimit={retentionLimit}
            onDeleteRetained={(id) => setRetainedPhotos(deleteRetainedPhoto(id))}
            onUseRetained={handleUseRetained}
            externalTriggerCount={cameraTriggerCount}
          />
        )}

        {activeTab === "inbox" && (
          <InboxPanel
            config={serverConfig}
            deviceId={deviceId}
            deviceName={deviceName}
            onDeviceNameChange={setDeviceName}
            saveLocation={receiveSaveLocation}
          />
        )}

        {activeTab === "clipboard" && (
          <ClipboardPanel config={serverConfig} deviceName={deviceName} />
        )}

        {activeTab === "files" && <ServerFilesPanel config={serverConfig} />}

        {activeTab === "settings" && (
          <SettingsPanel
            host={host}
            port={port}
            captureMode={captureMode}
            retentionLimit={retentionLimit}
            retentionLocation={retentionLocation}
            receiveSaveLocation={receiveSaveLocation}
            githubReleaseUrl={githubReleaseUrl}
            onSaveSettings={handleSaveSettings}
          />
        )}
      </main>

      {reviewPhoto && (
        <PhotoReviewModal
          imageUrl={reviewPhoto.url}
          imageBytes={reviewPhoto.blob.size}
          photoKind={reviewPhoto.kind}
          uploading={uploading}
          onCropped={(blob, url) =>
            setReviewPhoto((prev) =>
              prev ? { ...prev, blob, url } : { blob, url, kind: "已裁剪照片" }
            )
          }
          onUpload={() => void handleConfirmUpload()}
          onRetake={() => {
            setReviewPhoto(null)
            setCameraTriggerCount((c) => c + 1)
          }}
          onDismiss={() => {
            setReviewPhoto(null)
            setStatus("已取消上传")
          }}
        />
      )}
    </div>
  )
}

export default App
