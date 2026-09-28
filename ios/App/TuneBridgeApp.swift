import SwiftUI

@main
struct TuneBridgeApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

struct ContentView: View {
    @State private var sourceURL = ""
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("TuneBridge")
                .font(.largeTitle.bold())
            Text("app.tagline")
                .foregroundStyle(.secondary)
            TextField("app.pastePlaceholder", text: $sourceURL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .textFieldStyle(.roundedBorder)
            Button("app.createLink") {
                guard let url = URL(string: sourceURL),
                      var components = URLComponents(string: "https://YOUR_DOMAIN_HERE/s") else { return }
                components.queryItems = [URLQueryItem(name: "url", value: url.absoluteString)]
                if let destination = components.url { openURL(destination) }
            }
            .buttonStyle(.borderedProminent)
            Spacer()
            Text("app.shareHint")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .padding(24)
    }
}
