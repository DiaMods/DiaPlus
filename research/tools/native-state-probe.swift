import Foundation
import AppKit

// Read stored fields only. Never invoke a reflected closure or native method.
// No strings, URLs, account data, collections or payload contents are emitted.
@_cdecl("dia_research_snapshot_states")
@MainActor
public func researchSnapshotStates() {
    guard Bundle.main.bundleIdentifier == "local.rttm.dia.browser-use-research",
          let profile = ProcessInfo.processInfo.environment["DIA_CUSTOM_PROFILE"],
          profile.contains("/dia-browser-use-research-") else { return }
    let relevant = try! NSRegularExpression(pattern: "spaces|workspace|task|clia|agent|reasoning|responseCommand|migration", options: .caseInsensitive)
    var queue: [(Any, String, Int)] = []
    if let delegate = NSApplication.shared.delegate { queue.append((delegate, "delegate", 0)) }
    for window in NSApplication.shared.windows {
        if let controller = window.windowController { queue.append((controller, "windowController", 0)) }
        if let view = window.contentView { queue.append((view, "contentView", 0)) }
    }
    var visited = Set<ObjectIdentifier>(), lines: [String] = [], index = 0
    while index < queue.count && index < 4000 {
        let (value, path, depth) = queue[index]; index += 1
        guard depth < 16 else { continue }
        let mirror = Mirror(reflecting: value)
        if mirror.displayStyle == .class {
            guard visited.insert(ObjectIdentifier(value as AnyObject)).inserted else { continue }
        }
        if let style = mirror.displayStyle, [Mirror.DisplayStyle.collection, .dictionary, .set].contains(style) { continue }
        let type = String(reflecting: Swift.type(of: value))
        guard !type.contains("->") else { continue }
        var fields = Array(mirror.children)
        if let parent = mirror.superclassMirror { fields += Array(parent.children) }
        for field in fields {
            guard let label = field.label else { continue }
            let name = path + "." + label
            let candidate = name + ":" + String(reflecting: Swift.type(of: field.value))
            let matches = relevant.firstMatch(in: candidate, range: NSRange(candidate.startIndex..., in: candidate)) != nil
            if matches, let flag = field.value as? Bool { lines.append(name + "=" + String(flag)) }
            else if matches {
                let child = Mirror(reflecting: field.value)
                if let style = child.displayStyle, [Mirror.DisplayStyle.collection, .dictionary, .set].contains(style) {
                    lines.append(name + ".count=" + String(child.children.count))
                } else { lines.append(candidate) }
            }
            if !(field.value is String) && !(field.value is Data) && queue.count < 4000 {
                queue.append((field.value, name, depth + 1))
            }
        }
    }
    let destination = URL(fileURLWithPath: profile).deletingLastPathComponent().appendingPathComponent("native-states.log")
    // Each launch replaces the previous diagnostic snapshot. It is not a log of
    // user interaction and has no credential or personal-data fallback.
    try? (lines.joined(separator: "\n") + "\n").write(to: destination, atomically: true, encoding: .utf8)
}
