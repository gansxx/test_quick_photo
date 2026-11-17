package com.example.quickphoto

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import androidx.core.content.FileProvider
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.TimeUnit

const val DEFAULT_GITHUB_RELEASE_URL = "https://api.github.com/repos/gansxx/quick_photo/releases/latest"

data class ReleaseAsset(
  val name: String,
  val size: Long,
  val downloadUrl: String,
  val contentType: String
)

data class ReleaseInfo(
  val tagName: String,
  val version: String,
  val title: String,
  val changelog: String,
  val publishedAt: String,
  val htmlUrl: String,
  val apkAsset: ReleaseAsset?
)

sealed class UpdateCheckResult {
  data class HasUpdate(val release: ReleaseInfo, val currentVersion: String) : UpdateCheckResult()
  data class UpToDate(val version: String) : UpdateCheckResult()
  data class Error(val message: String) : UpdateCheckResult()
}

class UnknownSourcesNeededException : Exception("需要允许安装未知应用权限")

fun normalizeGitHubReleaseUrl(input: String?): String {
  val trimmed = input?.trim().orEmpty()
  if (trimmed.isEmpty()) return DEFAULT_GITHUB_RELEASE_URL

  val ownerRepoRegex = Regex("^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$")
  if (ownerRepoRegex.matches(trimmed)) {
    return "https://api.github.com/repos/$trimmed/releases/latest"
  }

  val githubWebRegex = Regex("^https?://github\\.com/([a-zA-Z0-9_.-]+)/([a-zA-Z0-9_.-]+)(/.*)?$")
  val match = githubWebRegex.find(trimmed)
  if (match != null) {
    val owner = match.groupValues[1]
    val repo = match.groupValues[2]
    return "https://api.github.com/repos/$owner/$repo/releases/latest"
  }

  return trimmed
}

fun isNewerVersion(remoteTag: String, currentVersion: String): Boolean {
  val cleanRemote = remoteTag.trim().removePrefix("v").removePrefix("V")
  val cleanCurrent = currentVersion.trim().removePrefix("v").removePrefix("V")

  val remoteParts = cleanRemote.split('-', '+')[0].split('.').map { it.filter(Char::isDigit).toIntOrNull() ?: 0 }
  val currentParts = cleanCurrent.split('-', '+')[0].split('.').map { it.filter(Char::isDigit).toIntOrNull() ?: 0 }

  val maxLen = maxOf(remoteParts.size, currentParts.size)
  for (i in 0 until maxLen) {
    val r = remoteParts.getOrElse(i) { 0 }
    val c = currentParts.getOrElse(i) { 0 }
    if (r > c) return true
    if (r < c) return false
  }
  return false
}

