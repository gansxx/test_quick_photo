package com.example.quickphoto

import android.content.ContentResolver
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

enum class PhotoRetentionLocation(val preferenceValue: String, val label: String) {
  SYSTEM_GALLERY("system_gallery", "系统相册"),
  APP_STORAGE("app_storage", "应用专属相册");

  companion object {
    fun fromPreference(value: String?) = entries.firstOrNull { it.preferenceValue == value } ?: SYSTEM_GALLERY
  }
}

enum class ReceiveSaveLocation(val preferenceValue: String, val label: String) {
  SYSTEM_DOWNLOADS("system_downloads", "系统下载文件夹"),
  APP_STORAGE("app_storage", "应用专属存储");

  companion object {
    fun fromPreference(value: String?) = entries.firstOrNull { it.preferenceValue == value } ?: SYSTEM_DOWNLOADS
  }
}

private const val RETAINED_PHOTOS = "retained_photo_uris"
private const val RETENTION_PREFS = "quick_photo_settings"

/** Keeps copies owned by this application only, so cleanup never removes unrelated gallery photos. */
fun retainPhoto(context: Context, source: Uri, location: PhotoRetentionLocation, limit: Int): String {
  if (limit <= 0) return "未保留照片"
  val saved = when (location) {
    PhotoRetentionLocation.SYSTEM_GALLERY -> copyToSystemGallery(context, source)
    PhotoRetentionLocation.APP_STORAGE -> copyToAppStorage(context, source)
  } ?: return "照片保留失败"

  val prefs = context.getSharedPreferences(RETENTION_PREFS, Context.MODE_PRIVATE)
  val current = retainedUris(prefs)
  current += saved.toString()
  trimRetainedPhotos(context, limit, current)
  return "已保留最近 ${current.size} 张照片"
}

fun trimRetainedPhotos(context: Context, limit: Int) {
  val current = retainedUris(context.getSharedPreferences(RETENTION_PREFS, Context.MODE_PRIVATE))
  trimRetainedPhotos(context, limit, current)
}

private fun retainedUris(prefs: android.content.SharedPreferences): MutableList<String> =
  prefs.getString(RETAINED_PHOTOS, null)?.lineSequence()?.filter(String::isNotBlank)?.toMutableList() ?: mutableListOf()

private fun trimRetainedPhotos(context: Context, limit: Int, current: MutableList<String>) {
  while (current.size > limit.coerceAtLeast(0)) deleteRetainedPhoto(context, Uri.parse(current.removeAt(0)))
  context.getSharedPreferences(RETENTION_PREFS, Context.MODE_PRIVATE)
    .edit().putString(RETAINED_PHOTOS, current.joinToString("\n")).apply()
}

private fun copyToSystemGallery(context: Context, source: Uri): Uri? = try {
  val name = "QuickPhoto_${SimpleDateFormat("yyyyMMdd_HHmmss_SSS", Locale.US).format(Date())}.jpg"
  val values = ContentValues().apply {
    put(MediaStore.Images.Media.DISPLAY_NAME, name)
    put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/Quick Photo")
      put(MediaStore.Images.Media.IS_PENDING, 1)
    }
  }
  val resolver = context.contentResolver
  val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return null
  try {
    copyUri(resolver, source, uri)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      resolver.update(uri, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null)
    }
    uri
  } catch (error: Exception) {
    resolver.delete(uri, null, null)
    throw error
  }
} catch (_: Exception) { null }

private fun copyToAppStorage(context: Context, source: Uri): Uri? = try {
  val folder = File(context.getExternalFilesDir(Environment.DIRECTORY_PICTURES), "Retained").also { it.mkdirs() }
  val target = File(folder, "QuickPhoto_${SimpleDateFormat("yyyyMMdd_HHmmss_SSS", Locale.US).format(Date())}.jpg")
  context.contentResolver.openInputStream(source)?.use { input -> FileOutputStream(target).use(input::copyTo) } ?: return null
  Uri.fromFile(target)
} catch (_: Exception) { null }

private fun copyUri(resolver: ContentResolver, source: Uri, target: Uri) {
  resolver.openInputStream(source)?.use { input ->
    resolver.openOutputStream(target)?.use(input::copyTo) ?: error("Cannot open target")
  } ?: error("Cannot open source")
}

private fun deleteRetainedPhoto(context: Context, uri: Uri) {
  try {
    if (uri.scheme == ContentResolver.SCHEME_CONTENT) context.contentResolver.delete(uri, null, null)
    else if (uri.scheme == ContentResolver.SCHEME_FILE) uri.path?.let(::File)?.delete()
  } catch (_: Exception) { /* A user may have already deleted it from the gallery. */ }
}
