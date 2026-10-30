/*
 * JNI of the native map renderer: opens Mapsforge maps with mapsforge-rs and draws the shapes of
 * several maps into a framebuffer of inks (0 black ... 6 orange) with mfr_raster.c, the way
 * src/linux/vector_map.c of the firmware does it. The names of places and the icons of POIs are
 * handed back to Kotlin, the app draws them with its own font and pictures.
 */

#include <jni.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/types.h>

#include "mapsforge.h"
#include "mfr_raster.h"

#define WHITE 1

/* at most this many maps are drawn together, the firmware draws 4 */
#define MAX_MAPS 16

typedef struct {
    FILE* file;
    mfr_map_t* map;
} open_map_t;

typedef struct {
    mfr_raster_t raster;
    uint8_t* pixels;
    JNIEnv* env;
    jobject sink;
    jmethodID label;
    jmethodID icon;
} render_t;

static ssize_t io_read(void* ctx, uint8_t* buf, size_t len)
{
    size_t n = fread(buf, 1, len, (FILE*)ctx);
    return n == 0 && ferror((FILE*)ctx) ? -1 : (ssize_t)n;
}

static int io_seek(void* ctx, uint64_t offset)
{
    return fseeko((FILE*)ctx, (off_t)offset, SEEK_SET);
}

static void throw_io(JNIEnv* env, const char* what, int err)
{
    char message[192];
    if (err < 0)
        snprintf(message, sizeof(message), "%s: %d (%s)", what, err, mfr_last_error());
    else
        snprintf(message, sizeof(message), "%s", what);
    jclass exception = (*env)->FindClass(env, "java/io/IOException");
    if (exception)
        (*env)->ThrowNew(env, exception, message);
}

static void span(void* ctx, int y, int x0, int x1, uint32_t color)
{
    const render_t* r = ctx;
    uint8_t* row = r->pixels + (size_t)y * (size_t)r->raster.width;
    for (int x = x0; x <= x1; x++)
        row[x] = (uint8_t)color;
}

static void draw_fill_polygon(void* ctx, const mfr_point_t* points, const uint32_t* ring_lengths,
    uint32_t ring_count, uint32_t color)
{
    mfr_raster_fill_polygon(&((render_t*)ctx)->raster, points, ring_lengths, ring_count, color);
}

static void draw_polyline(void* ctx, const mfr_point_t* points, uint32_t count, uint32_t color, uint8_t width)
{
    mfr_raster_polyline(&((render_t*)ctx)->raster, points, count, color, width);
}

static void draw_point(void* ctx, mfr_point_t at, uint32_t color, uint8_t radius)
{
    mfr_raster_disc(&((render_t*)ctx)->raster, at.x, at.y, radius, color);
}

/* the text is UTF-8, it goes to Kotlin as bytes: NewStringUTF wants modified UTF-8 */
static void draw_label(void* ctx, mfr_point_t at, const char* text, uint32_t len, uint8_t rank)
{
    render_t* r = ctx;
    JNIEnv* env = r->env;
    if ((*env)->ExceptionCheck(env))
        return;
    jbyteArray bytes = (*env)->NewByteArray(env, (jsize)len);
    if (!bytes)
        return;
    (*env)->SetByteArrayRegion(env, bytes, 0, (jsize)len, (const jbyte*)text);
    (*env)->CallVoidMethod(env, r->sink, r->label, (jint)at.x, (jint)at.y, bytes, (jint)rank);
    (*env)->DeleteLocalRef(env, bytes);
}

static void draw_icon(void* ctx, mfr_point_t at, uint8_t icon)
{
    render_t* r = ctx;
    JNIEnv* env = r->env;
    if ((*env)->ExceptionCheck(env))
        return;
    (*env)->CallVoidMethod(env, r->sink, r->icon, (jint)at.x, (jint)at.y, (jint)icon);
}

