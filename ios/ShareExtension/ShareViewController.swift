import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    private let statusLabel = UILabel()
    private let copyButton = UIButton(type: .system)
    private var smartURL: URL?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.06, green: 0.06, blue: 0.09, alpha: 1)
        preferredContentSize = CGSize(width: 360, height: 220)

        let title = UILabel()
        title.text = "TuneBridge"
        title.textColor = .white
        title.font = .boldSystemFont(ofSize: 26)

        statusLabel.text = String(localized: "share.preparing")
        statusLabel.textColor = .lightGray
        statusLabel.numberOfLines = 0

        copyButton.setTitle(String(localized: "share.copyButton"), for: .normal)
        copyButton.titleLabel?.font = .boldSystemFont(ofSize: 17)
        copyButton.tintColor = UIColor(red: 0.84, green: 0.70, blue: 1, alpha: 1)
        copyButton.isEnabled = false
        copyButton.addTarget(self, action: #selector(copyLink), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [title, statusLabel, copyButton])
        stack.axis = .vertical
        stack.spacing = 20
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -24),
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor)
        ])
        readSharedURL()
    }

    private func readSharedURL() {
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
            DispatchQueue.main.async { self?.prepare(raw) }
        }
    }

    private func prepare(_ raw: String?) {
        guard let raw else {
            statusLabel.text = String(localized: "share.unsupported")
            return
        }
        let linkText = raw.range(of: #"https?://[^\s]+"#, options: .regularExpression).map { String(raw[$0]) } ?? raw
        guard let source = URL(string: linkText.trimmingCharacters(in: .whitespacesAndNewlines)),
              ["music.apple.com", "geo.music.apple.com", "open.spotify.com", "spotify.link", "music.youtube.com", "www.youtube.com", "youtube.com", "m.youtube.com", "youtu.be", "www.deezer.com", "deezer.com", "link.deezer.com", "deezer.page.link", "soundcloud.com", "m.soundcloud.com", "on.soundcloud.com"].contains(source.host?.lowercased() ?? ""),
              let base = Bundle.main.object(forInfoDictionaryKey: "ShareBaseURL") as? String,
              !base.contains("YOUR_DOMAIN_HERE"),
              var components = URLComponents(string: base + "/s") else {
            statusLabel.text = String(localized: "share.unsupported")
            return
        }
        components.queryItems = [URLQueryItem(name: "url", value: source.absoluteString)]
        smartURL = components.url
        statusLabel.text = String(localized: "share.ready")
        copyButton.isEnabled = smartURL != nil
    }

    @objc private func copyLink() {
        guard let smartURL else { return }
        UIPasteboard.general.url = smartURL
        extensionContext?.completeRequest(returningItems: nil)
    }
}
