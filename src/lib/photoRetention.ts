import type { PhotoRetentionLocation, RetainedPhoto } from "./types"

const STORAGE_KEY = "quick_photo_retained_photos"

function readStoredPhotos(): RetainedPhoto[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as RetainedPhoto[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeStoredPhotos(items: RetainedPhoto[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    // If localStorage quota is tight, drop oldest entries and retry once
    if (items.length > 1) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(-1)))
      } catch {
        // Ignore storage overflow
      }
    }
  }
}

export function listRetainedPhotos(): RetainedPhoto[] {
  return readStoredPhotos()
}

export function trimRetainedPhotos(limit: number): RetainedPhoto[] {
  const safeLimit = Math.max(0, Math.min(20, limit))
  const current = readStoredPhotos()
  const trimmed = safeLimit === 0 ? [] : current.slice(-safeLimit)
  writeStoredPhotos(trimmed)
  return trimmed
}

export function deleteRetainedPhoto(id: string): RetainedPhoto[] {
  const next = readStoredPhotos().filter((item) => item.id !== id)
  writeStoredPhotos(next)
  return next
}

function blobToCompactDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result)
      else reject(new Error("无法读取图片数据"))
    }
    reader.onerror = () => reject(new Error("读取图片失败"))
    reader.readAsDataURL(blob)
  })
}

export async function retainPhoto(
  blob: Blob,
  kind: string,
  location: PhotoRetentionLocation,
  limit: number
): Promise<{ status: string; photos: RetainedPhoto[] }> {
  if (limit <= 0) {
    return { status: "未保留照片", photos: readStoredPhotos() }
  }
  const stamp = new Date()
    .toISOString()
    .replace(/[-:T.Z]/g, "")
    .slice(0, 14)
  const name = `QuickPhoto_${stamp}.jpg`
  const dataUrl = await blobToCompactDataUrl(blob)

  const current = readStoredPhotos()
  const entry: RetainedPhoto = {
    id: crypto.randomUUID(),
    name,
    dataUrl,
    bytes: blob.size,
    kind,
    createdAt: new Date().toISOString(),
  }
  const next = [...current, entry].slice(-Math.max(1, Math.min(20, limit)))
  writeStoredPhotos(next)

  const locLabel = location === "system_gallery" ? "本地保留列表（可随时下载）" : "应用本地缓存"
  return {
    status: `已保留最近 ${next.length} 张照片（${locLabel}）`,
    photos: next,
  }
}
