import { useEffect, useState } from "react"
import { Check, ExternalLink, RefreshCw, Terminal, Trash2, Wifi } from "lucide-react"
import type {
  CaptureMode,
  PhotoRetentionLocation,
  ReceiveSaveLocation,
} from "../lib/types"
import {
  CAPTURE_MODE_OPTIONS,
  PHOTO_RETENTION_OPTIONS,
  RECEIVE_SAVE_OPTIONS,
} from "../lib/types"
import {
  getDefaultServerHostPort,
  parseServerConfig,
  serverTestStatus,
  buildApiUrl,
  formatFileBytes,
} from "../lib/serverConfig"
import {
  APP_BUILD,
  APP_VERSION,
  checkGitHubReleaseUpdate,
  normalizeGitHubReleaseUrl,
  type UpdateCheckResult,
} from "../lib/appUpdate"
import { DebugLogger } from "../lib/debugLogger"

interface SettingsPanelProps {
  host: string
  port: string
  captureMode: CaptureMode
  retentionLimit: number
  retentionLocation: PhotoRetentionLocation
  receiveSaveLocation: ReceiveSaveLocation
  githubReleaseUrl: string
  onSaveSettings: (next: {
    host: string
    port: string
    captureMode: CaptureMode
    retentionLimit: number
    retentionLocation: PhotoRetentionLocation
    receiveSaveLocation: ReceiveSaveLocation
    githubReleaseUrl: string
  }) => void
}

