# The native renderer of the vector maps: mapsforge-rs (Rust, built with cargo) reads the maps and sorts the shapes,
# mfr_raster.c draws them into the framebuffer of the app, as on the IndiaNavi.
cmake_minimum_required(VERSION 3.22)
project(indianavi_mapsforge C)

set(CRATE ${CMAKE_CURRENT_SOURCE_DIR}/../mapsforge-rs)
if(NOT EXISTS ${CRATE}/Cargo.toml)
  message(FATAL_ERROR "mapsforge-rs is missing, run: git submodule update --init")
endif()

if(ANDROID_ABI STREQUAL "arm64-v8a")
  set(RUST_TARGET aarch64-linux-android)
elseif(ANDROID_ABI STREQUAL "armeabi-v7a")
  set(RUST_TARGET armv7-linux-androideabi)
elseif(ANDROID_ABI STREQUAL "x86")
  set(RUST_TARGET i686-linux-android)
elseif(ANDROID_ABI STREQUAL "x86_64")
  set(RUST_TARGET x86_64-linux-android)
else()
  message(FATAL_ERROR "No Rust target for ${ANDROID_ABI}")
endif()

find_program(CARGO cargo HINTS $ENV{HOME}/.cargo/bin REQUIRED)
set(CARGO_DIR ${CMAKE_CURRENT_BINARY_DIR}/cargo)
set(RUST_LIB ${CARGO_DIR}/${RUST_TARGET}/release/libmapsforge_rs.a)

# a static library needs no linker from cargo, the NDK links it into the shared library below.
# The firmware builds for size, the app for speed.
add_custom_target(mapsforge_rs_cargo
  COMMAND ${CMAKE_COMMAND} -E env CARGO_PROFILE_RELEASE_OPT_LEVEL=3
    ${CARGO} build --manifest-path ${CRATE}/Cargo.toml --lib --release --features ffi
      --target ${RUST_TARGET} --target-dir ${CARGO_DIR}
  BYPRODUCTS ${RUST_LIB}
  USES_TERMINAL)

add_library(mapsforge_rs STATIC IMPORTED)
set_target_properties(mapsforge_rs PROPERTIES IMPORTED_LOCATION ${RUST_LIB})
add_dependencies(mapsforge_rs mapsforge_rs_cargo)

add_library(indianavi_mapsforge SHARED src/main/cpp/mapsforge_jni.c ${CRATE}/c/mfr_raster.c)
target_include_directories(indianavi_mapsforge PRIVATE ${CRATE}/include ${CRATE}/c)
target_link_libraries(indianavi_mapsforge mapsforge_rs log dl m)
# 16 KB pages of Android 15
target_link_options(indianavi_mapsforge PRIVATE "-Wl,-z,max-page-size=16384")
