package tech.platinenmacher.indianavimapsforge

import android.graphics.Bitmap
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.typedarray.Uint8Array
import java.nio.ByteBuffer

// Receives what a render leaves to the app: the names of places (x, y, the name as UTF-8 and its rank, 1 city … 4 hamlet)
// and the icons of POIs (x, y of the middle and the MFR_ICON_* of mapsforge.h)
interface RenderSink {
  fun label(x: Int, y: Int, text: ByteArray, rank: Int)
  fun icon(x: Int, y: Int, icon: Int)
}

// The view of a render: lat, lon is at pixel anchorX, anchorY of the width x height pixels
class View : Record {
  @Field val lat: Double = 0.0
  @Field val lon: Double = 0.0
  @Field val zoom: Int = 0
  @Field val width: Int = 0
  @Field val height: Int = 0
  @Field val anchorX: Int = 0
  @Field val anchorY: Int = 0
}

// mapsforge-rs and mfr_raster.c (src/main/cpp/mapsforge_jni.c)
internal object MapsforgeNative {
  init {
    System.loadLibrary("indianavi_mapsforge")
  }

  @JvmStatic external fun open(path: String): Long

  @JvmStatic external fun close(handle: Long)

  @JvmStatic external fun render(
    handles: LongArray, lat: Double, lon: Double, zoom: Int, width: Int, height: Int, anchorX: Int, anchorY: Int,
    pixels: ByteBuffer, sink: RenderSink
  ): Int
}

// Draws the vector maps of the simulated IndiaNavi with the renderer of the firmware, much faster than mapsforge.js.
// JS only gets ids of the open maps, the native handles are pointers that do not fit into a JS number.
class IndiaNaviMapsforgeModule : Module() {
  private val maps = HashMap<Int, Long>()
  private var nextId = 1

  override fun definition() = ModuleDefinition {
    Name("IndiaNaviMapsforge")

    // Opens the map at the path, returns its id. Throws if it is not a Mapsforge map.
    Function("open") { path: String ->
      val handle = MapsforgeNative.open(path)
      synchronized(maps) {
        val id = nextId++
        maps[id] = handle
        id
      }
    }

    Function("close") { id: Int ->
      synchronized(maps) { maps.remove(id) }?.let { MapsforgeNative.close(it) }
    }

    // Draws the maps (ids of open, drawn in this order into one scene) into pixels, the framebuffer of width x height
    // inks with the background. Returns { tiles, labels: [{ x, y, text, rank }], icons: [{ x, y, icon }] }, the names of
    // places (the most important first) and the icons of POIs (MFR_ICON_*) to draw on top.
    Function("render") { ids: List<Int>, view: View, pixels: Uint8Array ->
      val handles = synchronized(maps) {
        ids.map { maps[it] ?: throw IllegalArgumentException("The map $it is closed") }.toLongArray()
      }
      val labels = mutableListOf<Map<String, Any>>()
      val icons = mutableListOf<Map<String, Any>>()
      val tiles = MapsforgeNative.render(
        handles, view.lat, view.lon, view.zoom, view.width, view.height, view.anchorX, view.anchorY,
        pixels.toDirectBuffer(),
        object : RenderSink {
          override fun label(x: Int, y: Int, text: ByteArray, rank: Int) {
            labels.add(mapOf("x" to x, "y" to y, "text" to String(text, Charsets.UTF_8), "rank" to rank))
          }

          override fun icon(x: Int, y: Int, icon: Int) {
            icons.add(mapOf("x" to x, "y" to y, "icon" to icon))
          }
        }
      )
      mapOf("tiles" to tiles, "labels" to labels, "icons" to icons)
    }

    // Puts the framebuffer pixels (width x height inks) as the frame of key, colors are 0xRRGGBB by ink. The
    // FramebufferViews of the key show it after their version changed.
    Function("setFrame") { key: String, pixels: Uint8Array, width: Int, height: Int, palette: List<Int> ->
      val count = width * height
      require(width > 0 && height > 0 && pixels.byteLength >= count) { "The framebuffer does not fit $width x $height" }
      val colors = IntArray(palette.size) { palette[it] or (0xff shl 24) }
      val inks = ByteArray(count)
      pixels.read(inks, 0, count)
      val argb = IntArray(count) { colors.getOrElse(inks[it].toInt() and 0xff) { 0 } }
      Frames.bitmaps[key] = Bitmap.createBitmap(argb, width, height, Bitmap.Config.ARGB_8888)
    }

    Function("dropFrame") { key: String ->
      Frames.bitmaps.remove(key)
    }

    View(FramebufferView::class) {
      Prop("frameKey") { view: FramebufferView, key: String ->
        view.frameKey = key
        view.invalidate()
      }
      // changes after every setFrame of the key
      Prop("version") { view: FramebufferView, _: Int ->
        view.invalidate()
      }
    }

    OnDestroy {
      synchronized(maps) {
        maps.values.forEach { MapsforgeNative.close(it) }
        maps.clear()
      }
    }
  }
}
