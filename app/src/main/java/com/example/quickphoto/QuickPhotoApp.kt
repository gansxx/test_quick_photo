package com.example.quickphoto

import android.app.Activity
import android.app.DownloadManager
import android.content.ClipData
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.TimeUnit

private const val PREFS = "quick_photo_settings"
private const val HOST = "host"
private const val PORT = "port"
private const val CAPTURE_MODE = "capture_mode"
private const val EXTERNAL_CAMERA_COMPONENT = "external_camera_component"
private const val RETENTION_LIMIT = "retention_limit"
private const val RETENTION_LOCATION = "retention_location"
private const val TRANSFER_DEVICE_ID = "transfer_device_id"
private const val RECEIVE_SAVE_LOCATION = "receive_save_location"
private const val GITHUB_RELEASE_URL = "github_release_url"

private data class ExternalCameraApp(val component: ComponentName?, val label: String, val packageName: String? = null) {
  val preferenceValue: String? get() = component?.flattenToString()
}

private fun findExternalCameraApps(context: Context): List<ExternalCameraApp> {
  val packageManager = context.packageManager
  val captureIntent = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
  val installed = packageManager.queryIntentActivities(captureIntent, PackageManager.MATCH_DEFAULT_ONLY)
    .map { info ->
      val activityInfo = info.activityInfo
      ExternalCameraApp(
        ComponentName(activityInfo.packageName, activityInfo.name),
        info.loadLabel(packageManager).toString().ifBlank { activityInfo.packageName },
        activityInfo.packageName
      )
    }
    .distinctBy { it.preferenceValue }
    .sortedBy { it.label.lowercase(Locale.getDefault()) }
  return listOf(ExternalCameraApp(null, "系统默认相机")) + installed
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun QuickPhotoApp(
  onCameraPermissionNeeded: ((() -> Unit) -> Unit),
  onGalleryWritePermissionNeeded: ((onGranted: () -> Unit, onDenied: () -> Unit) -> Unit) = { granted, _ -> granted() }
) {
  val context = LocalContext.current
  val activity = context as? Activity
  val prefs = remember { context.getSharedPreferences(PREFS, Context.MODE_PRIVATE) }
  var host by remember { mutableStateOf(prefs.getString(HOST, "10.0.2.2") ?: "10.0.2.2") }
  var port by remember { mutableStateOf(prefs.getString(PORT, "3000") ?: "3000") }
  var settingsOpen by remember { mutableStateOf(false) }
  var receiverOpen by remember { mutableStateOf(false) }
  var clipboardOpen by remember { mutableStateOf(false) }
  var updateOpen by remember { mutableStateOf(false) }
  var githubReleaseUrl by remember { mutableStateOf(prefs.getString(GITHUB_RELEASE_URL, DEFAULT_GITHUB_RELEASE_URL) ?: DEFAULT_GITHUB_RELEASE_URL) }
  var updateCheckResult by remember { mutableStateOf<UpdateCheckResult?>(null) }
  var updateChecking by remember { mutableStateOf(false) }
  var updateDownloading by remember { mutableStateOf(false) }
  var updateProgress by remember { mutableFloatStateOf(0f) }
  val transferDeviceId = remember { prefs.getString(TRANSFER_DEVICE_ID, null) ?: UUID.randomUUID().toString().also { prefs.edit().putString(TRANSFER_DEVICE_ID, it).apply() } }
  var captureMode by remember { mutableStateOf(CaptureMode.fromPreference(prefs.getString(CAPTURE_MODE, null))) }
  var externalCameraComponent by remember { mutableStateOf(prefs.getString(EXTERNAL_CAMERA_COMPONENT, null)) }
  var retentionLimit by remember { mutableIntStateOf(prefs.getInt(RETENTION_LIMIT, 3).coerceIn(1, 20)) }
  var retentionLocation by remember { mutableStateOf(PhotoRetentionLocation.fromPreference(prefs.getString(RETENTION_LOCATION, null))) }
  var receiveSaveLocation by remember { mutableStateOf(ReceiveSaveLocation.fromPreference(prefs.getString(RECEIVE_SAVE_LOCATION, null))) }
  var testStatus by remember { mutableStateOf<String?>(null) }
  var reviewOpen by remember { mutableStateOf(false) }
  var photoUri by remember { mutableStateOf<Uri?>(null) }
  var photoKind by remember { mutableStateOf("普通照片") }
  var status by remember { mutableStateOf("准备就绪") }
  var debugOpen by remember { mutableStateOf(false) }
  val debugLogs by DebugLogger.logs.collectAsState()
  val scope = rememberCoroutineScope()
  val externalCameraApps = remember { findExternalCameraApps(context) }

  val scannerOptions = remember {
    GmsDocumentScannerOptions.Builder()
      .setGalleryImportAllowed(true)
      .setPageLimit(1)
      .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
      .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
      .build()
  }
  val documentScanner = remember(scannerOptions) { GmsDocumentScanning.getClient(scannerOptions) }

  fun upload(uri: Uri) {
    val config = parseServerConfig(host, port)
    if (config == null) { status = "服务器地址或端口无效"; DebugLogger.log("Upload rejected: invalid server config"); return }
    reviewOpen = false
    status = "正在上传…"
    val endpoint = config.uploadUrl()
    DebugLogger.log("Starting upload to $endpoint")
    scope.launch { status = withContext(Dispatchers.IO) { uploadPhoto(context, uri, endpoint) } }
  }

  fun testServer() {
    val config = parseServerConfig(host, port)
    if (config == null) { testStatus = "请先填写有效的服务器地址和端口"; return }
    testStatus = "正在测试服务器…"
    DebugLogger.log("Testing server at ${config.healthUrl()}")
    scope.launch { testStatus = withContext(Dispatchers.IO) { testServerHealth(config) } }
  }

  val fileUploadLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
    uri?.let {
      val config = parseServerConfig(host, port)
      if (config == null) status = "服务器地址或端口无效" else {
        status = "正在上传文件…"
        scope.launch { status = withContext(Dispatchers.IO) { uploadGenericFile(context, it, "http://${config.host}:${config.port}/api/upload-file") } }
      }
    }
  }

  fun retainCapturedPhoto(uri: Uri) {
    val save: () -> Unit = {
      scope.launch {
        val retainedStatus = withContext(Dispatchers.IO) { retainPhoto(context, uri, retentionLocation, retentionLimit) }
        DebugLogger.log("Photo retention: $retainedStatus")
        if (retainedStatus.contains("失败")) status = "$status；$retainedStatus"
      }
      Unit
    }
    if (retentionLocation == PhotoRetentionLocation.SYSTEM_GALLERY) {
      onGalleryWritePermissionNeeded(save) { status = "$status；未取得相册写入权限，照片未保留" }
    } else save()
  }

  val externalCameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
    if (result.resultCode == Activity.RESULT_OK) {
      photoKind = "普通照片（未增强）"
      status = "拍摄完成，请预览后确认上传"
      reviewOpen = true
      photoUri?.let(::retainCapturedPhoto)
      DebugLogger.log("External camera capture succeeded; waiting for confirmation")
    } else { status = "拍摄已取消"; DebugLogger.log("External camera capture cancelled") }
  }

  val documentScannerLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result ->
    if (result.resultCode == Activity.RESULT_OK) {
      val uri = GmsDocumentScanningResult.fromActivityResultIntent(result.data)?.pages?.firstOrNull()?.imageUri
      if (uri == null) status = "文档扫描未返回图片"
      else {
        photoUri = uri
        photoKind = "文档照片（已裁切和增强）"
        status = "文档处理完成，请预览后确认上传"
        reviewOpen = true
        retainCapturedPhoto(uri)
        DebugLogger.log("Document scan completed; waiting for confirmation")
      }
    } else { status = "文档扫描已取消"; DebugLogger.log("Document scan cancelled") }
  }

  fun startNormalCamera() {
    onCameraPermissionNeeded {
      val file = newPhotoFile(context)
      photoUri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
      val selected = externalCameraApps.firstOrNull { it.preferenceValue == externalCameraComponent }
      val cameraIntent = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
        .putExtra(MediaStore.EXTRA_OUTPUT, photoUri)
      cameraIntent.clipData = ClipData.newRawUri("quick-photo-output", photoUri)
      cameraIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
      if (externalCameraComponent != null && selected != null) {
        cameraIntent.component = selected.component
        DebugLogger.log("Opening selected external camera: ${selected.component?.packageName}")
      } else {
        if (externalCameraComponent != null) DebugLogger.log("Saved external camera is unavailable; using system default")
        DebugLogger.log("Opening default external camera")
      }
      externalCameraLauncher.launch(cameraIntent)
    }
  }

  fun startDocumentScanner() {
    if (activity == null) { status = "无法启动文档扫描器"; return }
    status = "正在启动文档扫描器；首次使用可能需要下载组件…"
    DebugLogger.log("Starting ML Kit document scanner")
    documentScanner.getStartScanIntent(activity)
      .addOnSuccessListener { sender -> documentScannerLauncher.launch(IntentSenderRequest.Builder(sender).build()) }
      .addOnFailureListener { error ->
        status = "文档扫描器不可用：${error.localizedMessage ?: "设备不支持或组件未下载"}"
        DebugLogger.log("Document scanner failed: ${error.javaClass.simpleName}")
      }
  }

  fun checkUpdate(userInitiated: Boolean = true) {
    if (updateChecking) return
    updateChecking = true
    updateCheckResult = null
    if (userInitiated) updateOpen = true
    scope.launch {
      val targetUrl = normalizeGitHubReleaseUrl(githubReleaseUrl)
      DebugLogger.log("Checking update from $targetUrl")
      val result = withContext(Dispatchers.IO) {
        checkGitHubReleaseUpdate(targetUrl, BuildConfig.VERSION_NAME, BuildConfig.DEBUG)
      }
      updateChecking = false
      updateCheckResult = result
      if (!userInitiated && result is UpdateCheckResult.HasUpdate) {
        updateOpen = true
      }
      DebugLogger.log("Update check result: $result")
    }
  }

  fun downloadAndInstall(asset: ReleaseAsset) {
    if (updateDownloading) return
    updateDownloading = true
    updateProgress = 0f
    scope.launch {
      val downloadRes = withContext(Dispatchers.IO) {
        downloadReleaseApk(context, asset) { progress, _, _ ->
          updateProgress = progress
        }
      }
      updateDownloading = false
      downloadRes.fold(
        onSuccess = { file ->
          DebugLogger.log("APK downloaded to ${file.absolutePath}; initiating install")
          val installRes = installDownloadedApk(context, file)
          installRes.onFailure { err ->
            if (err !is UnknownSourcesNeededException) {
              Toast.makeText(context, "启动安装失败：${err.message}", Toast.LENGTH_LONG).show()
            }
          }
        },
        onFailure = { err ->
          Toast.makeText(context, "下载更新失败：${err.message}", Toast.LENGTH_LONG).show()
          DebugLogger.log("APK download failed: ${err.message}")
        }
      )
    }
  }

  fun startSelectedCapture() {
    when (captureMode) {
      CaptureMode.NORMAL -> startNormalCamera()
      CaptureMode.DOCUMENT -> startDocumentScanner()
    }
  }

  Scaffold(topBar = { TopAppBar(title = { Text("Quick Photo") }, actions = {
    TextButton(onClick = { clipboardOpen = true }) { Text("剪贴板") }
    TextButton(onClick = { receiverOpen = true }) { Text("接收文件") }
    TextButton(onClick = { settingsOpen = true }) { Text("设置") }
  }) }) { padding ->
    Column(
      modifier = Modifier.padding(padding).padding(24.dp).fillMaxSize().verticalScroll(rememberScrollState()),
      verticalArrangement = Arrangement.spacedBy(18.dp), horizontalAlignment = Alignment.CenterHorizontally
    ) {
      Text("拍摄、预览、再上传", style = MaterialTheme.typography.headlineMedium)
      Text("当前拍摄方式：${captureMode.label}", style = MaterialTheme.typography.bodyMedium)
      Text("上传地址：http://$host:$port/api/upload", style = MaterialTheme.typography.bodySmall)
      Button(onClick = ::startSelectedCapture, modifier = Modifier.fillMaxWidth().height(58.dp).semantics(mergeDescendants = true) { }) { Text("开始拍摄") }
      HorizontalDivider()
      Text(status, style = MaterialTheme.typography.bodyLarge)
      OutlinedButton(onClick = {
        status = "正在搜索局域网服务器…"; DebugLogger.log("Broadcasting server discovery request")
        scope.launch {
          val server = discoverServer(context)
          if (server == null) { status = "未发现服务器；请确认服务端已运行，并与手机在同一局域网"; DebugLogger.log("Discovery timed out") }
          else { host = server.host; port = server.port.toString(); prefs.edit().putString(HOST, host).putString(PORT, port).apply(); status = "已发现服务器：${server.host}:${server.port}"; DebugLogger.log("Discovered ${server.host}:${server.port}") }
        }
      }, modifier = Modifier.fillMaxWidth()) { Text("自动发现局域网服务器") }
      OutlinedButton(onClick = { settingsOpen = true }, modifier = Modifier.fillMaxWidth()) { Text("修改服务器与更新设置") }
      OutlinedButton(onClick = { clipboardOpen = true }, modifier = Modifier.fillMaxWidth()) { Text("剪贴板互传") }
      OutlinedButton(onClick = { fileUploadLauncher.launch(arrayOf("*/*")) }, modifier = Modifier.fillMaxWidth()) { Text("选择文件并发送到服务器") }
      OutlinedButton(onClick = { checkUpdate(true) }, modifier = Modifier.fillMaxWidth()) { Text("检查应用更新 (v${BuildConfig.VERSION_NAME})") }
      if (BuildConfig.DEBUG) OutlinedButton(onClick = { debugOpen = true }, modifier = Modifier.fillMaxWidth()) { Text("调试日志") }
    }
  }

  if (reviewOpen && photoUri != null) PhotoReviewDialog(photoUri!!, photoKind, { photoUri = it }, { upload(photoUri!!) }, { reviewOpen = false; startSelectedCapture() }, { reviewOpen = false; status = "已取消上传" })
  if (settingsOpen) ServerSettingsDialog(host, port, captureMode, externalCameraApps, externalCameraComponent, retentionLimit, retentionLocation, receiveSaveLocation, githubReleaseUrl, testStatus, { host = it }, { port = it.filter(Char::isDigit) }, { captureMode = it }, { externalCameraComponent = it }, { retentionLimit = it }, { retentionLocation = it }, { receiveSaveLocation = it }, { githubReleaseUrl = it }, ::testServer, { checkUpdate(true) }, {
    val editor = prefs.edit().putString(HOST, host).putString(PORT, port).putString(CAPTURE_MODE, captureMode.preferenceValue)
    if (externalCameraComponent == null) editor.remove(EXTERNAL_CAMERA_COMPONENT) else editor.putString(EXTERNAL_CAMERA_COMPONENT, externalCameraComponent)
    editor.putInt(RETENTION_LIMIT, retentionLimit).putString(RETENTION_LOCATION, retentionLocation.preferenceValue).putString(RECEIVE_SAVE_LOCATION, receiveSaveLocation.preferenceValue).putString(GITHUB_RELEASE_URL, githubReleaseUrl)
    editor.apply()
    scope.launch(Dispatchers.IO) { trimRetainedPhotos(context, retentionLimit) }
    settingsOpen = false
    Toast.makeText(context, "设置已保存", Toast.LENGTH_SHORT).show()
  }, { settingsOpen = false })
  if (BuildConfig.DEBUG && debugOpen) DebugLogDialog(debugLogs, { debugOpen = false })
  if (receiverOpen) FileReceiverDialog(host, port, transferDeviceId, Build.MODEL ?: "Android", receiveSaveLocation, { receiverOpen = false })
  if (clipboardOpen) ClipboardDialog(host, port, { clipboardOpen = false })
  if (updateOpen) UpdateDialog(updateCheckResult, updateChecking, updateDownloading, updateProgress, { checkUpdate(true) }, ::downloadAndInstall, { url ->
    try {
      context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (_: Exception) {
      Toast.makeText(context, "无法打开浏览器", Toast.LENGTH_SHORT).show()
    }
  }, { updateOpen = false })
}

