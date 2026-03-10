## Firebase Analytics Setup (Expo + React Native Firebase)

This project now uses:
- `@react-native-firebase/app`
- `@react-native-firebase/analytics`

### Required files

Place these files in the project root:

1. `google-services.json` (Android)
2. `GoogleService-Info.plist` (iOS)

You can download both from Firebase Console:
`Project settings -> Your apps -> SDK setup and configuration`

### Current app.json config

Already configured:
- `expo.ios.googleServicesFile = "./GoogleService-Info.plist"`
- `expo.android.googleServicesFile = "./google-services.json"`

### EAS build notes

- Ensure both files are committed or provided in EAS build context.
- If you do not want to commit them, upload them to EAS secrets/files and write them during build before prebuild.

Without these files, native Firebase Analytics will not initialize.
