import Foundation

final class API {
    static let shared = API()
    private init() {}

    private let baseURL = URL(string: "http://localhost:4001")!
    private let mockMode = true

    func smartConnect(token: String, payload: SmartConnectRequest) async throws -> SmartConnectResponse {
        if mockMode {
            return SmartConnectResponse(
                session_id: "mock-session",
                server: "USA",
                expires_at: ISO8601DateFormatter().string(from: Date().addingTimeInterval(900)),
                wg_config: WGConfig(
                    private_key: "mock-private-key",
                    peer_public_key: "mock-peer-public",
                    endpoint: "mock.endpoint:51820",
                    allowed_ips: "0.0.0.0/0",
                    dns: "1.1.1.1"
                )
            )
        }
        var request = URLRequest(url: baseURL.appendingPathComponent("/ai/smart-connect"))
        request.httpMethod = "POST"
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        request.addValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONEncoder().encode(payload)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }
        return try JSONDecoder().decode(SmartConnectResponse.self, from: data)
    }

    func heartbeat(token: String, sessionId: String, status: String, ping: Int?) async throws {
        if mockMode { return }
        var request = URLRequest(url: baseURL.appendingPathComponent("/connection/heartbeat"))
        request.httpMethod = "POST"
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        request.addValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let body: [String: Any] = [
            "session_id": sessionId,
            "status": status,
            "local_ping_ms": ping as Any
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body, options: [])
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }
    }
}
