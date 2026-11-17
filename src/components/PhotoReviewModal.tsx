import { useState } from "react"
import { Crop, RotateCcw, Upload, X } from "lucide-react"
import { CropModal } from "./CropModal"
import { cropPhotoCanvas } from "../lib/imageProcessing"
import { formatFileBytes } from "../lib/serverConfig"

interface PhotoReviewModalProps {
  imageUrl: string
  imageBytes: number
  photoKind: string
  uploading: boolean
  onCropped: (blob: Blob, url: string) => void
  onUpload: () => void
  onRetake: () => void
  onDismiss: () => void
}

export function PhotoReviewModal({
  imageUrl,
  imageBytes,
  photoKind,
  uploading,
  onCropped,
  onUpload,
  onRetake,
  onDismiss,
}: PhotoReviewModalProps) {
  const [cropOpen, setCropOpen] = useState(false)
  const [cropError, setCropError] = useState<string | null>(null)

  const handleApplyCrop = async (
    left: number,
    top: number,
    right: number,
    bottom: number
  ) => {
    setCropOpen(false)
    setCropError(null)
    try {
      const result = await cropPhotoCanvas(imageUrl, left, top, right, bottom)
      onCropped(result.blob, result.url)
    } catch (err: unknown) {
      setCropError(err instanceof Error ? err.message : "裁剪失败，请重试")
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-[2px]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-modal-title"
      >
        <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-4">
            <div>
              <h2 id="review-modal-title" className="text-lg font-semibold text-slate-900">
                效果预览
              </h2>
              <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                <span>{photoKind}</span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">{formatFileBytes(imageBytes)}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={onDismiss}
              disabled={uploading}
              className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
              aria-label="关闭预览"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-4 flex flex-col gap-3">
            <div className="flex max-h-[48vh] items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-950/5 p-2">
              <img
                src={imageUrl}
                alt="待上传图片预览"
                className="max-h-[44vh] w-auto rounded object-contain"
                referrerPolicy="no-referrer"
              />
            </div>

            <p className="text-xs text-slate-500">
              确认后才会发送到服务器。可先进行矩形裁剪或重新拍摄。
            </p>

            {cropError && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {cropError}
              </p>
            )}

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setCropOpen(true)}
                disabled={uploading}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                <Crop className="h-4 w-4" />
                矩形裁剪
              </button>
              <button
                type="button"
                onClick={onRetake}
                disabled={uploading}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                <RotateCcw className="h-4 w-4" />
                重新拍摄
              </button>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={onDismiss}
              disabled={uploading}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              取消
            </button>
            <button
              type="button"
              onClick={onUpload}
              disabled={uploading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <Upload className="h-4 w-4" />
              {uploading ? "正在上传…" : "确认并上传"}
            </button>
          </div>
        </div>
      </div>

      {cropOpen && (
        <CropModal
          imageUrl={imageUrl}
          onApply={handleApplyCrop}
          onCancel={() => setCropOpen(false)}
        />
      )}
    </>
  )
}
