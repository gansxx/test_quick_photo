function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error("无法加载图片"))
    img.src = src
  })
}

export async function enhanceDocumentImage(
  sourceUrl: string
): Promise<{ blob: Blob; url: string }> {
  const img = await loadImageElement(sourceUrl)
  const maxDim = 2200
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight))
  const width = Math.max(1, Math.round(img.naturalWidth * scale))
  const height = Math.max(1, Math.round(img.naturalHeight * scale))

  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("无法创建画布上下文")

  ctx.drawImage(img, 0, 0, width, height)
  const imageData = ctx.getImageData(0, 0, width, height)
  const data = imageData.data

  // Find 2nd and 98th luminance percentiles for adaptive white/black document balance
  const histogram = new Uint32Array(256)
  const pixelCount = width * height
  for (let i = 0; i < data.length; i += 4) {
    const lum = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
    histogram[lum]++
  }

  let lowClip = 0
  let highClip = 255
  let acc = 0
  for (let v = 0; v < 256; v++) {
    acc += histogram[v]
    if (acc >= pixelCount * 0.02) {
      lowClip = v
      break
    }
  }
  acc = 0
  for (let v = 255; v >= 0; v--) {
    acc += histogram[v]
    if (acc >= pixelCount * 0.05) {
      highClip = v
      break
    }
  }

  const range = Math.max(24, highClip - lowClip)
  const gain = 255 / range

  // Document enhancement: crisp contrast stretch + slight paper whitening & ink darkening
  for (let i = 0; i < data.length; i += 4) {
    const r = Math.min(255, Math.max(0, (data[i] - lowClip) * gain))
    const g = Math.min(255, Math.max(0, (data[i + 1] - lowClip) * gain))
    const b = Math.min(255, Math.max(0, (data[i + 2] - lowClip) * gain))
    const lum = 0.299 * r + 0.587 * g + 0.114 * b

    // Soft S-curve for document clarity while retaining subtle color cues
    const normalized = lum / 255
    const contrasted = normalized < 0.5
      ? Math.pow(normalized * 2, 1.25) / 2
      : 1 - Math.pow((1 - normalized) * 2, 1.35) / 2
    const targetLum = contrasted * 255
    const lumRatio = lum > 1 ? targetLum / lum : 1

    data[i] = Math.min(255, Math.max(0, Math.round(r * lumRatio * 0.85 + targetLum * 0.15)))
    data[i + 1] = Math.min(255, Math.max(0, Math.round(g * lumRatio * 0.85 + targetLum * 0.15)))
    data[i + 2] = Math.min(255, Math.max(0, Math.round(b * lumRatio * 0.85 + targetLum * 0.15)))
  }

  ctx.putImageData(imageData, 0, 0)

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error("生成增强图片失败"))),
      "image/jpeg",
      0.95
    )
  })
  return { blob, url: URL.createObjectURL(blob) }
}

export async function cropPhotoCanvas(
  sourceUrl: string,
  left: number,
  top: number,
  right: number,
  bottom: number
): Promise<{ blob: Blob; url: string }> {
  const img = await loadImageElement(sourceUrl)
  const w = img.naturalWidth
  const h = img.naturalHeight

  const x = Math.max(0, Math.min(w - 1, Math.round(w * left)))
  const y = Math.max(0, Math.min(h - 1, Math.round(h * top)))
  const cropW = Math.max(1, Math.min(w - x, Math.round(w * right) - x))
  const cropH = Math.max(1, Math.min(h - y, Math.round(h * bottom) - y))

  const canvas = document.createElement("canvas")
  canvas.width = cropW
  canvas.height = cropH
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("无法创建裁剪画布")

  ctx.drawImage(img, x, y, cropW, cropH, 0, 0, cropW, cropH)

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error("生成裁剪图片失败"))),
      "image/jpeg",
      0.95
    )
  })
  return { blob, url: URL.createObjectURL(blob) }
}

export async function convertImageToPngBlob(url: string): Promise<Blob> {
  const res = await fetch(url)
  const blob = await res.blob()
  if (blob.type === "image/png") return blob

  const img = await loadImageElement(URL.createObjectURL(blob))
  const canvas = document.createElement("canvas")
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("无法创建图片画布")
  ctx.drawImage(img, 0, 0)
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => (result ? resolve(result) : reject(new Error("转换 PNG 失败"))),
      "image/png"
    )
  })
}