@Composable
private fun FileReceiverDialog(host: String, port: String, deviceId: String, deviceName: String, saveLocation: ReceiveSaveLocation, onDismiss: () -> Unit) {
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  var files by remember { mutableStateOf<List<RemoteDelivery>>(emptyList()) }
  var status by remember { mutableStateOf("可测试连接后刷新服务器文件列表") }
  fun configOrNull() = parseServerConfig(host, port)
  fun refresh() {
    val config = configOrNull() ?: run { status = "服务器地址或端口无效"; return }
    status = "正在读取文件列表…"
    scope.launch {
      val result = withContext(Dispatchers.IO) { heartbeatAndFetchInbox(config, deviceId, deviceName) }
      result.fold({ received -> files = received; status = "已读取 ${received.size} 个文件" }, { error -> status = "读取失败：${error.message ?: "网络错误"}" })
    }
  }
  LaunchedEffect(host, port, deviceId) {
    refresh()
    while (true) {
      configOrNull()?.let { config -> withContext(Dispatchers.IO) { waitForServerNotification(config, deviceId) } } ?: delay(5_000)
      refresh()
    }
  }
  AlertDialog(
    onDismissRequest = onDismiss,
    title = { Text("接收服务器文件") },
    text = {
      Column(modifier = Modifier.fillMaxWidth().heightIn(max = 460.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text("服务器：http://$host:$port", style = MaterialTheme.typography.bodySmall)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          OutlinedButton(onClick = {
            val config = configOrNull()
            if (config == null) status = "服务器地址或端口无效" else {
              status = "正在测试连接…"
              scope.launch { status = withContext(Dispatchers.IO) { testServerHealth(config) } }
            }
          }, modifier = Modifier.weight(1f)) { Text("测试连接") }
          Button(onClick = ::refresh, modifier = Modifier.weight(1f)) { Text("刷新文件") }
        }
        Text(status, style = MaterialTheme.typography.bodySmall)
        files.forEach { file ->
          HorizontalDivider()
          Text(file.name, style = MaterialTheme.typography.bodyMedium)
          Text("${formatFileBytes(file.bytes)} · ${file.contentType}", style = MaterialTheme.typography.bodySmall)
          Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            OutlinedButton(onClick = {
              val config = configOrNull() ?: return@OutlinedButton
              status = "正在接收 ${file.name}…"
              scope.launch { status = withContext(Dispatchers.IO) { downloadDelivery(context, config, deviceId, file, saveLocation) } }
            }, modifier = Modifier.weight(1f)) { Text("接收并保存") }
            if (file.contentType.startsWith("text/") || file.name.endsWith(".txt", ignoreCase = true) || file.name.contains("clipboard", ignoreCase = true)) {
              OutlinedButton(onClick = {
                val config = configOrNull() ?: return@OutlinedButton
                status = "正在读取文本…"
                scope.launch {
                  val text = withContext(Dispatchers.IO) { readDeliveryText(config, deviceId, file) }
                  if (text != null) {
                    setSystemClipboardText(context, text)
                    status = "已复制到手机剪贴板"
                    Toast.makeText(context, "已复制到剪贴板", Toast.LENGTH_SHORT).show()
                  } else {
                    status = "读取文本失败"
                  }
                }
              }, modifier = Modifier.weight(1f)) { Text("复制文本") }
            }
          }
        }
        OutlinedButton(onClick = { openReceiveFolder(context, saveLocation) }, modifier = Modifier.fillMaxWidth()) { Text("快速打开保存文件夹") }
        if (files.isEmpty()) Text("刷新后将在这里显示服务器已接收的文件。", style = MaterialTheme.typography.bodySmall)
      }
    },
    confirmButton = { TextButton(onClick = onDismiss) { Text("关闭") } }
  )
}

