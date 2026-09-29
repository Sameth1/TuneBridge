# TuneBridge mobile apps

The App Store and Google Play apps are a [Capacitor](https://capacitorjs.com) shell around the same page as the
website (`../public`). The apps call the public TuneBridge server, so users never sign in, and the apps add:

- **Android:** TuneBridge in the system Share sheet (any shared text or link) and `tunebridge://share?url=…`.
- **iOS:** a Share Extension (“TuneBridge” in the Share sheet shows the result right there) and the
  `tunebridge://share?url=…` scheme for Shortcuts.

Bundle id / application id: `com.tunebridgeapp.app` — it cannot change after the first store release.

## Build

```sh
cd mobile
npm install
npm run sync                     # copies ../public into www/ and updates both native projects
```

`TUNEBRIDGE_URL` picks the server the app talks to (default in `build-www.mjs`). Update it, and `TuneBridgeURL` in
`ios/ShareExtension/Info.plist`, when the site moves to its own domain.

### Android

Needs JDK 21 and the Android SDK (platform 36).

```sh
npm run android:debug            # android/app/build/outputs/apk/debug/app-debug.apk, installable for testing
```

Release (Google Play wants an `.aab` signed with your upload key):

1. Create the upload key once and keep it and its passwords safe (a lost key needs a Play support reset):
   `keytool -genkeypair -v -keystore ~/tunebridge-upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000`
2. Create `android/keystore.properties` (ignored by git):
   ```
   storeFile=/absolute/path/tunebridge-upload.jks
   storePassword=…
   keyAlias=upload
   keyPassword=…
   ```
3. Raise `versionCode` (and `versionName`) in `android/app/build.gradle` for every upload.
4. `npm run android:bundle` → `android/app/build/outputs/bundle/release/app-release.aab`.

### iOS

Needs a Mac with Xcode 16+ and an Apple Developer Program membership.

```sh
npm run sync && npx cap open ios
```

Add the Share Extension once:

1. **File → New → Target… → Share Extension**, name it `ShareExtension`, language Swift, and don’t activate the scheme.
2. Delete the files Xcode generated for it (`ShareViewController.swift`, `MainInterface.storyboard`, `Info.plist`) and
   drag in the ones in `ios/ShareExtension/` (`ShareViewController.swift`, `Info.plist`, `en.lproj`, `tr.lproj`),
   ticking only the ShareExtension target.
3. In the ShareExtension target’s **Build Settings**, set *Info.plist File* to the dragged-in `Info.plist` and
   *iOS Deployment Target* to the app’s. Its bundle id becomes `com.tunebridgeapp.app.ShareExtension`.
4. Under **Signing & Capabilities** choose your team for both targets.
5. Run on a phone, open Apple Music → Share → More → TuneBridge.

Release: set the version under the App target’s **General** tab, then **Product → Archive → Distribute App →
App Store Connect**. Test it through TestFlight before submitting for review.

Without a Mac: a macOS GitHub Actions runner or a cloud build service such as Codemagic or Ionic Appflow
can archive and upload it using an App Store Connect API key stored as a CI secret.

## Store listings

| | App Store | Google Play |
|---|---|---|
| Account | Apple Developer Program, $99/year | Play Console, $25 once |
| Privacy policy | `https://<site>/privacy.html` | same |
| Data collection | *Data Not Collected* | Data safety: no data collected or shared; data is encrypted in transit |
| Age rating | 4+ | Everyone (IARC questionnaire) |
| Category | Music | Music & Audio |
| Screenshots | 6.9″ iPhone (1320×2868) and 13″ iPad if iPad is supported | Phone, at least 2 |
| Also needed | Support URL, contact email | Contact email, 512×512 icon, 1024×500 feature graphic |
| Testing rule | — | New personal accounts: a closed test with 12 testers for 14 days before production |

Suggested text (both languages ship in the app):

- **Name:** TuneBridge — Share Music
- **Subtitle / short description:** One song link that opens in everyone’s music app.
  / Tek şarkı bağlantısı, herkesin müzik uygulamasında açılır.
- **Description:** Share a song or album from Apple Music, Spotify, YouTube Music, YouTube, Deezer or SoundCloud,
  and TuneBridge finds the same recording on every other platform. Your friends open it in the app they use and
  just press play. No account, no ads, no tracking.

Review notes: Apple rejects apps that only wrap a website (guideline 4.2). Point reviewers at what the app adds:
the Share Extension, the `tunebridge://` scheme and the native share and paste flow.
