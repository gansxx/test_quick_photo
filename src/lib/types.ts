export type AppTab = "capture" | "inbox" | "clipboard" | "files" | "settings"

export type CaptureMode = "normal" | "document"

export const CAPTURE_MODE_OPTIONS: { value: CaptureMode; label: string; description: string }[] = [
  {
    value: "normal",
    label: "普通相机",
    description: "保留原始拍摄画面，支持预览与矩形裁剪后上传。",
  },
  {
    value: "document",
    label: "文档扫描：裁切并增强",
    description: "自动应用文档对比度与清晰度增强，并支持矩形裁剪校正。",
  },
]

export type PhotoRetentionLocation = "system_gallery" | "app_storage"

export const PHOTO_RETENTION_OPTIONS: {
  value: PhotoRetentionLocation
  label: string
  description: string
}[] = [
  {
    value: "system_gallery",
    label: "浏览器下载与本地留存",
    description: "默认；保留最近拍摄副本并可一键保存至本地下载目录。",
  },
  {
    value: "app_storage",
    label: "仅应用本地缓存",
    description: "仅保存在当前浏览器应用缓存中，达到上限后自动清理最早副本。",
  },
]

export type ReceiveSaveLocation = "system_downloads" | "app_storage"

export const RECEIVE_SAVE_OPTIONS: {
  value: ReceiveSaveLocation
  label: string
  description: string
}[] = [
  {
    value: "system_downloads",
    label: "系统下载文件夹",
    description: "默认；接收文件后直接触发浏览器下载至本地 Downloads。",
  },
  {
    value: "app_storage",
    label: "应用内临时预览与按需保存",
    description: "先接收并确认内容，再按需保存或复制文本。",
  },
]

export type UploadedFile = {
  name: string
  bytes: number
  modifiedAt: string
  contentType: string
}

export type RemoteDevice = {
  id: string
  name: string
  lastSeen: string
}

export type RemoteDelivery = {
  token: string
  deviceId: string
  filename: string
  displayName?: string
  contentType: string
  bytes: number
  createdAt?: string
}

export type ClipboardItem = {
  id: string
  text: string
  source: string
  deviceId?: string
  updatedAt: string
}

export type ServerSettings = {
  copyUploadedImageToClipboard: boolean
}

export type RetainedPhoto = {
  id: string
  name: string
  dataUrl: string
  bytes: number
  kind: string
  createdAt: string
}
