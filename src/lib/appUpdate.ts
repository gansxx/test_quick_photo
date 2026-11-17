export const APP_VERSION = "1.2.5"
export const APP_BUILD = 7
export const DEFAULT_GITHUB_RELEASE_URL =
  "https://api.github.com/repos/gansxx/quick_photo/releases/latest"

export interface ReleaseAsset {
  name: string
  size: number
  downloadUrl: string
  contentType: string
}

export interface ReleaseInfo {
  tagName: string
  version: string
  title: string
  changelog: string
  publishedAt: string
  htmlUrl: string
  apkAsset: ReleaseAsset | null
}

export type UpdateCheckResult =
  | { kind: "has_update"; release: ReleaseInfo; currentVersion: string }
  | { kind: "up_to_date"; version: string }
  | { kind: "error"; message: string }

export function normalizeGitHubReleaseUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return DEFAULT_GITHUB_RELEASE_URL

  if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(trimmed)) {
    return `https://api.github.com/repos/${trimmed}/releases/latest`
  }

  const githubMatch = trimmed.match(
    /^https?:\/\/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)(\/.*)?$/
  )
  if (githubMatch) {
    return `https://api.github.com/repos/${githubMatch[1]}/${githubMatch[2]}/releases/latest`
  }

  return trimmed
}

export function isNewerVersion(remoteTag: string, currentVersion: string): boolean {
  const cleanRemote = remoteTag.trim().replace(/^[vV]/, "")
  const cleanCurrent = currentVersion.trim().replace(/^[vV]/, "")

  const remoteParts = cleanRemote
    .split(/[-+]/)[0]
    .split(".")
    .map((p) => Number.parseInt(p.replace(/\D/g, ""), 10) || 0)
  const currentParts = cleanCurrent
    .split(/[-+]/)[0]
    .split(".")
    .map((p) => Number.parseInt(p.replace(/\D/g, ""), 10) || 0)

  const maxLen = Math.max(remoteParts.length, currentParts.length)
  for (let i = 0; i < maxLen; i++) {
    const r = remoteParts[i] ?? 0
    const c = currentParts[i] ?? 0
    if (r > c) return true
    if (r < c) return false
  }
  return false
}

export async function checkGitHubReleaseUpdate(
  releaseUrl: string,
  currentVersion: string = APP_VERSION
): Promise<UpdateCheckResult> {
  try {
    const response = await fetch(releaseUrl, {
      headers: {
        Accept: "application/vnd.github.v3+json",
      },
    })
    if (!response.ok) {
      return { kind: "error", message: `获取更新信息失败：HTTP ${response.status}` }
    }
    const json = (await response.json()) as {
      tag_name?: string
      name?: string
      body?: string
      published_at?: string
      html_url?: string
      assets?: Array<{
        name?: string
        size?: number
        browser_download_url?: string
        content_type?: string
      }>
    }

    const tagName = (json.tag_name || json.name || "").trim()
    if (!tagName) {
      return { kind: "error", message: "Release 中未包含版本标签" }
    }

    const assets: ReleaseAsset[] = (json.assets ?? [])
      .filter((a) => (a.name || "").toLowerCase().endsWith(".apk"))
      .map((a) => ({
        name: a.name || "release.apk",
        size: a.size ?? 0,
        downloadUrl: a.browser_download_url || "",
        contentType: a.content_type || "application/vnd.android.package-archive",
      }))

    const releaseAsset =
      assets.find((a) => a.name.toLowerCase().includes("release")) ?? assets[0] ?? null

    const release: ReleaseInfo = {
      tagName,
      version: tagName.replace(/^[vV]/, ""),
      title: json.name || tagName,
      changelog: json.body || "暂无更新说明",
      publishedAt: json.published_at || "",
      htmlUrl: json.html_url || "https://github.com/gansxx/quick_photo/releases",
      apkAsset: releaseAsset,
    }

    if (isNewerVersion(tagName, currentVersion)) {
      return { kind: "has_update", release, currentVersion }
    }
    return { kind: "up_to_date", version: currentVersion }
  } catch (err: unknown) {
    return {
      kind: "error",
      message: err instanceof Error ? err.message : "网络请求失败",
    }
  }
}
