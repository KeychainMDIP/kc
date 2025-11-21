# Android MDIP Demo

Install dependencies and run the app.

`npm install`

Run the app in the browser.

`npm run dev`

## Set up Android Studio

Install JDK 21, Android Studio (API 35) and then configure Capacitor path to Android Studio.

### Mac
export CAPACITOR_ANDROID_STUDIO_PATH="/Applications/Android Studio.app/Contents/MacOS/studio"

### Linux 
#### tarball install:
export CAPACITOR_ANDROID_STUDIO_PATH="$HOME/android-studio/bin/studio.sh"

#### JetBrains Toolbox:
export CAPACITOR_ANDROID_STUDIO_PATH="$HOME/.local/share/JetBrains/Toolbox/apps/android-studio/current/bin/studio.sh"

#### Snap:
export CAPACITOR_ANDROID_STUDIO_PATH="/snap/android-studio/current/android-studio/bin/studio.sh"

### Windows
$env:CAPACITOR_ANDROID_STUDIO_PATH = "C:\Program Files\Android\Android Studio\bin\studio64.exe"

## Build

Build and run the app in an emulator or adb attached device.

`npm run android:run`

Build the app and produce a self-signed APK in the `android/app/build/outputs/apk/debug` folder.

`npm run android:build`
