package tech.platinenmacher.indianaviphone

import android.annotation.SuppressLint
import android.content.Context
import android.location.GnssStatus
import android.location.LocationManager
import android.os.BatteryManager
import android.os.Handler
import android.os.Looper
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// What the simulated IndiaNavi shows of the phone: its battery level and the satellites of its GPS
class IndiaNaviPhoneModule : Module() {
  private var gnssCallback: GnssStatus.Callback? = null

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val locationManager: LocationManager
    get() = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager

  override fun definition() = ModuleDefinition {
    Name("IndiaNaviPhone")

    Events("onSatellites")

    Function("batteryLevel") {
      val manager = context.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
      manager.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY).takeIf { it in 0..100 }
    }

    // false without the location permission
    Function("startSatellites") { startSatellites() }

    Function("stopSatellites") { stopSatellites() }

    OnDestroy { stopSatellites() }
  }

  // the permission is checked by Android, it throws without it
  @SuppressLint("MissingPermission")
  private fun startSatellites(): Boolean {
    stopSatellites()
    val callback = object : GnssStatus.Callback() {
      private var last = -1

      override fun onSatelliteStatusChanged(status: GnssStatus) {
        send((0 until status.satelliteCount).count { status.usedInFix(it) })
      }

      override fun onStopped() = send(0)

      private fun send(count: Int) {
        if (count != last) {
          last = count
          sendEvent("onSatellites", mapOf("count" to count))
        }
      }
    }
    return try {
      val registered = locationManager.registerGnssStatusCallback(callback, Handler(Looper.getMainLooper()))
      if (registered) {
        gnssCallback = callback
      }
      registered
    } catch (e: SecurityException) {
      false
    }
  }

  private fun stopSatellites() {
    gnssCallback?.let { locationManager.unregisterGnssStatusCallback(it) }
    gnssCallback = null
  }
}
