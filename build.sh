#!/usr/bin/env bash
# Build the Android APK or the Play Store bundle of the app.
#
# Usage: ./build.sh [release|debug|bundle] [--install] [--clean]
#
#   release    build a release APK (default), signed with the upload key if set
#   debug      build a debug APK, needs the Metro server (yarn start)
#   bundle     build a release AAB for the Play Store, needs the upload key
#   --install  install the APK on the connected device with adb
#   --clean    run gradle clean before the build
#
# The upload key is set in ~/.gradle/gradle.properties with
# WANDERNAVI_UPLOAD_STORE_FILE, WANDERNAVI_UPLOAD_STORE_PASSWORD,
# WANDERNAVI_UPLOAD_KEY_ALIAS and WANDERNAVI_UPLOAD_KEY_PASSWORD.
#
# The APK or AAB is copied to dist/.

set -euo pipefail

cd "$(dirname "$0")"

variant=release
install=false
clean=false

for arg in "$@"; do
    case "$arg" in
        release|debug|bundle) variant="$arg" ;;
        --install) install=true ;;
        --clean) clean=true ;;
        -h|--help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
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

if [ "$variant" = bundle ]; then
    if $install; then
        echo "--install does not work with a bundle" >&2
        exit 1
    fi
    task=bundleRelease
    built="android/app/build/outputs/bundle/release/app-release.aab"
    kind=AAB
    suffix=.aab
else
    task="assemble${variant^}"
    built="android/app/build/outputs/apk/$variant/app-$variant.apk"
    kind=APK
    suffix="-$variant.apk"
fi

gradle_tasks=()
$clean && gradle_tasks+=(clean)
gradle_tasks+=("$task")

echo "Building $variant $kind"
(cd android && ./gradlew "${gradle_tasks[@]}")

if [ ! -f "$built" ]; then
    echo "$kind not found: $built" >&2
    exit 1
fi

version=$(node -p "require('./app.json').expo.version")
mkdir -p dist
out="dist/WanderNavi-$version$suffix"
cp "$built" "$out"
echo "$kind: $out"

if $install; then
    echo "Installing on the device"
    adb install -r "$out"
fi
