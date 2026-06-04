# Build Instruction

### MacOS

For unsigned local packaging, run:

```sh
npm run package-mac
```

For Developer ID signing, notarization, stapling, Gatekeeper verification, and DMG creation, run:

```sh
MAC_ARCHES=arm64 NOTARY_KEYCHAIN_PROFILE=skyinclude-notary-api npm run package-mac-notarized
```

Use `MAC_ARCHES=x64` for Intel, or `MAC_ARCHES="x64 arm64"` for both architectures.

GitHub Actions release signing requires these repository or organization secrets:

```text
CSC_LINK
CSC_KEY_PASSWORD
APPLE_ID
APPLE_APP_SPECIFIC_PASSWORD
APPLE_TEAM_ID
```

The signing/notarization flow intentionally uses `xcrun notarytool`, not deprecated `altool`.

Before publishing a macOS artifact, verify:

```sh
codesign --verify --deep --strict --verbose=2 "release/mac-arm64/Bob LearnHNS.app"
spctl --assess --type execute --verbose "release/mac-arm64/Bob LearnHNS.app"
xcrun stapler validate "release/Bob LearnHNS-<version>-arm64.dmg"
spctl --assess --type open --context context:primary-signature --verbose "release/Bob LearnHNS-<version>-arm64.dmg"
hdiutil verify "release/Bob LearnHNS-<version>-arm64.dmg"
shasum -a 256 "release/Bob LearnHNS-<version>-arm64.dmg"
```

### Windows

1. Simply build with
   ```sh
   npm run package-win
   ```
2. The `.exe` file will be placed in `./release/`.

### Linux

1. Simply build with
   ```sh
   npm run package-linux
   ```
2. The `.AppImage` file will be placed in `./release/`.

### Common

1. Create a checksum file for all binaires with
   ```sh
   # say only latest versions of Bob binaries are in current directory
   sha512sum Bob* > SHA512SUMS-0.8.0.txt
   ```
2. Verify it with
   ```sh
   sha512sum -c SHA512SUMS-0.8.0.txt
   ```
