package com.example.quickphoto

import android.os.Bundle
import android.os.Build
import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import com.example.quickphoto.theme.QuickPhotoTheme

class MainActivity : ComponentActivity() {
  private var pendingCapture: (() -> Unit)? = null
  private var pendingGalleryWrite: ((Boolean) -> Unit)? = null
  private val cameraPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
    if (granted) pendingCapture?.invoke()
    pendingCapture = null
  }
  private val galleryWritePermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
    pendingGalleryWrite?.invoke(granted)
    pendingGalleryWrite = null
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)

    enableEdgeToEdge()
    setContent {
      QuickPhotoTheme {
        Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
          QuickPhotoApp(onCameraPermissionNeeded = { action ->
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) action()
            else { pendingCapture = action; cameraPermission.launch(Manifest.permission.CAMERA) }
          }, onGalleryWritePermissionNeeded = { granted, denied ->
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q || ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED) granted()
            else {
              pendingGalleryWrite = { allowed -> if (allowed) granted() else denied() }
              galleryWritePermission.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
            }
          })
        }
      }
    }
  }
}
