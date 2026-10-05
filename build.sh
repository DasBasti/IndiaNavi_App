#!/usr/bin/env bash
# Build the Android APK of the app.
#
# Usage: ./build.sh [release|debug] [--install] [--clean]
#
#   release    build a release APK (default), signed with the debug key
#   debug      build a debug APK, needs the Metro server (yarn start)
#   --install  install the APK on the connected device with adb
#   --clean    run gradle clean before the build
#
# The APK is copied to dist/.

set -euo pipefail

cd "$(dirname "$0")"

variant=release
install=false
clean=false

for arg in "$@"; do
    case "$arg" in
        release|debug) variant="$arg" ;;
        --install) install=true ;;
        --clean) clean=true ;;
        -h|--help) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "Unknown argument: $arg" >&2; exit 1 ;;
    esac
done

# Find the Android SDK
if [ -z "${ANDROID_HOME:-}" ]; then
    for dir in "${ANDROID_SDK_ROOT:-}" "$HOME/Android/Sdk" /opt/android-sdk; do
        if [ -n "$dir" ] && [ -d "$dir" ]; then
            export ANDROID_HOME="$dir"
            break
        fi
    done
fi
if [ -z "${ANDROID_HOME:-}" ]; then
    echo "Android SDK not found, set ANDROID_HOME" >&2
    exit 1
fi
export PATH="$ANDROID_HOME/platform-tools:$PATH"

# The Android Gradle plugin needs JDK 17 or 21, newer ones fail in jlink
if [ -z "${JAVA_HOME:-}" ]; then
    for dir in /usr/lib/jvm/java-21-* /usr/lib/jvm/java-17-* \
               "$HOME/bin/android-studio/jbr" "$HOME/android-studio/jbr" /opt/android-studio/jbr; do
        if [ -x "$dir/bin/java" ]; then
            export JAVA_HOME="$dir"
            break
        fi
    done
fi
if [ -z "${JAVA_HOME:-}" ]; then
    echo "No JDK 17 or 21 found, using $(java -version 2>&1 | head -1)" >&2
    echo "If the build fails, install jdk21-openjdk or set JAVA_HOME" >&2
fi

if [ ! -d node_modules ] || [ package.json -nt node_modules ] || [ yarn.lock -nt node_modules ]; then
    echo "Installing JavaScript dependencies"
    yarn install --frozen-lockfile
    touch node_modules
fi

task="assemble${variant^}"
gradle_tasks=()
$clean && gradle_tasks+=(clean)
gradle_tasks+=("$task")

echo "Building $variant APK"
(cd android && ./gradlew "${gradle_tasks[@]}")

apk="android/app/build/outputs/apk/$variant/app-$variant.apk"
if [ ! -f "$apk" ]; then
    echo "APK not found: $apk" >&2
    exit 1
fi

version=$(node -p "require('./app.json').expo.version")
mkdir -p dist
out="dist/WanderNavi-$version-$variant.apk"
cp "$apk" "$out"
echo "APK: $out"

if $install; then
    echo "Installing on the device"
    adb install -r "$out"
fi
