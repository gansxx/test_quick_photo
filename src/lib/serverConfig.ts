export interface ServerConfig {
  host: string
  port: number
}

export function getDefaultServerHostPort(): { host: string; port: string } {
  if (typeof window === "undefined") {
    return { host: "localhost", port: "3000" }
  }
  const hostname = window.location.hostname || "localhost"
  const port =
    window.location.port ||
    (window.location.protocol === "https:" ? "443" : "80")
  return { host: hostname, port }
}

export function parseServerConfig(host: string, port: string): ServerConfig | null {
  const cleanHost = host.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "")
  const cleanPort = Number.parseInt(port.trim(), 10)
  if (!cleanHost || !Number.isFinite(cleanPort) || cleanPort < 1 || cleanPort > 65535) {
    return null
  }
  return { host: cleanHost, port: cleanPort }
}

export function isSameOriginConfig(config: ServerConfig): boolean {
  if (typeof window === "undefined") return true
  const current = getDefaultServerHostPort()
  return (
    config.host === current.host &&
    String(config.port) === String(current.port)
  )
}

export function buildApiUrl(config: ServerConfig, apiPath: string): string {
  const normalized = apiPath.startsWith("/") ? apiPath : `/${apiPath}`
  if (isSameOriginConfig(config)) {
    return normalized
  }
  const protocol =
    typeof window !== "undefined" &&
    window.location.protocol === "https:" &&
    config.port === 443
      ? "https"
      : "http"
  const portSuffix =
    (protocol === "http" && config.port === 80) ||
    (protocol === "https" && config.port === 443)
      ? ""
      : `:${config.port}`
  return `${protocol}://${config.host}${portSuffix}${normalized}`
}

export function formatServerDisplay(config: ServerConfig): string {
  if (isSameOriginConfig(config) && typeof window !== "undefined") {
    return window.location.origin
  }
  return `http://${config.host}:${config.port}`
}

export function uploadStatus(code: number, responseText: string): string {
  return code >= 200 && code <= 299
    ? `上传成功：${responseText}`
    : `上传失败：HTTP ${code}`
}

export function serverTestStatus(code: number): string {
  return code >= 200 && code <= 299
    ? `服务器连接成功（HTTP ${code}）`
    : `服务器响应异常（HTTP ${code}）`
}

export function formatFileBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.ceil(bytes / 1024))} KB`
  }
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}