private fun readDeliveryText(config: ServerConfig, deviceId: String, file: RemoteDelivery): String? = try {
  val deliveryUrl = "http://${config.host}:${config.port}/api/devices/${Uri.encode(deviceId)}/inbox/${Uri.encode(file.token)}"
  OkHttpClient().newCall(Request.Builder().url(deliveryUrl).get().build()).execute().use { response ->
    if (response.isSuccessful) response.body?.string() else null
  }
} catch (_: Exception) { null }

@Composable
private fun ClipboardDialog(
  host: String,
  port: String,
  onDismiss: () -> Unit
) {
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  var serverClipboardText by remember { mutableStateOf<String?>(null) }
  var localText by remember { mutableStateOf(getSystemClipboardText(context) ?: "") }
  var status by remember { mutableStateOf<String?>(null) }
  var loading by remember { mutableStateOf(false) }

  val config = parseServerConfig(host, port)

  fun fetchServer() {
    if (config == null) { status = "服务器配置无效"; return }
    loading = true
    status = "正在拉取服务器剪贴板…"
    scope.launch {
      val res = withContext(Dispatchers.IO) { fetchClipboardFromServer(config) }
      loading = false
      res.fold(
        onSuccess = {
          serverClipboardText = it
          status = "已读取服务器剪贴板"
        },
        onFailure = {
          status = "获取失败：${it.message}"
        }
      )
    }
  }

  fun sendToServer() {
    if (config == null) { status = "服务器配置无效"; return }
    if (localText.isBlank()) { status = "发送内容不能为空"; return }
    loading = true
    status = "正在发送到服务器…"
    scope.launch {
      val res = withContext(Dispatchers.IO) {
        sendClipboardToServer(config, localText, Build.MODEL ?: "Android")
      }
      loading = false
      res.fold(
        onSuccess = {
          status = "发送成功！"
          Toast.makeText(context, "已发送至服务器剪贴板", Toast.LENGTH_SHORT).show()
        },
        onFailure = {
          status = "发送失败：${it.message}"
        }
      )
    }
  }

  LaunchedEffect(Unit) {
    if (config != null) {
      fetchServer()
    }
  }

  AlertDialog(
    onDismissRequest = onDismiss,
    title = { Text("剪贴板互传") },
    text = {
      Column(
        modifier = Modifier.fillMaxWidth().heightIn(max = 480.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp)
      ) {
        Text("发送到服务器", style = MaterialTheme.typography.titleSmall)
        OutlinedTextField(
          value = localText,
          onValueChange = { localText = it },
          label = { Text("要发送的内容") },
          modifier = Modifier.fillMaxWidth().heightIn(min = 90.dp, max = 160.dp),
          supportingText = { Text("已填入手机当前剪贴板，可编辑后发送") }
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
          OutlinedButton(onClick = {
            val clip = getSystemClipboardText(context) ?: ""
            localText = clip
            Toast.makeText(context, if (clip.isEmpty()) "手机剪贴板暂无文字" else "已重新读取手机剪贴板", Toast.LENGTH_SHORT).show()
          }, modifier = Modifier.weight(1f)) {
            Text("重新读取手机")
          }
          Button(onClick = ::sendToServer, modifier = Modifier.weight(1f), enabled = !loading) {
            Text("发送到服务器")
          }
        }

        HorizontalDivider()

        Text("服务器最新剪贴板", style = MaterialTheme.typography.titleSmall)
        if (serverClipboardText != null) {
          Surface(
            color = MaterialTheme.colorScheme.surfaceVariant,
            shape = MaterialTheme.shapes.small,
            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)
          ) {
            Text(
              serverClipboardText!!,
              modifier = Modifier.padding(12.dp),
              style = MaterialTheme.typography.bodyMedium
            )
          }
          Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            OutlinedButton(onClick = ::fetchServer, modifier = Modifier.weight(1f), enabled = !loading) {
              Text("刷新")
            }
            Button(onClick = {
              serverClipboardText?.let {
                setSystemClipboardText(context, it)
                Toast.makeText(context, "已复制到手机剪贴板", Toast.LENGTH_SHORT).show()
              }
            }, modifier = Modifier.weight(1f)) {
              Text("复制到手机")
            }
          }
        } else {
          Text("暂无服务器剪贴板数据", style = MaterialTheme.typography.bodySmall)
          OutlinedButton(onClick = ::fetchServer, modifier = Modifier.fillMaxWidth(), enabled = !loading) {
            Text("拉取服务器剪贴板")
          }
        }

        status?.let {
          Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary)
        }
      }
    },
    confirmButton = { TextButton(onClick = onDismiss) { Text("完成") } }
  )
}

