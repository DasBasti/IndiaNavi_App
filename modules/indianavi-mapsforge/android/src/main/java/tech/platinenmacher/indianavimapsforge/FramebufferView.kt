package tech.platinenmacher.indianavimapsforge

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import java.util.concurrent.ConcurrentHashMap

// The framebuffers of the app as bitmaps, by their key: setFrame (JS thread) puts a new bitmap, the views (UI thread)
// draw it. A bitmap is not changed after it was put, so a view never draws one that is half written.
internal object Frames {
  val bitmaps = ConcurrentHashMap<String, Bitmap>()
}

// Shows the framebuffer of its key, scaled to the size of the view without smoothing, so the pixels of the display
// stay sharp. The app needs no PNG of the screen.
class FramebufferView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  var frameKey: String? = null

  private val paint = Paint().apply {
    isFilterBitmap = false
    isAntiAlias = false
  }
  private val target = Rect()

  init {
    setWillNotDraw(false)
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    val bitmap = frameKey?.let { Frames.bitmaps[it] } ?: return
    target.set(0, 0, width, height)
    canvas.drawBitmap(bitmap, null, target, paint)
  }
}
