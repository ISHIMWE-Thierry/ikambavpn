import Foundation
import Combine
import FirebaseAuth
import SwiftUI

@MainActor
class VPNViewModel: ObservableObject {
    @Published var statusText: String = "Disconnected"
    @Published var isConnecting: Bool = false
    @Published var isConnected: Bool = false
    @Published var inferredCountry: String? = nil

    private var heartbeatTimer: AnyCancellable?
    private var sessionId: String?

    var buttonColor: Color {
        if isConnecting { return .orange }
        if isConnected { return .green }
        return .gray
    }

    func start() {
        Task { await self.ensureAuth() }
    }

    func toggle() {
        if isConnected {
            disconnect()
        } else {
            connect()
        }
    }

    private func ensureAuth() async {
        if Auth.auth().currentUser != nil { return }
        do {
            _ = try await Auth.auth().signInAnonymously()
        } catch {
            print("Auth failed: \(error)")
        }
    }

    private func connect() {
        isConnecting = true
        statusText = "AI selecting best route…"
        Task {
            do {
                let token = try await Auth.auth().currentUser?.getIDToken() ?? "mock-token"
                let request = SmartConnectRequest(device: "ios", device_id: UUID().uuidString)
                let response = try await API.shared.smartConnect(token: token, payload: request)
                self.sessionId = response.session_id
                self.statusText = "Connected to \(response.server)"
                self.isConnected = true
                self.isConnecting = false
                startHeartbeat(token: token, sessionId: response.session_id)
                // TODO: apply WireGuard config via Network Extension / WireGuardKit
            } catch {
                DispatchQueue.main.async {
                    self.statusText = "Error"
                    self.isConnecting = false
                }
            }
        }
    }

    private func disconnect() {
        heartbeatTimer?.cancel()
        heartbeatTimer = nil
        isConnected = false
        statusText = "Disconnected"
        // TODO: tear down tunnel
    }

    private func startHeartbeat(token: String, sessionId: String) {
        heartbeatTimer?.cancel()
        heartbeatTimer = Timer.publish(every: 30, on: .main, in: .common)
            .autoconnect()
            .sink { _ in
                Task {
                    try? await API.shared.heartbeat(token: token, sessionId: sessionId, status: "connected", ping: nil)
                }
            }
    }
}

struct SmartConnectRequest: Encodable {
    let device: String
    let device_id: String
}

struct SmartConnectResponse: Decodable {
    let session_id: String
    let server: String
    let expires_at: String
    let wg_config: WGConfig
}

struct WGConfig: Decodable {
    let private_key: String?
    let peer_public_key: String
    let endpoint: String
    let allowed_ips: String
    let dns: String
}
