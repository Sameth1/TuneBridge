import UIKit
import UniformTypeIdentifiers
import WebKit

// "Share → TuneBridge" on iPhone: finds the music link in what was shared and shows TuneBridge's share
// page for it, where the song is matched on every platform and the TuneBridge link can be copied.
final class ShareViewController: UIViewController, WKNavigationDelegate {
    private let webView = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
    private let statusLabel = UILabel()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.04, green: 0.05, blue: 0.07, alpha: 1)

        let close = UIButton(type: .system)
        close.setTitle(String(localized: "share.close"), for: .normal)
        close.titleLabel?.font = .boldSystemFont(ofSize: 17)
        close.tintColor = UIColor(red: 0.85, green: 0.71, blue: 1, alpha: 1)
        close.addTarget(self, action: #selector(done), for: .touchUpInside)
        close.translatesAutoresizingMaskIntoConstraints = false

        statusLabel.text = String(localized: "share.preparing")
        statusLabel.textColor = .lightGray
        statusLabel.numberOfLines = 0
        statusLabel.textAlignment = .center
        statusLabel.translatesAutoresizingMaskIntoConstraints = false

        webView.navigationDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = view.backgroundColor
        webView.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(webView)
        view.addSubview(statusLabel)
        view.addSubview(close)
        NSLayoutConstraint.activate([
            close.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
            close.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            webView.topAnchor.constraint(equalTo: close.bottomAnchor, constant: 4),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            statusLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            statusLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            statusLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24)
        ])
        readShared()
    }

    private func readShared() {
        let providers = extensionContext?.inputItems
            .compactMap { $0 as? NSExtensionItem }
            .flatMap { $0.attachments ?? [] } ?? []
        guard let provider = providers.first(where: {
            $0.hasItemConformingToTypeIdentifier(UTType.url.identifier) ||
            $0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier)
        }) else {
            statusLabel.text = String(localized: "share.noLink")
            return
        }
        let type = provider.hasItemConformingToTypeIdentifier(UTType.url.identifier)
            ? UTType.url.identifier : UTType.plainText.identifier
        provider.loadItem(forTypeIdentifier: type, options: nil) { [weak self] item, _ in
            let raw = (item as? URL)?.absoluteString ?? (item as? String)
            DispatchQueue.main.async { self?.open(raw) }
        }
    }

    // The page itself finds the link inside shared text and reports unsupported links in the user's language.
    private func open(_ raw: String?) {
        guard let raw, raw.range(of: #"https?://"#, options: .regularExpression) != nil,
              let base = Bundle.main.object(forInfoDictionaryKey: "TuneBridgeURL") as? String,
              var components = URLComponents(string: base + "/share") else {
            statusLabel.text = String(localized: "share.noLink")
            return
        }
        components.queryItems = [URLQueryItem(name: "text", value: raw)]
        guard let url = components.url else { return }
        webView.load(URLRequest(url: url))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        statusLabel.isHidden = true
    }

    @objc private func done() {
        extensionContext?.completeRequest(returningItems: nil)
    }
}