@Composable
private fun UpdateDialog(
  checkResult: UpdateCheckResult?,
  checking: Boolean,
  downloading: Boolean,
  downloadProgress: Float,
  onCheckAgain: () -> Unit,
  onDownloadAndInstall: (ReleaseAsset) -> Unit,
  onOpenReleaseUrl: (String) -> Unit,
  onDismiss: () -> Unit
) {
  AlertDialog(
    onDismissRequest = onDismiss,
    title = {
      Text(
        when (checkResult) {
          is UpdateCheckResult.HasUpdate -> "发现新版本：${checkResult.release.tagName}"
          is UpdateCheckResult.UpToDate -> "已是最新版本"
          is UpdateCheckResult.Error -> "检查更新失败"
          null -> if (checking) "正在检查更新…" else "应用更新"
        }
      )
    },
    text = {
      Column(
        modifier = Modifier.fillMaxWidth().heightIn(max = 440.dp).verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(10.dp)
      ) {
        if (checking) {
          Box(Modifier.fillMaxWidth().height(100.dp), contentAlignment = Alignment.Center) {
            CircularProgressIndicator()
          }
          Text("正在连接 GitHub 获取最新 Release 信息…", style = MaterialTheme.typography.bodySmall)
        } else when (checkResult) {
          is UpdateCheckResult.HasUpdate -> {
            val rel = checkResult.release
            Text("当前版本：v${checkResult.currentVersion} → 最新版本：${rel.tagName}", style = MaterialTheme.typography.bodyMedium)
            if (rel.title.isNotBlank() && rel.title != rel.tagName) {
              Text(rel.title, style = MaterialTheme.typography.titleSmall)
            }
            if (rel.apkAsset != null) {
              Text("更新包：${rel.apkAsset.name}（${formatFileBytes(rel.apkAsset.size)}）", style = MaterialTheme.typography.bodySmall)
            } else {
              Text("提示：该 Release 尚未包含 APK 安装包", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
            }

            HorizontalDivider()
            Text("更新说明：", style = MaterialTheme.typography.titleSmall)
            Surface(
              color = MaterialTheme.colorScheme.surfaceVariant,
              shape = MaterialTheme.shapes.small,
              modifier = Modifier.fillMaxWidth()
            ) {
              Text(
                rel.changelog.ifBlank { "暂无更新说明" },
                modifier = Modifier.padding(10.dp),
                style = MaterialTheme.typography.bodySmall
              )
            }

            if (downloading) {
              Spacer(Modifier.height(8.dp))
              Text("正在下载更新包… ${(downloadProgress * 100).toInt()}%", style = MaterialTheme.typography.bodySmall)
              LinearProgressIndicator(progress = { downloadProgress }, modifier = Modifier.fillMaxWidth())
            }
          }
          is UpdateCheckResult.UpToDate -> {
            Text("当前已安装最新版本：v${checkResult.version}，暂无可用更新。", style = MaterialTheme.typography.bodyMedium)
          }
          is UpdateCheckResult.Error -> {
            Text(checkResult.message, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
            Text("请检查网络连接或在设置中核对 GitHub Release 仓库地址。", style = MaterialTheme.typography.bodySmall)
          }
          null -> {
            Text("点击下方按钮检查 GitHub Release 最新版本。", style = MaterialTheme.typography.bodyMedium)
          }
        }
      }
    },
    confirmButton = {
      if (checkResult is UpdateCheckResult.HasUpdate && checkResult.release.apkAsset != null) {
        Button(
          onClick = { onDownloadAndInstall(checkResult.release.apkAsset) },
          enabled = !downloading
        ) {
          Text(if (downloading) "正在下载…" else "下载并安装")
        }
      } else if (checkResult is UpdateCheckResult.Error) {
        Button(onClick = onCheckAgain, enabled = !checking) {
          Text("重试")
        }
      } else {
        TextButton(onClick = onDismiss) { Text("关闭") }
      }
    },
    dismissButton = {
      if (checkResult is UpdateCheckResult.HasUpdate) {
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
          TextButton(onClick = { onOpenReleaseUrl(checkResult.release.htmlUrl) }) {
            Text("浏览器查看")
          }
          TextButton(onClick = onDismiss, enabled = !downloading) {
            Text("暂不更新")
          }
        }
      } else if (checkResult != null) {
        TextButton(onClick = onDismiss) { Text("取消") }
      }
    }
  )
}

@Composable
private fun PhotoReviewDialog(uri: Uri, label: String, onCropped: (Uri) -> Unit, onUpload: () -> Unit, onRetake: () -> Unit, onDismiss: () -> Unit) {
  val context = LocalContext.current
  val scope = rememberCoroutineScope()
  var bitmap by remember(uri) { mutableStateOf<Bitmap?>(null) }
  var cropOpen by remember { mutableStateOf(false) }
  LaunchedEffect(uri) { bitmap = withContext(Dispatchers.IO) { decodePreview(context, uri) } }
  AlertDialog(onDismissRequest = onDismiss, title = { Text("效果预览") },
    text = { Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
      Text(label)
      bitmap?.let { Image(it.asImageBitmap(), "待上传图片预览", Modifier.fillMaxWidth().heightIn(max = 420.dp), contentScale = ContentScale.Fit) }
        ?: Box(Modifier.fillMaxWidth().height(180.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
      Text("确认后才会发送到服务器。", style = MaterialTheme.typography.bodySmall)
      OutlinedButton(onClick = { cropOpen = true }, modifier = Modifier.fillMaxWidth(), enabled = bitmap != null) { Text("矩形裁剪") }
      OutlinedButton(onClick = onRetake, modifier = Modifier.fillMaxWidth()) { Text("按当前设置重新拍摄") }
    } }, confirmButton = { Button(onClick = onUpload) { Text("确认并上传") } }, dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } }
  )
  if (cropOpen) RectangleCropDialog(uri, { left, top, right, bottom ->
    cropOpen = false
    scope.launch {
      val cropped = withContext(Dispatchers.IO) { cropPhoto(context, uri, left, top, right, bottom) }
      if (cropped != null) onCropped(cropped) else Toast.makeText(context, "裁剪失败，请重试", Toast.LENGTH_SHORT).show()
    }
  }, { cropOpen = false })
}

