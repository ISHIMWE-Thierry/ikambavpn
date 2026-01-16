# IkambaVPN iOS (MVP)

Single-screen SwiftUI app with one Connect button. Uses Firebase Anonymous Auth to call the backend AI smart-connect API and applies WireGuard config (placeholder TODO for Network Extension / WireGuardKit).

## Setup
1. Install Xcode 15+.
2. `cd ios` and open the project.
3. Add `GoogleService-Info.plist` to the project root.
4. Enable Network Extension entitlements (NETunnelProvider) and WireGuardKit (add via Swift Package once ready).
5. If using UIKit lifecycle, ensure `AppDelegate` configures Firebase (already wired via `@UIApplicationDelegateAdaptor`).

## Flow
- On launch: sign in anonymously with Firebase.
- Tap Connect: calls `POST /ai/smart-connect`, stores session id, starts 30s heartbeat loop.
- Disconnect: stops heartbeat (tunnel teardown TODO).

## TODO for production
- Integrate WireGuardKit and apply received `wg_config` to tunnel provider.
- Store keys in Keychain.
- Handle reconnect on failure / drops.
- Use real backend endpoint & TLS.
