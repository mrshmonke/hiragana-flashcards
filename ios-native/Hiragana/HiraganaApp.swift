import SwiftUI
import UIKit
import WebKit

// The flashcards are the same HTML/JS as the web version (docs/ios), packed
// inside the app and served from the app bundle, so everything works offline.

@main
struct HiraganaApp: App {
    var body: some Scene {
        WindowGroup {
            FlashcardsView()
                .ignoresSafeArea()
        }
    }
}

struct FlashcardsView: UIViewRepresentable {
    func makeCoordinator() -> Bridge { Bridge() }

    func makeUIView(context: Context) -> WKWebView {
        let bridge = context.coordinator
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(BundleFiles(), forURLScheme: BundleFiles.scheme)
        config.userContentController.add(bridge, name: "native")
        if let restore = bridge.restoreScript() {
            config.userContentController.addUserScript(
                WKUserScript(source: restore, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        let web = WKWebView(frame: .zero, configuration: config)
        web.uiDelegate = bridge
        web.isOpaque = false
        web.backgroundColor = .systemBackground
        web.scrollView.backgroundColor = .systemBackground
        // Let the page handle the notch and home bar itself (CSS safe-area insets).
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.allowsBackForwardNavigationGestures = false
        bridge.webView = web
        web.load(URLRequest(url: URL(string: "\(BundleFiles.scheme)://app/ios/index.html")!))
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

/// Serves files from the app bundle's "web" folder at app://app/...
/// (ES modules don't load from file:// URLs, so a custom scheme is needed.)
final class BundleFiles: NSObject, WKURLSchemeHandler {
    static let scheme = "app"
    private let root = Bundle.main.resourceURL!.appendingPathComponent("web", isDirectory: true).standardizedFileURL

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        var path = url.path
        if path.isEmpty || path.hasSuffix("/") { path += "index.html" }
        let file = root.appendingPathComponent(String(path.drop(while: { $0 == "/" }))).standardizedFileURL
        guard file.path.hasPrefix(root.path), let data = try? Data(contentsOf: file) else {
            let notFound = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: [:])!
            task.didReceive(notFound)
            task.didReceive(Data())
            task.didFinish()
            return
        }
        let headers = [
            "Content-Type": Self.mimeType(file.pathExtension),
            "Content-Length": String(data.count),
            "Cache-Control": "no-cache",
        ]
        task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    static func mimeType(_ ext: String) -> String {
        switch ext.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json", "webmanifest": return "application/json"
        case "png": return "image/png"
        case "woff2": return "font/woff2"
        case "txt": return "text/plain; charset=utf-8"
        default: return "application/octet-stream"
        }
    }
}

/// Talks to the page: keeps a copy of progress in the app's Documents folder
/// (restored if the web storage is ever cleared), shows the share sheet for
/// exports, and shows JavaScript alert/confirm dialogs.
final class Bridge: NSObject, WKScriptMessageHandler, WKUIDelegate {
    weak var webView: WKWebView?
    static let storageKey = "jp-tutor-v1"

    private var backupURL: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("progress.json")
    }

    /// Script that puts the saved progress back if localStorage is empty.
    func restoreScript() -> String? {
        guard let saved = try? String(contentsOf: backupURL, encoding: .utf8), !saved.isEmpty,
              let literal = try? String(data: JSONEncoder().encode(saved), encoding: .utf8) else { return nil }
        return "try{if(!localStorage.getItem('\(Self.storageKey)'))localStorage.setItem('\(Self.storageKey)',\(literal));}catch(e){}"
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "backup":
            if let data = body["data"] as? String {
                try? data.write(to: backupURL, atomically: true, encoding: .utf8)
            }
        case "share":
            guard let data = body["data"] as? String else { return }
            let name = (body["name"] as? String) ?? "japanese-progress.json"
            let file = FileManager.default.temporaryDirectory.appendingPathComponent(name)
            do { try data.write(to: file, atomically: true, encoding: .utf8) } catch { return }
            let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
            if let web = webView {
                sheet.popoverPresentationController?.sourceView = web
                sheet.popoverPresentationController?.sourceRect = CGRect(x: web.bounds.midX, y: web.bounds.midY, width: 1, height: 1)
            }
            topController()?.present(sheet, animated: true)
        default:
            break
        }
    }

    private func topController() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        var top = scene?.windows.first(where: { $0.isKeyWindow })?.rootViewController ?? scene?.windows.first?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        guard let top = topController() else { completionHandler(); return }
        top.present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        guard let top = topController() else { completionHandler(false); return }
        top.present(alert, animated: true)
    }
}