@Composable
private fun RectangleCropDialog(
  uri: Uri,
  onApply: (Float, Float, Float, Float) -> Unit,
  onDismiss: () -> Unit
) {
  val context = LocalContext.current
  var preview by remember(uri) { mutableStateOf<Bitmap?>(null) }
  var left by remember { mutableFloatStateOf(0f) }
  var top by remember { mutableFloatStateOf(0f) }
  var right by remember { mutableFloatStateOf(1f) }
  var bottom by remember { mutableFloatStateOf(1f) }
  LaunchedEffect(uri) { preview = withContext(Dispatchers.IO) { decodePreview(context, uri) } }
  AlertDialog(
    onDismissRequest = onDismiss,
    title = { Text("矩形裁剪") },
    text = {
      Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.verticalScroll(rememberScrollState())) {
        preview?.let {
          DraggableCropPreview(it, left, top, right, bottom, { l, t, r, b -> left = l; top = t; right = r; bottom = b })
        } ?: Box(Modifier.fillMaxWidth().height(180.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        Text("拖动方框内部可移动裁剪区域；拖动白色边框可调整矩形大小。", style = MaterialTheme.typography.bodySmall)
      }
    },
    confirmButton = { Button(onClick = { onApply(left, top, right, bottom) }) { Text("应用裁剪") } },
    dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } }
  )
}

