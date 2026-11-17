import { readdir, stat } from "node:fs/promises"
import path from "node:path"

const safeFilename = /^[^/\\]+$/

export type UploadedFile = {
  name: string
  bytes: number
  modifiedAt: string
  contentType: string
}

export function isPhotoFilename(name: string) {
  return safeFilename.test(name) && /\.(jpe?g|png|webp)$/i.test(name)
}

export function isSafeFilename(name: string) {
  return (
    safeFilename.test(name) &&
    name === path.basename(name) &&
    !name.startsWith(".") &&
    !name.startsWith("delivery_")
  )
}

export function contentTypeFor(name: string) {
  const extension = name.split(".").pop()?.toLowerCase()
  return (
    (
      {
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        webp: "image/webp",
        pdf: "application/pdf",
        txt: "text/plain; charset=utf-8",
      } as Record<string, string>
    )[extension ?? ""] ?? "application/octet-stream"
  )
}

export async function listUploadedFiles(baseDirectory = process.cwd()): Promise<UploadedFile[]> {
  const dir = path.join(baseDirectory, "uploads")
  const names = (await readdir(dir).catch(() => [] as string[])).filter(isSafeFilename)
  const files = await Promise.all(
    names.map(async (name) => {
      const info = await stat(path.join(dir, name))
      return {
        name,
        bytes: info.size,
        modifiedAt: info.mtime.toISOString(),
        contentType: contentTypeFor(name),
      }
    })
  )
  return files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
}
