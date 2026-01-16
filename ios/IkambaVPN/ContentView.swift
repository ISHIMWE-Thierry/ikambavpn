import SwiftUI
import FirebaseAuth

struct ContentView: View {
    @StateObject private var viewModel = VPNViewModel()

    var body: some View {
        VStack(spacing: 24) {
            Text("IkambaVPN")
                .font(.largeTitle).bold()
            Text(viewModel.statusText)
                .foregroundColor(.secondary)

            Button(action: viewModel.toggle) {
                ZStack {
                    Circle()
                        .fill(viewModel.buttonColor)
                        .frame(width: 180, height: 180)
                    if viewModel.isConnecting {
                        ProgressView()
                    } else {
                        Text(viewModel.isConnected ? "Disconnect" : "Connect")
                            .foregroundColor(.white)
                            .font(.title2).bold()
                    }
                }
            }
            .disabled(viewModel.isConnecting)

            if let location = viewModel.inferredCountry {
                Text("Location: \(location)")
                    .font(.footnote)
                    .foregroundColor(.secondary)
            }
        }
        .padding()
        .onAppear { viewModel.start() }
    }
}

#Preview {
    ContentView()
}