@Composable
private fun DraggableCropPreview(
  bitmap: Bitmap,
  left: Float,
  top: Float,
  right: Float,
  bottom: Float,
  onCropChange: (Float, Float, Float, Float) -> Unit
) {
  var canvasSize by remember { mutableStateOf(IntSize.Zero) }
  var dragMode by remember { mutableStateOf(CropDragMode.MOVE) }
  val currentCrop by rememberUpdatedState(CropRect(left, top, right, bottom))
  val currentOnCropChange by rememberUpdatedState(onCropChange)
  val ratio = bitmap.width.toFloat() / bitmap.height.coerceAtLeast(1)
  Box(Modifier.fillMaxWidth().aspectRatio(ratio).onSizeChanged { canvasSize = it }) {
    Image(bitmap.asImageBitmap(), "可拖动的矩形裁剪框", Modifier.fillMaxSize(), contentScale = ContentScale.FillBounds)
    Canvas(Modifier.fillMaxSize().pointerInput(Unit) {
      detectDragGestures(
        onDragStart = { point ->
          val crop = currentCrop
          dragMode = cropDragMode(point, canvasSize, crop.left, crop.top, crop.right, crop.bottom)
        },
        onDrag = { change, amount ->
          change.consume()
          if (canvasSize.width == 0 || canvasSize.height == 0) return@detectDragGestures
          val dx = amount.x / canvasSize.width
          val dy = amount.y / canvasSize.height
          val minSize = .08f
          val crop = currentCrop
          when (dragMode) {
            CropDragMode.MOVE -> {
              val width = crop.right - crop.left; val height = crop.bottom - crop.top
              val nextLeft = (crop.left + dx).coerceIn(0f, 1f - width)
              val nextTop = (crop.top + dy).coerceIn(0f, 1f - height)
              currentOnCropChange(nextLeft, nextTop, nextLeft + width, nextTop + height)
            }
            CropDragMode.LEFT -> currentOnCropChange((crop.left + dx).coerceIn(0f, crop.right - minSize), crop.top, crop.right, crop.bottom)
            CropDragMode.RIGHT -> currentOnCropChange(crop.left, crop.top, (crop.right + dx).coerceIn(crop.left + minSize, 1f), crop.bottom)
            CropDragMode.TOP -> currentOnCropChange(crop.left, (crop.top + dy).coerceIn(0f, crop.bottom - minSize), crop.right, crop.bottom)
            CropDragMode.BOTTOM -> currentOnCropChange(crop.left, crop.top, crop.right, (crop.bottom + dy).coerceIn(crop.top + minSize, 1f))
          }
        }
      )
    }) {
      val width = size.width * (right - left)
      val height = size.height * (bottom - top)
      val x = size.width * left
      val y = size.height * top
      val shade = Color.Black.copy(alpha = .35f)
      drawRect(shade, size = Size(size.width, y))
      drawRect(shade, topLeft = Offset(0f, y + height), size = Size(size.width, size.height - y - height))
      drawRect(shade, topLeft = Offset(0f, y), size = Size(x, height))
      drawRect(shade, topLeft = Offset(x + width, y), size = Size(size.width - x - width, height))
      drawRect(Color.White, topLeft = Offset(x, y), size = Size(width, height), style = androidx.compose.ui.graphics.drawscope.Stroke(width = 4.dp.toPx()))
    }
  }
}

private enum class CropDragMode { MOVE, LEFT, TOP, RIGHT, BOTTOM }
private data class CropRect(val left: Float, val top: Float, val right: Float, val bottom: Float)

private fun cropDragMode(point: Offset, size: IntSize, left: Float, top: Float, right: Float, bottom: Float): CropDragMode {
  if (size.width == 0 || size.height == 0) return CropDragMode.MOVE
  val x = point.x / size.width
  val y = point.y / size.height
  val edge = .06f
  return when {
    kotlin.math.abs(x - left) < edge -> CropDragMode.LEFT
    kotlin.math.abs(x - right) < edge -> CropDragMode.RIGHT
    kotlin.math.abs(y - top) < edge -> CropDragMode.TOP
    kotlin.math.abs(y - bottom) < edge -> CropDragMode.BOTTOM
    else -> CropDragMode.MOVE
  }
}