export function SettingsPanel({
  host: initialHost,
  port: initialPort,
  captureMode: initialMode,
  retentionLimit: initialLimit,
  retentionLocation: initialRetentionLocation,
  receiveSaveLocation: initialReceiveSaveLocation,
  githubReleaseUrl: initialGithubUrl,
  onSaveSettings,
}: SettingsPanelProps) {
  const [host, setHost] = useState(initialHost)
  const [port, setPort] = useState(initialPort)
  const [captureMode, setCaptureMode] = useState<CaptureMode>(initialMode)
  const [retentionLimit, setRetentionLimit] = useState(initialLimit)
  const [retentionLocation, setRetentionLocation] =
    useState<PhotoRetentionLocation>(initialRetentionLocation)
  const [receiveSaveLocation, setReceiveSaveLocation] =
    useState<ReceiveSaveLocation>(initialReceiveSaveLocation)
  const [githubReleaseUrl, setGithubReleaseUrl] = useState(initialGithubUrl)

  const [testStatus, setTestStatus] = useState<string | null>(null)
  const [savedNotice, setSavedNotice] = useState<string | null>(null)
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null)
  const [logs, setLogs] = useState<string[]>(() => DebugLogger.getEntries())

  useEffect(() => {
    setHost(initialHost)
    setPort(initialPort)
  }, [initialHost, initialPort])

  useEffect(() => {
    return DebugLogger.subscribe(setLogs)
  }, [])

  const handleTestServer = async () => {
    const config = parseServerConfig(host, port)
    if (!config) {
      setTestStatus("请先填写有效的服务器地址和端口")
      return
    }
    setTestStatus("正在测试服务器…")
    DebugLogger.log(`Testing server at ${buildApiUrl(config, "/api/health")}`)
    try {
      const res = await fetch(buildApiUrl(config, "/api/health"))
      DebugLogger.log(`Server health response: HTTP ${res.status}`)
      setTestStatus(serverTestStatus(res.status))
    } catch (err: unknown) {
      DebugLogger.log("Server health check failed")
      setTestStatus(`无法连接服务器：${err instanceof Error ? err.message : "网络错误"}`)
    }
  }

  const handleResetToCurrentOrigin = () => {
    const def = getDefaultServerHostPort()
    setHost(def.host)
    setPort(def.port)
    setTestStatus(null)
  }

  const handleCheckUpdate = async () => {
    if (checkingUpdate) return
    setCheckingUpdate(true)
    setUpdateResult(null)
    const normalized = normalizeGitHubReleaseUrl(githubReleaseUrl)
    DebugLogger.log(`Checking update from ${normalized}`)
    const res = await checkGitHubReleaseUpdate(normalized, APP_VERSION)
    setCheckingUpdate(false)
    setUpdateResult(res)
    DebugLogger.log(`Update check completed: ${res.kind}`)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSaveSettings({
      host,
      port,
      captureMode,
      retentionLimit,
      retentionLocation,
      receiveSaveLocation,
      githubReleaseUrl,
    })
    setSavedNotice("设置已保存")
    setTimeout(() => setSavedNotice(null), 2500)
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <form
        onSubmit={handleSubmit}
        className="space-y-6 rounded-xl border border-slate-200 bg-white p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">应用与服务器设置</h1>
            <p className="mt-1 text-xs text-slate-500">
              配置默认拍摄方式、本地照片保留策略、接收保存位置及 HTTP 服务器地址。
            </p>
          </div>
          <div className="flex items-center gap-3">
            {savedNotice && (
              <span className="text-xs font-medium text-emerald-700">{savedNotice}</span>
            )}
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700 whitespace-nowrap shrink-0"
            >
              <Check className="h-3.5 w-3.5" />
              保存设置
            </button>
          </div>
        </div>

        {/* Capture Mode */}
        <div className="space-y-2.5">
          <h2 className="text-sm font-semibold text-slate-900">默认拍摄方式</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {CAPTURE_MODE_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 transition-colors ${
                  captureMode === option.value
                    ? "border-blue-600 bg-blue-50/40"
                    : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                <input
                  type="radio"
                  name="captureMode"
                  checked={captureMode === option.value}
                  onChange={() => setCaptureMode(option.value)}
                  className="mt-0.5 text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <p className="text-sm font-medium text-slate-900">{option.label}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{option.description}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Photo Retention */}
        <div className="space-y-3 border-t border-slate-100 pt-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">拍摄照片保留</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                仅保留本应用拍摄后创建的副本，达到数量后自动删除最早的一张。
              </p>
            </div>
            <span className="text-sm font-semibold text-slate-900 tabular-nums">
              {retentionLimit} 张
            </span>
          </div>

          <input
            type="range"
            min={1}
            max={20}
            value={retentionLimit}
            onChange={(e) => setRetentionLimit(Number.parseInt(e.target.value, 10))}
            className="w-full accent-blue-600"
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {PHOTO_RETENTION_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 transition-colors ${
                  retentionLocation === option.value
                    ? "border-blue-600 bg-blue-50/40"
                    : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                <input
                  type="radio"
                  name="retentionLocation"
                  checked={retentionLocation === option.value}
                  onChange={() => setRetentionLocation(option.value)}
                  className="mt-0.5 text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <p className="text-sm font-medium text-slate-900">{option.label}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{option.description}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Receive Save Location */}
        <div className="space-y-3 border-t border-slate-100 pt-5">
          <h2 className="text-sm font-semibold text-slate-900">接收文件保存位置</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {RECEIVE_SAVE_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 transition-colors ${
                  receiveSaveLocation === option.value
                    ? "border-blue-600 bg-blue-50/40"
                    : "border-slate-200 hover:bg-slate-50"
                }`}
              >
                <input
                  type="radio"
                  name="receiveSaveLocation"
                  checked={receiveSaveLocation === option.value}
                  onChange={() => setReceiveSaveLocation(option.value)}
                  className="mt-0.5 text-blue-600 focus:ring-blue-500"
                />
                <div>
                  <p className="text-sm font-medium text-slate-900">{option.label}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{option.description}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* HTTP Server */}
        <div className="space-y-3 border-t border-slate-100 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">HTTP 服务器配置</h2>
            <button
              type="button"
              onClick={handleResetToCurrentOrigin}
              className="text-xs font-medium text-blue-600 hover:text-blue-700"
            >
              使用当前页面服务地址
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="sm:col-span-2 block">
              <span className="block text-xs font-medium text-slate-700">IP 地址或主机名</span>
              <input
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-slate-700">端口</span>
              <input
                type="text"
                inputMode="numeric"
                value={port}
                onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-blue-500 focus:outline-none"
              />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void handleTestServer()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <Wifi className="h-3.5 w-3.5" />
              测试服务器连接
            </button>
            {testStatus && <span className="text-xs text-slate-600">{testStatus}</span>}
          </div>
        </div>

        {/* App Update Check */}
        <div className="space-y-3 border-t border-slate-100 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">版本与更新检查</h2>
            <span className="font-mono text-xs text-slate-500 tabular-nums">
              当前版本：v{APP_VERSION} (Build {APP_BUILD})
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              value={githubReleaseUrl}
              onChange={(e) => setGithubReleaseUrl(e.target.value)}
              placeholder="例如 gansxx/quick_photo"
              className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void handleCheckUpdate()}
              disabled={checkingUpdate}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${checkingUpdate ? "animate-spin" : ""}`} />
              {checkingUpdate ? "正在检查…" : "立即检查更新"}
            </button>
          </div>

          {updateResult && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs">
              {updateResult.kind === "up_to_date" && (
                <p className="font-medium text-emerald-700">
                  当前已安装最新版本 v{updateResult.version}，暂无可用更新。
                </p>
              )}
              {updateResult.kind === "error" && (
                <p className="font-medium text-red-700">
                  检查更新失败：{updateResult.message}
                </p>
              )}
              {updateResult.kind === "has_update" && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">
                      发现新版本：{updateResult.release.tagName}
                    </p>
                    <a
                      href={updateResult.release.htmlUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-blue-600 hover:text-blue-700"
                    >
                      前往 Release 页面
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  {updateResult.release.apkAsset && (
                    <p className="text-slate-600 tabular-nums">
                      安装包：{updateResult.release.apkAsset.name}（
                      {formatFileBytes(updateResult.release.apkAsset.size)}）
                    </p>
                  )}
                  <pre className="max-h-36 overflow-y-auto rounded border border-slate-200 bg-white p-2.5 text-slate-700 whitespace-pre-wrap">
                    {updateResult.release.changelog}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </form>

      {/* Debug Logs */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-slate-600" />
            <h2 className="text-base font-semibold text-slate-900">
              调试日志（<span className="tabular-nums">{logs.length}</span>）
            </h2>
          </div>
          <button
            type="button"
            onClick={() => DebugLogger.clear()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <Trash2 className="h-3.5 w-3.5" />
            清空日志
          </button>
        </div>

        <div className="mt-3 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-slate-950 p-3.5 font-mono text-xs text-slate-200">
          {logs.length === 0 ? (
            <span className="text-slate-500">暂无日志记录</span>
          ) : (
            logs.map((entry, idx) => (
              <div key={`${idx}-${entry}`} className="py-0.5 leading-relaxed">
                {entry}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
