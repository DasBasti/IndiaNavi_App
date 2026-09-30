package tech.platinenmacher.indianaviwifi

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiInfo
import android.net.wifi.WifiManager
import android.net.wifi.WifiNetworkSpecifier
import android.os.Build
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.Inet4Address

// Name of the access point of the IndiaNavi: IndiaNavi-XXXX
private const val SSID_PREFIX = "IndiaNavi-"

// Connects the app to the WiFi access point of the IndiaNavi.
// This network has no internet, so all connections of the app are bound to it while it is connected,
// otherwise Android would send the requests over mobile data.
class IndiaNaviWifiModule : Module() {
  private var networkCallback: ConnectivityManager.NetworkCallback? = null

  // promise of connect() until the network is available or failed
  private var pendingConnect: Promise? = null

  private val connectivityManager: ConnectivityManager
    get() = appContext.reactContext?.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
      ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("IndiaNaviWifi")

    Events("onLost")

    AsyncFunction("connect") { ssid: String, password: String, timeoutMs: Int, promise: Promise ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
        promise.reject("ERR_ANDROID_VERSION", "Connecting to the IndiaNavi needs Android 10 or newer", null)
        return@AsyncFunction
      }
      disconnect()

      val request = NetworkRequest.Builder()
        .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
        .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        .setNetworkSpecifier(
          WifiNetworkSpecifier.Builder()
            .setSsid(ssid)
            .setWpa2Passphrase(password)
            .build()
        )
        .build()

      val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
          connectivityManager.bindProcessToNetwork(network)
          settle(this) { it.resolve(null) }
        }

        // the user declined, the network was not found or the timeout passed
        override fun onUnavailable() {
          settle(this) { it.reject("ERR_WIFI_UNAVAILABLE", "$ssid was not found, or the connection was not allowed", null) }
        }

        override fun onLost(network: Network) {
          connectivityManager.bindProcessToNetwork(null)
          sendEvent("onLost", emptyMap<String, Any>())
        }
      }

      synchronized(this@IndiaNaviWifiModule) {
        networkCallback = callback
        pendingConnect = promise
      }
      connectivityManager.requestNetwork(request, callback, timeoutMs)
    }

    // Uses a WiFi the phone is already connected to, if it is the access point of an IndiaNavi.
    // Android only tells the name of the WiFi with the location permission, so without the name
    // a WiFi in the network of the access point (192.168.4.x) is used; the app checks it with /api/info.
    // Returns { ssid } (ssid null if unknown) or null if there is no such WiFi.
    AsyncFunction("useConnectedNetwork") {
      disconnect()
      val manager = connectivityManager
      @Suppress("DEPRECATION")
      for (network in manager.allNetworks) {
        val capabilities = manager.getNetworkCapabilities(network) ?: continue
        if (!capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
          continue
        }
        val ssid = wifiSsid(capabilities)
        if (ssid?.startsWith(SSID_PREFIX) == true || (ssid == null && isInAccessPointNetwork(network))) {
          manager.bindProcessToNetwork(network)
          watch(network)
          return@AsyncFunction mapOf("ssid" to ssid)
        }
      }
      null
    }

    Function("disconnect") {
      disconnect()
    }

    OnDestroy {
      disconnect()
    }
  }

  // Settles the promise of connect() once, if the callback still belongs to the current connection
  private fun settle(callback: ConnectivityManager.NetworkCallback, action: (Promise) -> Unit) {
    val promise = synchronized(this) {
      if (networkCallback !== callback) return
      pendingConnect.also { pendingConnect = null }
    }
    promise?.let(action)
  }

  // Name of the WiFi, null if Android does not tell it
  private fun wifiSsid(capabilities: NetworkCapabilities): String? {
    val ssid = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      (capabilities.transportInfo as? WifiInfo)?.ssid
    } else {
      @Suppress("DEPRECATION")
      (appContext.reactContext?.applicationContext?.getSystemService(Context.WIFI_SERVICE) as? WifiManager)?.connectionInfo?.ssid
    }
    return ssid?.removeSurrounding("\"")?.takeUnless { it.isEmpty() || it == WifiManager.UNKNOWN_SSID }
  }

  // The access point of the IndiaNavi gives addresses in 192.168.4.x
  private fun isInAccessPointNetwork(network: Network): Boolean =
    connectivityManager.getLinkProperties(network)?.linkAddresses?.any { linkAddress ->
      val address = linkAddress.address
      address is Inet4Address && address.address.let {
        it[0] == 192.toByte() && it[1] == 168.toByte() && it[2] == 4.toByte()
      }
    } == true

  // Unbinds the app from the network and tells JS when the WiFi goes away
  private fun watch(network: Network) {
    val request = NetworkRequest.Builder()
      .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
      .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
      .build()
    val callback = object : ConnectivityManager.NetworkCallback() {
      override fun onLost(lost: Network) {
        if (lost == network) {
          connectivityManager.bindProcessToNetwork(null)
          sendEvent("onLost", emptyMap<String, Any>())
        }
      }
    }
    synchronized(this) {
      networkCallback = callback
    }
    connectivityManager.registerNetworkCallback(request, callback)
  }

  private fun disconnect() {
    val (callback, promise) = synchronized(this) {
      val current = networkCallback to pendingConnect
      networkCallback = null
      pendingConnect = null
      current
    }
    promise?.reject("ERR_WIFI_CANCELLED", "The connection was cancelled", null)
    val manager = runCatching { connectivityManager }.getOrNull() ?: return
    manager.bindProcessToNetwork(null)
    callback?.let { runCatching { manager.unregisterNetworkCallback(it) } }
  }
}