@Composable
private fun ServerSettingsDialog(
  host: String,
  port: String,
  mode: CaptureMode,
  externalCameraApps: List<ExternalCameraApp>,
  externalCameraComponent: String?,
  retentionLimit: Int,
  retentionLocation: PhotoRetentionLocation,
  receiveSaveLocation: ReceiveSaveLocation,
  githubReleaseUrl: String,
  testStatus: String?,
  onHost: (String) -> Unit,
  onPort: (String) -> Unit,
  onMode: (CaptureMode) -> Unit,
  onExternalCamera: (String?) -> Unit,
  onRetentionLimit: (Int) -> Unit,
  onRetentionLocation: (PhotoRetentionLocation) -> Unit,
  onReceiveSaveLocation: (ReceiveSaveLocation) -> Unit,
  onGithubReleaseUrl: (String) -> Unit,
  onTest: () -> Unit,
  onCheckUpdate: () -> Unit,
  onSave: () -> Unit,
  onDismiss: () -> Unit
) = AlertDialog(
  onDismissRequest = onDismiss, title = { Text("应用与服务器设置") }, text = {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.verticalScroll(rememberScrollState())) {
      Text("默认拍摄方式", style = MaterialTheme.typography.titleSmall)
      CaptureMode.entries.forEach { option ->
        Row(verticalAlignment = Alignment.CenterVertically) {
          RadioButton(selected = mode == option, onClick = { onMode(option) })
          Text(option.label, modifier = Modifier.padding(start = 8.dp))
        }
      }
      if (mode == CaptureMode.NORMAL) {
        HorizontalDivider()
        Text("普通相机应用", style = MaterialTheme.typography.titleSmall)
        Text("拍摄时会直接使用此处保存的应用。", style = MaterialTheme.typography.bodySmall)
        externalCameraApps.forEach { option ->
          Row(verticalAlignment = Alignment.CenterVertically) {
            RadioButton(selected = externalCameraComponent == option.preferenceValue, onClick = { onExternalCamera(option.preferenceValue) })
            Column(modifier = Modifier.padding(start = 8.dp)) {
              Text(option.label)
              option.packageName?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
            }
          }
        }
      }
      HorizontalDivider()
      Text("拍摄照片保留", style = MaterialTheme.typography.titleSmall)
      Text("仅保留本应用拍摄后创建的副本，达到数量后自动删除最早的一张。", style = MaterialTheme.typography.bodySmall)
      Text("保留张数：$retentionLimit 张")
      Slider(value = retentionLimit.toFloat(), onValueChange = { onRetentionLimit(it.toInt().coerceIn(1, 20)) }, valueRange = 1f..20f, steps = 18)
      PhotoRetentionLocation.entries.forEach { option ->
        Row(verticalAlignment = Alignment.CenterVertically) {
          RadioButton(selected = retentionLocation == option, onClick = { onRetentionLocation(option) })
          Column(modifier = Modifier.padding(start = 8.dp)) {
            Text(option.label)
            Text(if (option == PhotoRetentionLocation.SYSTEM_GALLERY) "默认；会请求相册写入权限（Android 10 及以上无需此权限）。" else "仅本应用可见，无需相册权限。", style = MaterialTheme.typography.bodySmall)
          }
        }
      }
      HorizontalDivider()
      Text("接收文件保存位置", style = MaterialTheme.typography.titleSmall)
      ReceiveSaveLocation.entries.forEach { option ->
        Row(verticalAlignment = Alignment.CenterVertically) {
          RadioButton(selected = receiveSaveLocation == option, onClick = { onReceiveSaveLocation(option) })
          Column(modifier = Modifier.padding(start = 8.dp)) {
            Text(option.label)
            Text(if (option == ReceiveSaveLocation.SYSTEM_DOWNLOADS) "默认；保存到系统 Downloads/Quick Photo，可从接收页快速打开。" else "仅应用可见，适合不希望其他应用访问的文件。", style = MaterialTheme.typography.bodySmall)
          }
        }
      }
      HorizontalDivider()
      Text("HTTP 服务器", style = MaterialTheme.typography.titleSmall)
      OutlinedTextField(host, onHost, label = { Text("IP 地址或主机名") }, singleLine = true)
      OutlinedTextField(port, onPort, label = { Text("端口") }, singleLine = true, keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = KeyboardType.Number))
      OutlinedButton(onClick = onTest, modifier = Modifier.fillMaxWidth()) { Text("测试服务器连接") }
      testStatus?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
      HorizontalDivider()
      Text("应用内部更新", style = MaterialTheme.typography.titleSmall)
      Text("当前版本：v${BuildConfig.VERSION_NAME} (Build ${BuildConfig.VERSION_CODE})", style = MaterialTheme.typography.bodySmall)
      OutlinedTextField(
        value = githubReleaseUrl,
        onValueChange = onGithubReleaseUrl,
        label = { Text("GitHub Release 地址或仓库名") },
        placeholder = { Text("例如 gansxx/quick_photo") },
        singleLine = true,
        modifier = Modifier.fillMaxWidth()
      )
      OutlinedButton(onClick = onCheckUpdate, modifier = Modifier.fillMaxWidth()) { Text("立即检查更新") }
    }
  }, confirmButton = { TextButton(onClick = onSave) { Text("保存") } }, dismissButton = { TextButton(onClick = onDismiss) { Text("取消") } }
)

@Composable
private fun DebugLogDialog(logs: List<String>, onDismiss: () -> Unit) = AlertDialog(
  onDismissRequest = onDismiss, title = { Text("调试日志") },
  text = { Text(if (logs.isEmpty()) "暂无日志" else logs.joinToString("\n"), modifier = Modifier.fillMaxWidth().heightIn(max = 360.dp).verticalScroll(rememberScrollState())) },
  confirmButton = { TextButton(onClick = onDismiss) { Text("关闭") } }, dismissButton = { TextButton(onClick = { DebugLogger.clear() }) { Text("清空") } }
)

private fun decodePreview(context: Context, uri: Uri): Bitmap? = try {
  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri)) { decoder, info, _ ->
    val longest = maxOf(info.size.width, info.size.height)
    if (longest > 1600) decoder.setTargetSampleSize((longest / 1600).coerceAtLeast(1))
  } else context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it) }
} catch (_: Exception) { null }

private fun newPhotoFile(context: Context): File {
  val folder = context.getExternalFilesDir(Environment.DIRECTORY_PICTURES)!!.also { it.mkdirs() }
  val stamp = SimpleDateFormat("yyyyMMdd_HHmmss_SSS", Locale.US).format(Date())
  return File(folder, "quick_photo_$stamp.jpg")
}

private fun cropPhoto(context: Context, uri: Uri, left: Float, top: Float, right: Float, bottom: Float): Uri? = try {
  val original = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
    ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri))
  } else {
    context.contentResolver.openInputStream(uri)?.use(BitmapFactory::decodeStream)
  } ?: return null
  val x = (original.width * left).toInt().coerceIn(0, original.width - 1)
  val y = (original.height * top).toInt().coerceIn(0, original.height - 1)
  val width = (original.width * right).toInt().coerceIn(x + 1, original.width) - x
  val height = (original.height * bottom).toInt().coerceIn(y + 1, original.height) - y
  val cropped = Bitmap.createBitmap(original, x, y, width, height)
  if (cropped !== original) original.recycle()
  val output = newPhotoFile(context)
  FileOutputStream(output).use { stream ->
    if (!cropped.compress(Bitmap.CompressFormat.JPEG, 95, stream)) return null
  }
  cropped.recycle()
  FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", output)
} catch (_: Exception) { null }

private data class RemoteDelivery(val token: String, val name: String, val bytes: Long, val contentType: String)

private fun heartbeatAndFetchInbox(config: ServerConfig, deviceId: String, deviceName: String): Result<List<RemoteDelivery>> = runCatching {
  val json = "{\"id\":${org.json.JSONObject.quote(deviceId)},\"name\":${org.json.JSONObject.quote(deviceName)}}"
  val jsonBody = json.toRequestBody("application/json".toMediaType())
  OkHttpClient().newCall(Request.Builder().url("http://${config.host}:${config.port}/api/devices").post(jsonBody).build()).execute().use { response ->
    if (!response.isSuccessful) error("设备登记 HTTP ${response.code}")
  }
  OkHttpClient().newCall(Request.Builder().url("http://${config.host}:${config.port}/api/devices/${Uri.encode(deviceId)}/inbox").get().build()).execute().use { response ->
    if (!response.isSuccessful) error("HTTP ${response.code}")
    val entries = org.json.JSONObject(response.body?.string().orEmpty()).getJSONArray("deliveries")
    List(entries.length()) { index ->
      val item = entries.getJSONObject(index)
      RemoteDelivery(item.getString("token"), item.getString("filename"), item.getLong("bytes"), item.optString("contentType", "application/octet-stream"))
    }
  }
}

