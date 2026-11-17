import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"
import { copyImageFileToSystemClipboard, getServerSettings } from "./settings.ts"

export async function savePhotoBuffer(
  params: {
    buffer: Buffer
    mimeType: string
  },
  baseDirectory = process.cwd(),
  copyImageFn = copyImageFileToSystemClipboard
) {
  if (!params.buffer || params.buffer.length === 0 || !params.mimeType.startsWith("image/")) {
    return { status: 400, body: { error: "请以 photo 字段提交图片" } }
  }
  const ext = params.mimeType === "image/png" ? "png" : params.mimeType === "image/webp" ? "webp" : "jpg"
  const filename = `quick_photo_${new Date().toISOString().replace(/[:.]/g, "-")}_${crypto.randomUUID().slice(0, 8)}.${ext}`
  const uploadDir = path.join(baseDirectory, "uploads")
  await mkdir(uploadDir, { recursive: true })
  const filePath = path.join(uploadDir, filename)
  await writeFile(filePath, params.buffer)

  const settings = await getServerSettings(baseDirectory)
  let copiedToClipboard = false
  let clipboardError: string | undefined
  if (settings.copyUploadedImageToClipboard) {
    const clipResult = await copyImageFn(filePath, params.mimeType || "image/jpeg")
    copiedToClipboard = clipResult.copied
    clipboardError = clipResult.error
  }

  return {
    status: 201,
    body: {
      ok: true,
      filename,
      bytes: params.buffer.length,
      copyUploadedImageToClipboard: settings.copyUploadedImageToClipboard,
      copiedToClipboard,
      ...(clipboardError ? { clipboardError } : {}),
    },
  }
}

export async function saveFileBuffer(
  params: {
    buffer: Buffer
    originalName: string
    mimeType: string
  },
  baseDirectory = process.cwd()
) {
  if (!params.buffer || params.buffer.length === 0) {
    return { status: 400, body: { error: "请以 file 字段提交文件" } }
  }
  const original =
    params.originalName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "upload.bin"
  const filename = `file_${new Date().toISOString().replace(/[:.]/g, "-")}_${crypto.randomUUID().slice(0, 8)}_${original}`
  const uploadDir = path.join(baseDirectory, "uploads")
  await mkdir(uploadDir, { recursive: true })
  await writeFile(path.join(uploadDir, filename), params.buffer)
  return {
    status: 201,
    body: {
      ok: true,
      filename,
      bytes: params.buffer.length,
      contentType: params.mimeType || "application/octet-stream",
    },
  }
}
