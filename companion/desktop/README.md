# ELP Desktop Companion

This package turns the existing ELP local device agent into an installable Electron desktop companion for macOS, Windows, and Linux.

## Trust model

- Enrollment starts with a short-lived, one-time token created in ELP Authority Control.
- The enrollment token is exchanged for a revocable companion credential bound to one principal and one device ID.
- The credential is stored under Electron's application data directory with mode `0600` where the platform supports POSIX permissions.
- ELP validates device status, principal status, token version, target device, and the device command allowlist on every poll/acknowledgement.
- The renderer uses context isolation, no Node.js integration, a restrictive Content Security Policy, and a narrow preload API.
- Local execution uses argument arrays with `execFile`; no shell execution mode is enabled.
- URL actions are HTTPS-only.

## Development

```sh
cd companion/desktop
npm install
npm start
```

Create an enrollment from `https://elpgpt.com/authority-control`, paste the one-time token into the companion, and enroll the device.

## Packaging

```sh
npm run dist
```

Configured targets are DMG/ZIP on macOS, NSIS/portable on Windows, and AppImage on Linux. The repository workflow builds desktop artifacts on manual dispatch or companion release tags.

Code signing, Apple notarization, Microsoft signing, and App Store/Microsoft Store distribution are intentionally not claimed by this package. Those require platform developer identities and signing credentials to be provisioned in the release environment.