JNIEXPORT jlong JNICALL Java_tech_platinenmacher_indianavimapsforge_MapsforgeNative_open(
    JNIEnv* env, jclass cls, jstring path)
{
    const char* name = (*env)->GetStringUTFChars(env, path, NULL);
    if (!name)
        return 0;
    FILE* file = fopen(name, "rb");
    (*env)->ReleaseStringUTFChars(env, path, name);
    if (!file) {
        throw_io(env, "The map can not be opened", 0);
        return 0;
    }
    /* mfr_open keeps a copy of the callbacks, the file stays open until close */
    mfr_io_t io = { .ctx = file, .read = io_read, .seek = io_seek };
    int err = MFR_OK;
    mfr_map_t* map = mfr_open(&io, &err);
    open_map_t* opened = map ? malloc(sizeof(open_map_t)) : NULL;
    if (!opened) {
        mfr_close(map);
        fclose(file);
        throw_io(env, "The file is not a Mapsforge map", map ? MFR_ERR_CORRUPT : err);
        return 0;
    }
    opened->file = file;
    opened->map = map;
    return (jlong)(intptr_t)opened;
}

JNIEXPORT void JNICALL Java_tech_platinenmacher_indianavimapsforge_MapsforgeNative_close(
    JNIEnv* env, jclass cls, jlong handle)
{
    open_map_t* opened = (open_map_t*)(intptr_t)handle;
    if (!opened)
        return;
    mfr_close(opened->map);
    fclose(opened->file);
    free(opened);
}

/* Draws the maps (in this order into one scene) into pixels, a direct buffer of width x height
 * inks that holds the background already, and calls sink.label(x, y, utf8, rank) for the names
 * of places, the most important first, and sink.icon(x, y, icon) for the POIs with an icon
 * (MFR_ICON_*). Returns the number of tiles read. */
JNIEXPORT jint JNICALL Java_tech_platinenmacher_indianavimapsforge_MapsforgeNative_render(
    JNIEnv* env, jclass cls, jlongArray handles, jdouble lat, jdouble lon, jint zoom, jint width,
    jint height, jint anchor_x, jint anchor_y, jobject pixels, jobject sink)
{
    uint8_t* buffer = (*env)->GetDirectBufferAddress(env, pixels);
    if (!buffer || width <= 0 || height <= 0 || width > INT16_MAX || height > INT16_MAX
        || (*env)->GetDirectBufferCapacity(env, pixels) < (jlong)width * height) {
        throw_io(env, "The framebuffer does not fit the view", 0);
        return 0;
    }
    jsize count = (*env)->GetArrayLength(env, handles);
    if (count > MAX_MAPS)
        count = MAX_MAPS;
    jlong maps[MAX_MAPS];
    (*env)->GetLongArrayRegion(env, handles, 0, count, maps);

    mfr_scene_t* scene = mfr_scene_new();
    if (!scene) {
        throw_io(env, "No memory for the map", MFR_ERR_CORRUPT);
        return 0;
    }
    int tiles = 0;
    for (jsize i = 0; i < count; i++) {
        open_map_t* opened = (open_map_t*)(intptr_t)maps[i];
        int read = mfr_scene_collect(scene, opened->map, lat, lon, (uint8_t)zoom, (uint16_t)width,
            (uint16_t)height, (int16_t)anchor_x, (int16_t)anchor_y);
        if (read < 0) {
            mfr_scene_free(scene);
            throw_io(env, "The map can not be read", read);
            return 0;
        }
        tiles += read;
    }

    /* the methods are kept by name in a minified build by proguard-rules.pro */
    jclass sink_class = (*env)->GetObjectClass(env, sink);
    jmethodID label = (*env)->GetMethodID(env, sink_class, "label", "(II[BI)V");
    jmethodID icon = label ? (*env)->GetMethodID(env, sink_class, "icon", "(III)V") : NULL;
    if (!icon) {
        mfr_scene_free(scene);
        return 0;
    }
    render_t r = {
        .raster = { .span = span, .width = width, .height = height, .white = WHITE },
        .pixels = buffer,
        .env = env,
        .sink = sink,
        .label = label,
        .icon = icon,
    };
    r.raster.ctx = &r;
    mfr_draw_t draw = {
        .ctx = &r,
        .fill_polygon = draw_fill_polygon,
        .polyline = draw_polyline,
        .point = draw_point,
        .label = draw_label,
        .icon = draw_icon,
    };
    mfr_scene_draw(scene, MFR_PALETTE_EINK7, &draw);
    mfr_scene_free(scene);
    return tiles;
}
