# mapsforge_jni.c calls label(int, int, byte[], int) and icon(int, int, int) of the RenderSink by their names
-keep interface tech.platinenmacher.indianavimapsforge.RenderSink { *; }
-keepclassmembers class * implements tech.platinenmacher.indianavimapsforge.RenderSink {
  void label(int, int, byte[], int);
  void icon(int, int, int);
}
