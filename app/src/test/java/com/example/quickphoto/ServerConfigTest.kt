package com.example.quickphoto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ServerConfigTest {
  @Test
  fun parseValidServerConfig() {
    val config = parseServerConfig(" 192.168.31.8 ", "3000")
    assertEquals(ServerConfig("192.168.31.8", 3000), config)
    assertNull(parseServerConfig("", "3000"))
    assertNull(parseServerConfig("192.168.31.8", "99999"))
  }

  @Test
  fun parseDiscoveryPayload() {
    val discovered = parseDiscoveryResponse("""{"service":"quick-photo","port":3000}""", "192.168.31.8")
    assertEquals(DiscoveredServer("192.168.31.8", 3000), discovered)
  }
}
