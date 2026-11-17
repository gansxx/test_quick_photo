package com.example.quickphoto

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

fun getSystemClipboardText(context: Context): String? = try {
  val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
  val clip = clipboard?.primaryClip
  if (clip != null && clip.itemCount > 0) {
    clip.getItemAt(0)?.coerceToText(context)?.toString()?.takeIf { it.isNotBlank() }
  } else null
} catch (_: Exception) {
  null
}

fun setSystemClipboardText(context: Context, text: String, label: String = "Quick Photo"): Boolean = try {
  val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return false
  clipboard.setPrimaryClip(ClipData.newPlainText(label, text))
  true
} catch (_: Exception) {
  false
}

fun sendClipboardToServer(config: ServerConfig, text: String, deviceName: String): Result<String> = runCatching {
  val cleanText = text.trim()
  if (cleanText.isEmpty()) error("剪贴板内容为空")

  val json = JSONObject().apply {
    put("text", cleanText)
    put("source", "Android ($deviceName)")
  }.toString()

  val body = json.toRequestBody("application/json; charset=utf-8".toMediaType())
  val client = OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).build()
  val request = Request.Builder().url(config.clipboardUrl()).post(body).build()

  client.newCall(request).execute().use { response ->
    if (!response.isSuccessful) {
      error("HTTP ${response.code}")
    }
    val respBody = response.body?.string().orEmpty()
    val ok = JSONObject(respBody).optBoolean("ok", true)
    if (ok) "已发送剪贴板到服务器" else error("服务器返回失败")
  }
}

fun fetchClipboardFromServer(config: ServerConfig): Result<String> = runCatching {
  val client = OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).build()
  val request = Request.Builder().url(config.clipboardUrl()).get().build()

  client.newCall(request).execute().use { response ->
    if (!response.isSuccessful) {
      error("HTTP ${response.code}")
    }
    val respBody = response.body?.string().orEmpty()
    val json = JSONObject(respBody)
    val clipboardObj = json.optJSONObject("clipboard")
    val text = clipboardObj?.optString("text")?.takeIf { it.isNotBlank() }
      ?: error("服务器剪贴板暂无内容")
    text
  }
}
