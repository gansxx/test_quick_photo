package com.example.quickphoto

data class ServerConfig(val host: String, val port: Int) {
  fun uploadUrl() = "http://$host:$port/api/upload"
  fun healthUrl() = "http://$host:$port/api/health"
  fun filesUrl() = "http://$host:$port/api/files"
  fun fileUrl(name: String) = "http://$host:$port/api/files/${android.net.Uri.encode(name)}"
  fun clipboardUrl() = "http://$host:$port/api/clipboard"
}

enum class CaptureMode(val preferenceValue: String, val label: String) {
  NORMAL("normal", "普通系统相机"),
  DOCUMENT("document", "文档扫描：裁切并增强");

  companion object {
    fun fromPreference(value: String?) = entries.firstOrNull { it.preferenceValue == value } ?: DOCUMENT
  }
}

fun parseServerConfig(host: String, port: String): ServerConfig? {
  val cleanHost = host.trim()
  val cleanPort = port.toIntOrNull()
  return if (cleanHost.isNotEmpty() && cleanPort != null && cleanPort in 1..65535) ServerConfig(cleanHost, cleanPort) else null
}

fun uploadStatus(code: Int, response: String): String =
  if (code in 200..299) "上传成功：$response" else "上传失败：HTTP $code"

fun serverTestStatus(code: Int): String =
  if (code in 200..299) "服务器连接成功（HTTP $code）" else "服务器响应异常（HTTP $code）"
