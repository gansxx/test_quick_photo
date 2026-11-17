import { useEffect, useRef, useState } from "react"
import {
  Camera,
  Download,
  FileUp,
  Image as ImageIcon,
  Radar,
  RefreshCw,
  ScanLine,
  Trash2,
  Video,
  VideoOff,
} from "lucide-react"
import type { CaptureMode, RetainedPhoto } from "../lib/types"
import { CAPTURE_MODE_OPTIONS } from "../lib/types"
import { formatFileBytes } from "../lib/serverConfig"
import { enhanceDocumentImage } from "../lib/imageProcessing"

interface CaptureWorkspaceProps {
  captureMode: CaptureMode
  onCaptureModeChange: (mode: CaptureMode) => void
  uploadEndpoint: string
  status: string
  discovering: boolean
  onDiscoverServer: () => void
  onPhotoCaptured: (blob: Blob, url: string, kind: string) => void
  onGenericFileSelected: (file: File) => void
  retainedPhotos: RetainedPhoto[]
  retentionLimit: number
  onDeleteRetained: (id: string) => void
  onUseRetained: (photo: RetainedPhoto) => void
  externalTriggerCount: number
}

export function CaptureWorkspace({
  captureMode,
  onCaptureModeChange,
  uploadEndpoint,
  status,
  discovering,
  onDiscoverServer,
  onPhotoCaptured,
  onGenericFileSelected,
  retainedPhotos,
  retentionLimit,
  onDeleteRetained,
  onUseRetained,
  externalTriggerCount,
}: CaptureWorkspaceProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const genericFileInputRef = useRef<HTMLInputElement | null>(null)

  const [cameraActive, setCameraActive] = useState(false)
  const [cameraFacing, setCameraFacing] = useState<"environment" | "user">("environment")
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [processingCapture, setProcessingCapture] = useState(false)

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setCameraActive(false)
  }

  const startCamera = async (facing: "environment" | "user" = cameraFacing) => {
    setCameraError(null)
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError("当前浏览器不支持实时摄像头取景，请使用下方“从相机/相册选取照片”。")
      return
    }
    try {
      stopCamera()
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      })
      streamRef.current = stream
      setCameraActive(true)
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream
        }
      })
    } catch (err: unknown) {
      setCameraActive(false)
      setCameraError(
        err instanceof Error
          ? `无法开启摄像头（${err.message}），可直接点击“从相机/相册选取照片”。`
          : "无法开启摄像头，可直接点击“从相机/相册选取照片”。"
      )
    }
  }

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
      }
    }
  }, [])

  useEffect(() => {
    if (externalTriggerCount > 0) {
      if (cameraActive) {
        void handleShutterCapture()
      } else {
        void startCamera()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalTriggerCount])

  const processCapturedSource = async (rawBlob: Blob, rawUrl: string) => {
    setProcessingCapture(true)
    try {
      if (captureMode === "document") {
        const enhanced = await enhanceDocumentImage(rawUrl)
        URL.revokeObjectURL(rawUrl)
        onPhotoCaptured(enhanced.blob, enhanced.url, "文档照片（已裁切和增强）")
      } else {
        onPhotoCaptured(rawBlob, rawUrl, "普通照片（未增强）")
      }
    } catch {
      onPhotoCaptured(rawBlob, rawUrl, "普通照片（未增强）")
    } finally {
      setProcessingCapture(false)
    }
  }

  const handleShutterCapture = async () => {
    const video = videoRef.current
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return
    const canvas = document.createElement("canvas")
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.94)
    )
    if (!blob) return
    const url = URL.createObjectURL(blob)
    await processCapturedSource(blob, url)
  }

  const handleImageInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    const url = URL.createObjectURL(file)
    await processCapturedSource(file, url)
  }

  const handleGenericFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    onGenericFileSelected(file)
  }

  const currentModeInfo =
    CAPTURE_MODE_OPTIONS.find((item) => item.value === captureMode) ?? CAPTURE_MODE_OPTIONS[1]

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Left primary column: Capture & Upload */}
      <section className="lg:col-span-7 flex flex-col gap-5 rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">拍摄、预览、再上传</h1>
            <p className="mt-1 text-sm text-slate-600">{currentModeInfo.description}</p>
            <p className="mt-1 font-mono text-xs text-slate-500">
              上传地址：{uploadEndpoint}
            </p>
          </div>

          {/* Segmented Capture Mode Control */}
          <div
            className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1"
            role="group"
            aria-label="拍摄方式"
          >
            {CAPTURE_MODE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onCaptureModeChange(option.value)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  captureMode === option.value
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {option.value === "document" ? (
                  <ScanLine className="h-3.5 w-3.5" />
                ) : (
                  <Camera className="h-3.5 w-3.5" />
                )}
                {option.value === "document" ? "文档扫描增强" : "普通相机"}
              </button>
            ))}
          </div>
        </div>

        {/* Camera Viewfinder */}
        <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-900 aspect-video flex items-center justify-center">
          {cameraActive ? (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="h-full w-full object-cover"
              />
              {captureMode === "document" && (
                <div className="pointer-events-none absolute inset-6 rounded-lg border-2 border-dashed border-white/75" />
              )}
              <div className="absolute bottom-4 left-0 right-0 flex items-center justify-center gap-3 px-4">
                <button
                  type="button"
                  onClick={() => {
                    const next = cameraFacing === "environment" ? "user" : "environment"
                    setCameraFacing(next)
                    void startCamera(next)
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900/80 px-3 py-2 text-xs font-medium text-white backdrop-blur-xs transition-colors hover:bg-slate-900 whitespace-nowrap shrink-0"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  切换镜头
                </button>
                <button
                  type="button"
                  onClick={() => void handleShutterCapture()}
                  disabled={processingCapture}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap shrink-0"
                >
                  <Camera className="h-4 w-4" />
                  {processingCapture ? "正在处理…" : "立即拍照"}
                </button>
                <button
                  type="button"
                  onClick={stopCamera}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900/80 px-3 py-2 text-xs font-medium text-white backdrop-blur-xs transition-colors hover:bg-slate-900 whitespace-nowrap shrink-0"
                >
                  <VideoOff className="h-3.5 w-3.5" />
                  关闭取景
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-800 text-slate-300">
                <Video className="h-6 w-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-white">
                  实时取景器未开启
                </p>
                <p className="mt-1 max-w-md text-xs text-slate-400">
                  可开启设备摄像头实时拍照，或直接调用系统相机 / 从本地相册选取照片进行预览与裁剪。
                </p>
              </div>
              <div className="mt-1 flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => void startCamera()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 whitespace-nowrap shrink-0"
                >
                  <Camera className="h-4 w-4" />
                  开启摄像头拍照
                </button>
                <button
                  type="button"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={processingCapture}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-100 transition-colors hover:bg-slate-700 whitespace-nowrap shrink-0"
                >
                  <ImageIcon className="h-4 w-4" />
                  {processingCapture ? "正在处理…" : "从相机/相册选取照片"}
                </button>
              </div>
            </div>
          )}
        </div>

        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleImageInputChange}
          className="hidden"
        />

        {cameraError && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
            {cameraError}
          </div>
        )}

        {/* Status Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          <div className="text-sm text-slate-700">
            <span className="font-medium text-slate-900">当前状态：</span>
            <span>{status}</span>
          </div>
          {cameraActive && (
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              className="text-xs font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap shrink-0"
            >
              改用相册选取
            </button>
          )}
        </div>
      </section>

      {/* Right column: Quick Actions + Retained Photos */}
      <aside className="lg:col-span-5 flex flex-col gap-6">
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-base font-semibold text-slate-900">快捷传输与连接</h2>
          <p className="mt-1 text-xs text-slate-500">
            支持自动探测当前接收服务，或直接发送任意格式文件到服务器。
          </p>

          <div className="mt-4 flex flex-col gap-3">
            <button
              type="button"
              onClick={onDiscoverServer}
              disabled={discovering}
              className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-left text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 disabled:opacity-60"
            >
              <span className="flex items-center gap-2.5">
                <Radar className="h-4 w-4 text-blue-600" />
                <span>{discovering ? "正在搜索局域网服务器…" : "自动发现局域网服务器"}</span>
              </span>
              <span className="text-xs text-slate-400">探测</span>
            </button>

            <button
              type="button"
              onClick={() => genericFileInputRef.current?.click()}
              className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-left text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50"
            >
              <span className="flex items-center gap-2.5">
                <FileUp className="h-4 w-4 text-blue-600" />
                <span>选择文件并发送到服务器</span>
              </span>
              <span className="text-xs text-slate-400">任意文件</span>
            </button>
            <input
              ref={genericFileInputRef}
              type="file"
              onChange={handleGenericFileChange}
              className="hidden"
            />
          </div>
        </div>

        {/* Retained Photos Card */}
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900">本地保留照片</h2>
            <span className="text-xs text-slate-500 tabular-nums">
              {retainedPhotos.length} / {retentionLimit} 张
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            仅保留本应用拍摄后的副本，达到设定上限后自动删除最早的一张。
          </p>

          {retainedPhotos.length === 0 ? (
            <div className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-xs text-slate-500">
              尚未保留照片。拍照或扫描确认后将自动记录在此处。
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-3">
              {[...retainedPhotos].reverse().map((photo) => (
                <div
                  key={photo.id}
                  className="flex items-center gap-3 rounded-lg border border-slate-200 p-2.5"
                >
                  <button
                    type="button"
                    onClick={() => onUseRetained(photo)}
                    className="h-14 w-14 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-slate-100"
                    title="点击预览并重新上传"
                  >
                    <img
                      src={photo.dataUrl}
                      alt={photo.name}
                      className="h-full w-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-slate-900">{photo.name}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
                      {photo.kind} · {formatFileBytes(photo.bytes)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <a
                      href={photo.dataUrl}
                      download={photo.name}
                      className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
                      title="下载保留副本"
                    >
                      <Download className="h-4 w-4" />
                    </a>
                    <button
                      type="button"
                      onClick={() => onDeleteRetained(photo.id)}
                      className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600"
                      title="删除副本"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}
