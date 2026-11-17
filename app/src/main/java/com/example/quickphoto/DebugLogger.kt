package com.example.quickphoto

import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Debug-only in-app diagnostic buffer; release builds do not record entries. */
object DebugLogger {
  private const val TAG = "QuickPhoto"
  private val entries = MutableStateFlow<List<String>>(emptyList())
  val logs = entries.asStateFlow()

  fun log(message: String) {
    if (!BuildConfig.DEBUG) return
    Log.d(TAG, message)
    val time = SimpleDateFormat("HH:mm:ss", Locale.US).format(Date())
    entries.value = (entries.value + "$time  $message").takeLast(80)
  }

  fun clear() { if (BuildConfig.DEBUG) entries.value = emptyList() }
}
