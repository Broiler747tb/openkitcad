# OpenKitCAD Android / Samsung S Pen

Android build: **1.0.0-android**, package `com.broiler747tb.openkitcad`.

## Mobile layout

The Android build runs the same app as the desktop one. `.android-app` on the root element
switches it to five stacked rows — header, pen bar, model, navigation, status — so nothing
floats over the modelling surface.

- The ribbon keeps Fusion's groups and scrolls sideways; so does the header. On a short
  landscape screen the workspace tabs are hidden to buy the ribbon back its height.
- Components and Details are direct buttons in the pen bar, which also carries the
  orientation selector, Undo, Redo and Cancel tool. The orientation choice is kept across
  launches and rotating does not reload the design.
- The side panels become drawers over the model row rather than columns beside it, with
  Close panel exposed outside the drawer and a tap on the model to put them away. The
  Design tree inside the left drawer is how features are reached.
- Ribbon menus and the command panel are pinned to the left edge and given the full screen
  height, because a dropdown positioned under its button runs off a phone.
- The floating desktop timeline, the sheet tabs and the sketch banner are hidden to keep
  space for the model.
- Every button, input and tree row is at least 40 px tall, and inputs are 16 px so the
  system does not zoom the page when one takes focus.

## Install and requirements

Copy the APK to the phone/tablet and open it with the Android package installer. This is a sideloadable **debug-signed testing build**, not a Play Store release. Keep the same signing key for future updates. Back up designs as `.okc` files before uninstalling; uninstalling removes internal autosaves and custom parts.

Minimum Android 8.0 (API 26), OpenGL ES 3 / WebGL 2 and a current Android System WebView. A Samsung tablet or phone with an S Pen is the intended input device. Landscape is recommended, but portrait and rotation are supported. There is no CPU-specific native CAD binary: the bundled geometry engine runs as WebAssembly in WebView.

## Input

- **S Pen:** hover previews and snapping; tap to draw/select; drag sketch points; long-press in Select for context actions.
- **Barrel button:** Android stylus-button hover events open the canvas context menu; ordinary WebView context-menu events are also supported. Availability depends on the S Pen model / system event delivery.
- **Finger:** one-finger pan; choose Finger: orbit outside sketches to rotate the model; two fingers zoom and pan.
- Finger touches never create sketch geometry. Additional canvas touch-downs during pen contact are filtered as a basic safeguard against palm input. This is not a guarantee of hardware-level palm rejection.
- The pen bar provides Undo, Redo and Cancel tool without a keyboard. Keyboard shortcuts remain available for external keyboards.
- Side panels use the Components / Details buttons in the pen bar at any screen width.
- Pressure does not change CAD dimensions. Bluetooth Air Actions and remote S Pen gestures are **not implemented**.

## Files and offline operation

The interface, catalogue, JS worker and OpenCascade WASM are inside the APK. There is no INTERNET permission or remote server dependency. Bundled resources are served at a private local HTTPS origin via [AndroidX WebViewAssetLoader](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content).

Open uses the Android system document picker. Save and geometry exports use Android's Create Document dialog; no broad storage permission is requested. Exports are limited to 64 MB in this build to bound the memory cost of the WebView/native transfer. The app confirms save completion with a native message. The system picker may offer cloud providers, but they are optional: use local storage for offline files.

Autosave is local. It waits for initial restoration, so slow WASM startup cannot replace a saved project with the empty initial document. Backgrounding requests an immediate autosave; unexpected process termination may still lose the latest in-flight edit. Save important work to `.okc` explicitly.

## Build

Prerequisites: Node dependencies (`npm ci`), JDK 17, Android SDK platform 35 and build tools, with their existing licenses accepted. Set `JAVA_HOME` and `ANDROID_HOME` to these installations; no machine paths are committed. Gradle 8.9 wrapper and Android Gradle Plugin 8.7.3 are pinned.

Windows: `npm run android:apk`.

Other hosts: `npm run build`, then `cd android` and `./gradlew assembleDebug`.

Output: `android/app/build/outputs/apk/debug/app-debug.apk`.

## Verification

**The Android build has not been rebuilt or re-tested since the Fusion parity work.** The
layout rules in `src/android.css` were kept up to date alongside the new ribbon, command
panel and view cube, and the whole test suite passes in a desktop browser, but no APK has
been assembled or installed since 0.5.2. Everything below is from that build and should be
treated as out of date until it is repeated.

- TypeScript and Vite production build passed.
- APK assembled and its APK Signature Scheme v2 signature verified.
- Installed on a headless Android API 36 emulator.
- Device-side `OfflineSmokeTest`: **309/309** bundled JS/kernel assertions passed, workspace WebGL canvas and pen toolbar became ready, INTERNET permission absent. The suite is now 1035 checks, so this number will change when the test is next run.
- The initial cold-emulator test exceeded its 3-second JS callback timeout. Increasing the test-only timeout to 45 seconds allowed the synchronous solver suite to complete; it did not require a change to the app kernel. The suite has grown a great deal since, so expect to raise that timeout again.
- **Not verified on a physical Samsung:** S Pen event delivery, barrel-button behavior, palm rejection, rendering speed, memory limits, and end-to-end system file-picker interaction.

To rerun device-side tests: build `assembleDebugAndroidTest`, install both debug APKs on a test emulator, then run `adb shell am instrument -w com.broiler747tb.openkitcad.test/com.broiler747tb.openkitcad.OfflineSmokeTest`. The test opens only a test workspace and the bundled self-test page.

## Known gaps

- The pen bar and the drawer backdrop use fixed light colours rather than theme tokens, so
  they stay light when the rest of the app is in Dark.
- The Android layout is only exercised by a browser at a narrow width. Nothing in
  `?selftest` covers it.
