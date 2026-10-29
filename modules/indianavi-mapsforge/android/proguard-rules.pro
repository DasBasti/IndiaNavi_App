# mapsforge_jni.c calls label(int, int, byte[], int) of the LabelSink by its name
-keep interface tech.platinenmacher.indianavimapsforge.LabelSink { *; }
-keepclassmembers class * implements tech.platinenmacher.indianavimapsforge.LabelSink {
  void label(int, int, byte[], int);
}