private fun downloadDelivery(context: Context, config: ServerConfig, deviceId: String, file: RemoteDelivery, saveLocation: ReceiveSaveLocation): String = try {
  val safeName = file.name.substringAfterLast('/').substringAfterLast('\\').replace(Regex("[^a-zA-Z0-9._-]"), "_")
  if (safeName.isBlank()) return "接收失败：文件名无效"
  val deliveryUrl = "http://${config.host}:${config.port}/api/devices/${Uri.encode(deviceId)}/inbox/${Uri.encode(file.token)}"
  val bytes = OkHttpClient().newCall(Request.Builder().url(deliveryUrl).get().build()).execute().use { response ->
    if (!response.isSuccessful) return "接收失败：HTTP ${response.code}"
    response.body?.bytes() ?: return "接收失败：空响应"
  }
  val saved = saveReceivedFile(context, safeName, file.contentType, bytes, saveLocation) ?: return "接收失败：无法写入保存位置"
  OkHttpClient().newCall(Request.Builder().url(deliveryUrl).delete().build()).execute().close()
  "已保存到${saved}"
} catch (error: Exception) { "接收失败：${error.message ?: "网络错误"}" }

private fun saveReceivedFile(context: Context, name: String, contentType: String, bytes: ByteArray, location: ReceiveSaveLocation): String? = try {
  if (location == ReceiveSaveLocation.SYSTEM_DOWNLOADS && Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
    val values = android.content.ContentValues().apply {
      put(MediaStore.Downloads.DISPLAY_NAME, name)
      put(MediaStore.Downloads.MIME_TYPE, contentType)
      put(MediaStore.Downloads.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/Quick Photo")
      put(MediaStore.Downloads.IS_PENDING, 1)
    }
    val resolver = context.contentResolver
    val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return null
    try {
      resolver.openOutputStream(uri)?.use { it.write(bytes) } ?: return null
      resolver.update(uri, android.content.ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
      "系统下载/Quick Photo/$name"
    } catch (error: Exception) { resolver.delete(uri, null, null); throw error }
  } else {
    val folder = File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "Received").also { it.mkdirs() }
    FileOutputStream(File(folder, name)).use { it.write(bytes) }
    "应用专属存储/$name"
  }
} catch (_: Exception) { null }

private fun openReceiveFolder(context: Context, location: ReceiveSaveLocation) {
  try {
    when (location) {
      ReceiveSaveLocation.SYSTEM_DOWNLOADS -> context.startActivity(Intent(DownloadManager.ACTION_VIEW_DOWNLOADS))
      ReceiveSaveLocation.APP_STORAGE -> context.startActivity(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
    }
  } catch (_: Exception) { Toast.makeText(context, "无法打开文件管理器", Toast.LENGTH_SHORT).show() }
}

private fun waitForServerNotification(config: ServerConfig, deviceId: String): Boolean = try {
  val url = "http://${config.host}:${config.port}/api/devices/${Uri.encode(deviceId)}/events"
  OkHttpClient.Builder().readTimeout(35, TimeUnit.SECONDS).build()
    .newCall(Request.Builder().url(url).get().build()).execute().use { response ->
      response.isSuccessful && org.json.JSONObject(response.body?.string().orEmpty()).optBoolean("hasUpdates")
    }
} catch (_: Exception) { false }

private fun formatFileBytes(bytes: Long): String =
  if (bytes < 1024 * 1024) "${(bytes + 1023) / 1024} KB" else String.format(Locale.US, "%.2f MB", bytes / 1024f / 1024f)

private fun uploadGenericFile(context: Context, uri: Uri, endpoint: String): String = try {
  val name = queryDisplayName(context, uri) ?: "upload.bin"
  val temp = File.createTempFile("upload_", "_${name.takeLast(40)}", context.cacheDir)
  context.contentResolver.openInputStream(uri)?.use { input -> temp.outputStream().use(input::copyTo) } ?: return "无法读取文件"
  val type = context.contentResolver.getType(uri) ?: "application/octet-stream"
  val body = MultipartBody.Builder().setType(MultipartBody.FORM)
    .addFormDataPart("file", name, temp.asRequestBody(type.toMediaType())).build()
  OkHttpClient().newCall(Request.Builder().url(endpoint).post(body).build()).execute().use { response ->
    if (response.isSuccessful) "文件已发送到服务器" else "文件上传失败：HTTP ${response.code}"
  }.also { temp.delete() }
} catch (error: Exception) { "文件上传失败：${error.message ?: "网络错误"}" }

private fun queryDisplayName(context: Context, uri: Uri): String? =
  context.contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
    if (cursor.moveToFirst()) cursor.getString(0) else null
  }

private fun uploadPhoto(context: Context, uri: Uri, endpoint: String): String = try {
  val input = context.contentResolver.openInputStream(uri) ?: return "无法读取照片"
  val temp = File.createTempFile("upload_", ".jpg", context.cacheDir)
  input.use { source -> temp.outputStream().use { source.copyTo(it) } }
  val body = MultipartBody.Builder().setType(MultipartBody.FORM).addFormDataPart("photo", temp.name, temp.asRequestBody("image/jpeg".toMediaType())).build()
  OkHttpClient().newCall(Request.Builder().url(endpoint).post(body).build()).execute().use { response ->
    uploadStatus(response.code, response.body?.string().orEmpty()).also { DebugLogger.log("Upload completed: HTTP ${response.code}") }
  }.also { temp.delete() }
} catch (e: Exception) { DebugLogger.log("Upload failed: ${e.javaClass.simpleName}"); "上传失败：${e.message ?: "网络错误"}" }

private fun testServerHealth(config: ServerConfig): String = try {
  OkHttpClient().newCall(Request.Builder().url(config.healthUrl()).get().build()).execute().use { response ->
    DebugLogger.log("Server health response: HTTP ${response.code}")
    serverTestStatus(response.code)
  }
} catch (e: Exception) {
  DebugLogger.log("Server health check failed: ${e.javaClass.simpleName}")
  "无法连接服务器：${e.message ?: "网络错误"}"
}
