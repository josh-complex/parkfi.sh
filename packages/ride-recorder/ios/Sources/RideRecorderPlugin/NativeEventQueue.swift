import Foundation

/// Durable on-device event queue (park-tracking fixes 2, Workstream A) — iOS
/// mirror of `NativeEventQueue.kt`.
///
/// Region transitions and ride detections are appended here the moment they
/// happen, with the time they happened, and drained to the JS listeners on
/// plugin `load()`, on `didBecomeActive`, and on the JS `drainPending()` call.
/// Before the queue, a background relaunch for a region event had no
/// `CLLocationManager` delegate at all (the geofence manager was created lazily
/// on the first JS call), so the pending event was simply never received; with
/// `load()` now creating the manager, the event arrives — and this file is what
/// keeps it if the WebView isn't ready to consume it.
///
/// Format: one JSON object per line, `{"kind":"…","at":<epochMs>,"payload":{…}}`,
/// hand-framed with a fixed prefix so a corrupt line fails the parse and is
/// skipped. Bounded to `maxLines` / `maxBytes`, oldest evicted first. All file
/// access serializes on one process-wide lock.
final class NativeEventQueue {
    struct Event: Equatable {
        let kind: String
        let at: Int64
        let payloadJson: String

        func toLine() -> String {
            "\(Event.pKind)\(kind)\(Event.pAt)\(at)\(Event.pPayload)\(payloadJson)}"
        }

        private static let pKind = "{\"kind\":\""
        private static let pAt = "\",\"at\":"
        private static let pPayload = ",\"payload\":"

        /// Strict inverse of `toLine()`; nil for anything malformed.
        static func parse(_ line: String) -> Event? {
            guard line.hasPrefix(pKind), line.hasSuffix("}") else { return nil }
            let afterKindPrefix = line.index(line.startIndex, offsetBy: pKind.count)
            guard let kindEnd = line[afterKindPrefix...].firstIndex(of: "\"") else { return nil }
            let kind = String(line[afterKindPrefix..<kindEnd])
            guard kind.range(of: "^[a-z]+$", options: .regularExpression) != nil else { return nil }
            guard line[kindEnd...].hasPrefix(pAt) else { return nil }
            let atStart = line.index(kindEnd, offsetBy: pAt.count)
            guard let atEnd = line[atStart...].firstIndex(of: ",") else { return nil }
            guard let at = Int64(line[atStart..<atEnd]) else { return nil }
            guard line[atEnd...].hasPrefix(pPayload) else { return nil }
            let payloadStart = line.index(atEnd, offsetBy: pPayload.count)
            let payload = String(line[payloadStart..<line.index(before: line.endIndex)])
            guard payload.hasPrefix("{"), payload.hasSuffix("}") else { return nil }
            return Event(kind: kind, at: at, payloadJson: payload)
        }
    }

    static let kindTransition = "transition"
    static let kindRide = "ride"
    static let kindPing = "ping"

    static let maxLines = 200
    static let maxBytes = 5 * 1024 * 1024

    private static let lock = NSLock()

    private let url: URL

    init(url: URL) {
        self.url = url
    }

    /// The app's queue: `Application Support/ride-recorder/events.jsonl`.
    static func shared() -> NativeEventQueue {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return NativeEventQueue(url: base.appendingPathComponent("ride-recorder/events.jsonl"))
    }

    /// Append one event. Never throws; `payloadJson` must be a single-line JSON
    /// object (raw newlines are stripped defensively).
    func enqueue(kind: String, at: Int64, payloadJson: String) {
        guard kind.range(of: "^[a-z]+$", options: .regularExpression) != nil else { return }
        let payload = payloadJson.replacingOccurrences(of: "\n", with: "").replacingOccurrences(of: "\r", with: "")
        guard !payload.isEmpty else { return }
        let line = Event(kind: kind, at: at, payloadJson: payload).toLine()
        NativeEventQueue.lock.lock()
        defer { NativeEventQueue.lock.unlock() }
        var lines = readLinesUnlocked()
        lines.append(line)
        evict(&lines)
        writeLinesUnlocked(lines)
    }

    /// Read every parseable event (oldest first), truncate, return.
    func drain() -> [Event] {
        NativeEventQueue.lock.lock()
        defer { NativeEventQueue.lock.unlock() }
        let events = readLinesUnlocked().compactMap { Event.parse($0) }
        try? FileManager.default.removeItem(at: url)
        return events
    }

    private func readLinesUnlocked() -> [String] {
        guard let data = try? Data(contentsOf: url), let text = String(data: data, encoding: .utf8) else {
            return []
        }
        return text.split(separator: "\n", omittingEmptySubsequences: true).map(String.init)
    }

    private func evict(_ lines: inout [String]) {
        while lines.count > NativeEventQueue.maxLines { lines.removeFirst() }
        var bytes = lines.reduce(0) { $0 + $1.utf8.count + 1 }
        while lines.count > 1, bytes > NativeEventQueue.maxBytes {
            bytes -= lines[0].utf8.count + 1
            lines.removeFirst()
        }
    }

    /// Atomic rewrite so a crash mid-write can't leave a torn line.
    private func writeLinesUnlocked(_ lines: [String]) {
        let dir = url.deletingLastPathComponent()
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let text = lines.isEmpty ? "" : lines.joined(separator: "\n") + "\n"
        try? text.data(using: .utf8)?.write(to: url, options: .atomic)
    }
}