fun checkGitHubReleaseUpdate(
  releaseUrl: String,
  currentVersion: String,
  preferDevApk: Boolean = false
): UpdateCheckResult = try {
  val client = OkHttpClient.Builder()
    .connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(15, TimeUnit.SECONDS)
    .build()

  val request = Request.Builder()
    .url(releaseUrl)
    .header("User-Agent", "QuickPhoto-Android")
    .header("Accept", "application/vnd.github.v3+json")
    .get()
    .build()

  client.newCall(request).execute().use { response ->
    if (!response.isSuccessful) {
      return UpdateCheckResult.Error("获取更新信息失败：HTTP ${response.code}")
    }

    val body = response.body?.string().orEmpty()
    val json = JSONObject(body)

    val tagName = json.optString("tag_name", "").ifBlank { json.optString("name", "") }
    if (tagName.isBlank()) {
      return UpdateCheckResult.Error("Release 中未包含版本标签")
    }

    val cleanRemoteVersion = tagName.removePrefix("v").removePrefix("V")
    val title = json.optString("name", tagName)
    val changelog = json.optString("body", "暂无更新说明")
    val publishedAt = json.optString("published_at", "")
    val htmlUrl = json.optString("html_url", "https://github.com/gansxx/quick_photo/releases")

    val assetsJson = json.optJSONArray("assets")
    val apkAssets = mutableListOf<ReleaseAsset>()
    if (assetsJson != null) {
      for (i in 0 until assetsJson.length()) {
        val asset = assetsJson.getJSONObject(i)
        val name = asset.optString("name", "")
        if (name.endsWith(".apk", ignoreCase = true)) {
          apkAssets.add(
            ReleaseAsset(
              name = name,
              size = asset.optLong("size", 0L),
              downloadUrl = asset.optString("browser_download_url", ""),
              contentType = asset.optString("content_type", "application/vnd.android.package-archive")
            )
          )
        }
      }
    }

    val chosenApk = if (preferDevApk) {
      apkAssets.firstOrNull { it.name.contains("dev", ignoreCase = true) }
        ?: apkAssets.firstOrNull()
    } else {
      apkAssets.firstOrNull { it.name.contains("release", ignoreCase = true) }
        ?: apkAssets.firstOrNull()
    }

    val release = ReleaseInfo(
      tagName = tagName,
      version = cleanRemoteVersion,
      title = title,
      changelog = changelog,
      publishedAt = publishedAt,
      htmlUrl = htmlUrl,
      apkAsset = chosenApk
    )

    if (isNewerVersion(tagName, currentVersion)) {
      UpdateCheckResult.HasUpdate(release, currentVersion)
    } else {
      UpdateCheckResult.UpToDate(currentVersion)
    }
  }
} catch (e: Exception) {
  UpdateCheckResult.Error(e.message ?: "网络请求失败")
}

fun downloadReleaseApk(
  context: Context,
  asset: ReleaseAsset,
  onProgress: (progress: Float, downloaded: Long, total: Long) -> Unit
): Result<File> = runCatching {
  if (asset.downloadUrl.isBlank()) error("APK 下载链接无效")

  val client = OkHttpClient.Builder()
    .connectTimeout(20, TimeUnit.SECONDS)
    .readTimeout(60, TimeUnit.SECONDS)
    .followRedirects(true)
    .followSslRedirects(true)
    .build()

  val request = Request.Builder()
    .url(asset.downloadUrl)
    .header("User-Agent", "QuickPhoto-Android")
    .get()
    .build()

  val updatesDir = File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "Updates").also { it.mkdirs() }
  val targetFile = File(updatesDir, asset.name)

  client.newCall(request).execute().use { response ->
    if (!response.isSuccessful) error("下载失败：HTTP ${response.code}")
    val body = response.body ?: error("下载响应内容为空")
    val totalBytes = if (asset.size > 0) asset.size else body.contentLength()

    body.byteStream().use { input ->
      FileOutputStream(targetFile).use { output ->
        val buffer = ByteArray(8 * 1024)
        var bytesRead: Int
        var downloadedBytes = 0L

        while (input.read(buffer).also { bytesRead = it } != -1) {
          output.write(buffer, 0, bytesRead)
          downloadedBytes += bytesRead
          val progress = if (totalBytes > 0) (downloadedBytes.toFloat() / totalBytes).coerceIn(0f, 1f) else 0f
          onProgress(progress, downloadedBytes, totalBytes)
        }
        output.flush()
      }
    }
  }

  targetFile
}

fun installDownloadedApk(context: Context, apkFile: File): Result<Unit> = runCatching {
  if (!apkFile.exists() || apkFile.length() == 0L) {
    error("更新包文件不存在或为空")
  }

  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
    if (!context.packageManager.canRequestPackageInstalls()) {
      val permissionIntent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
        data = Uri.parse("package:${context.packageName}")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      context.startActivity(permissionIntent)
      throw UnknownSourcesNeededException()
    }
  }

  val apkUri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", apkFile)
  val installIntent = Intent(Intent.ACTION_VIEW).apply {
    setDataAndType(apkUri, "application/vnd.android.package-archive")
    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
  }
  context.startActivity(installIntent)
}
