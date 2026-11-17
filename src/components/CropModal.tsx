import { useCallback, useEffect, useRef, useState } from "react"
import { Check, Crop, X } from "lucide-react"

type DragMode = "MOVE" | "LEFT" | "TOP" | "RIGHT" | "BOTTOM"

interface CropRect {
  left: number
  top: number
  right: number
  bottom: number
}

interface CropModalProps {
  imageUrl: string
  onApply: (left: number, top: number, right: number, bottom: number) => void
  onCancel: () => void
}

function detectDragMode(
  xNorm: number,
  yNorm: number,
  crop: CropRect
): DragMode {
  const edge = 0.06
  if (Math.abs(xNorm - crop.left) < edge) return "LEFT"
  if (Math.abs(xNorm - crop.right) < edge) return "RIGHT"
  if (Math.abs(yNorm - crop.top) < edge) return "TOP"
  if (Math.abs(yNorm - crop.bottom) < edge) return "BOTTOM"
  return "MOVE"
}

export function CropModal({ imageUrl, onApply, onCancel }: CropModalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [crop, setCrop] = useState<CropRect>({
    left: 0.05,
    top: 0.05,
    right: 0.95,
    bottom: 0.95,
  })
  const [aspectRatio, setAspectRatio] = useState<number>(4 / 3)
  const dragStateRef = useRef<{
    active: boolean
    mode: DragMode
    lastX: number
    lastY: number
  }>({
    active: false,
    mode: "MOVE",
    lastX: 0,
    lastY: 0,
  })

  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        setAspectRatio(img.naturalWidth / img.naturalHeight)
      }
    }
    img.src = imageUrl
  }, [imageUrl])

  const getNormalizedPoint = useCallback((clientX: number, clientY: number) => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0.5, y: 0.5, width: 1, height: 1 }
    return {
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height,
      width: rect.width,
      height: rect.height,
    }
  }, [])

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    const pt = getNormalizedPoint(e.clientX, e.clientY)
    const mode = detectDragMode(pt.x, pt.y, crop)
    dragStateRef.current = {
      active: true,
      mode,
      lastX: e.clientX,
      lastY: e.clientY,
    }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current
    if (!state.active) return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return

    const dx = (e.clientX - state.lastX) / rect.width
    const dy = (e.clientY - state.lastY) / rect.height
    state.lastX = e.clientX
    state.lastY = e.clientY

    const minSize = 0.08
    setCrop((prev) => {
      switch (state.mode) {
        case "MOVE": {
          const w = prev.right - prev.left
          const h = prev.bottom - prev.top
          const nextLeft = Math.min(Math.max(prev.left + dx, 0), 1 - w)
          const nextTop = Math.min(Math.max(prev.top + dy, 0), 1 - h)
          return {
            left: nextLeft,
            top: nextTop,
            right: nextLeft + w,
            bottom: nextTop + h,
          }
        }
        case "LEFT":
          return {
            ...prev,
            left: Math.min(Math.max(prev.left + dx, 0), prev.right - minSize),
          }
        case "RIGHT":
          return {
            ...prev,
            right: Math.max(Math.min(prev.right + dx, 1), prev.left + minSize),
          }
        case "TOP":
          return {
            ...prev,
            top: Math.min(Math.max(prev.top + dy, 0), prev.bottom - minSize),
          }
        case "BOTTOM":
          return {
            ...prev,
            bottom: Math.max(Math.min(prev.bottom + dy, 1), prev.top + minSize),
          }
      }
    })
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragStateRef.current.active = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="crop-modal-title"
    >
      <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2">
            <Crop className="h-5 w-5 text-blue-600" />
            <h2 id="crop-modal-title" className="text-lg font-semibold text-slate-900">
              矩形裁剪
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
            aria-label="关闭裁剪"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 flex flex-col items-center gap-3">
          <div
            ref={containerRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{ aspectRatio: String(aspectRatio) }}
            className="relative max-h-[60vh] w-full max-w-full cursor-move select-none overflow-hidden rounded-lg border border-slate-200 bg-slate-900 touch-none"
          >
            <img
              src={imageUrl}
              alt="待裁剪照片"
              className="h-full w-full object-fill pointer-events-none select-none"
              referrerPolicy="no-referrer"
            />
            {/* Shaded areas outside the crop rectangle */}
            <div
              className="pointer-events-none absolute left-0 top-0 right-0 bg-black/45"
              style={{ height: `${crop.top * 100}%` }}
            />
            <div
              className="pointer-events-none absolute left-0 right-0 bottom-0 bg-black/45"
              style={{ top: `${crop.bottom * 100}%` }}
            />
            <div
              className="pointer-events-none absolute left-0 bg-black/45"
              style={{
                top: `${crop.top * 100}%`,
                height: `${(crop.bottom - crop.top) * 100}%`,
                width: `${crop.left * 100}%`,
              }}
            />
            <div
              className="pointer-events-none absolute right-0 bg-black/45"
              style={{
                top: `${crop.top * 100}%`,
                height: `${(crop.bottom - crop.top) * 100}%`,
                left: `${crop.right * 100}%`,
              }}
            />

            {/* White crop frame + edge handles */}
            <div
              className="pointer-events-none absolute border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.3)]"
              style={{
                left: `${crop.left * 100}%`,
                top: `${crop.top * 100}%`,
                width: `${(crop.right - crop.left) * 100}%`,
                height: `${(crop.bottom - crop.top) * 100}%`,
              }}
            >
              <div className="absolute left-1/2 -top-1 h-2 w-8 -translate-x-1/2 rounded-full bg-white" />
              <div className="absolute left-1/2 -bottom-1 h-2 w-8 -translate-x-1/2 rounded-full bg-white" />
              <div className="absolute -left-1 top-1/2 h-8 w-2 -translate-y-1/2 rounded-full bg-white" />
              <div className="absolute -right-1 top-1/2 h-8 w-2 -translate-y-1/2 rounded-full bg-white" />
            </div>
          </div>

          <p className="text-xs text-slate-500">
            拖动方框内部可移动裁剪区域；拖动白色边框可调整矩形大小。
          </p>
        </div>

        <div className="mt-5 flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
          <button
            type="button"
            onClick={() => setCrop({ left: 0, top: 0, right: 1, bottom: 1 })}
            className="mr-auto rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            重置全图
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => onApply(crop.left, crop.top, crop.right, crop.bottom)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 whitespace-nowrap shrink-0"
          >
            <Check className="h-4 w-4" />
            应用裁剪
          </button>
        </div>
      </div>
    </div>
  )
}
