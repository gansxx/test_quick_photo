package com.example.quickphoto

import android.content.Context
import android.net.wifi.WifiManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress

private const val DISCOVERY_PORT = 45879
private const val DISCOVERY_REQUEST = "DISCOVER_QUICK_PHOTO"

data class DiscoveredServer(val host: String, val port: Int)

fun parseDiscoveryResponse(payload: String, sender: String): DiscoveredServer? {
  val match = Regex("\\\"service\\\"\\s*:\\s*\\\"quick-photo\\\".*?\\\"port\\\"\\s*:\\s*(\\d+)").find(payload) ?: return null
  return match.groupValues[1].toIntOrNull()?.takeIf { it in 1..65535 }?.let { DiscoveredServer(sender, it) }
}

suspend fun discoverServer(context: Context): DiscoveredServer? = withContext(Dispatchers.IO) {
  val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
  @Suppress("DEPRECATION") val lock = wifi.createMulticastLock("quick-photo-discovery").apply { setReferenceCounted(false); acquire() }
  try {
    DatagramSocket().use { socket ->
      socket.broadcast = true
      socket.soTimeout = 2500
      val request = DISCOVERY_REQUEST.toByteArray()
      socket.send(DatagramPacket(request, request.size, InetAddress.getByName("255.255.255.255"), DISCOVERY_PORT))
      val buffer = ByteArray(512)
      val reply = DatagramPacket(buffer, buffer.size)
      socket.receive(reply)
      val sender = reply.address.hostAddress ?: return@use null
      parseDiscoveryResponse(reply.data.decodeToString(0, reply.length), sender)
    }
  } catch (_: Exception) { null } finally { lock.release() }
}
