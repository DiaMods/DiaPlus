import Foundation

private func describe(_ value: Any,
                      label: String,
                      depth: Int,
                      forceExpand: Bool = false,
                      into lines: inout [String]) {
    let mirror = Mirror(reflecting: value)
    let typeName = String(reflecting: Swift.type(of: value))
    let simpleValue = mirror.children.isEmpty
        ? " value=\(String(reflecting: value))"
        : ""
    lines.append(String(repeating: "  ", count: depth) + "\(label): \(typeName) style=\(String(describing: mirror.displayStyle))\(simpleValue)")

    guard depth < (forceExpand ? 10 : 4) else { return }
    for (index, child) in mirror.children.enumerated() {
        let childLabel = child.label ?? "[\(index)]"
        let normalizedLabel = (label + "." + childLabel).lowercased()
        let childForcesExpansion = forceExpand
            || normalizedLabel.contains("presenter")
            || normalizedLabel.contains("prompttools")
            || normalizedLabel.contains("menuitemsbyaction")
        let shouldExpand = depth == 0
            || childForcesExpansion
            || mirror.displayStyle == .dictionary
            || mirror.displayStyle == .tuple
        let childType = String(reflecting: Swift.type(of: child.value))
        let childMirror = Mirror(reflecting: child.value)
        let childValue = childMirror.children.isEmpty
            ? " value=\(String(reflecting: child.value))"
            : ""
        lines.append(String(repeating: "  ", count: depth + 1) + "\(childLabel): \(childType)\(childValue)")
        if shouldExpand {
            describe(child.value,
                     label: childLabel,
                     depth: depth + 2,
                     forceExpand: childForcesExpansion,
                     into: &lines)
        }
    }
}

private func reflectedField(in value: Any,
                            containerTypeName: String,
                            fieldName: String,
                            depth: Int = 0) -> Any? {
    guard depth <= 18 else { return nil }
    let typeName = String(reflecting: Swift.type(of: value))
    let mirror = Mirror(reflecting: value)

    if typeName == containerTypeName {
        return mirror.children.first(where: { $0.label == fieldName })?.value
    }

    // The target is held inside DependencyValues' CachedValues dictionary as
    // an AnySendable.base. The property wrapper also contains source metadata
    // and a key path; those branches cannot contain the live dependency.
    for child in mirror.children {
        if child.label == "keyPath" || child.label == "file" ||
            child.label == "fileID" || child.label == "line" ||
            child.label == "lock" {
            continue
        }
        if let result = reflectedField(in: child.value,
                                       containerTypeName: containerTypeName,
                                       fieldName: fieldName,
                                       depth: depth + 1) {
            return result
        }
    }
    return nil
}

private func appendActionProbe(_ message: String) {
    guard let runtimePath = ProcessInfo.processInfo.environment["DIA_CUSTOM_RUNTIME_LOG"] else {
        return
    }
    let path = runtimePath + ".swift-action"
    let line = (message + "\n").data(using: .utf8)!
    if !FileManager.default.fileExists(atPath: path) {
        FileManager.default.createFile(atPath: path, contents: nil)
    }
    guard let handle = FileHandle(forWritingAtPath: path) else { return }
    defer { try? handle.close() }
    do {
        try handle.seekToEnd()
        try handle.write(contentsOf: line)
    } catch {
    }
}

@_cdecl("dia_custom_swift_invoke_window_presenter_action")
@MainActor
public func diaCustomSwiftInvokeWindowPresenterAction(
    _ rawApplicationController: UnsafeRawPointer?,
    _ rawFieldName: UnsafePointer<CChar>?
) -> Bool {
    guard let rawApplicationController, let rawFieldName else { return false }
    let controller = Unmanaged<AnyObject>
        .fromOpaque(rawApplicationController)
        .takeUnretainedValue()
    let fieldName = String(cString: rawFieldName)
    guard let windowPresenterWrapper = Mirror(reflecting: controller).children
        .first(where: { $0.label == "_windowPresenter" })?.value else {
        appendActionProbe("\(fieldName): missing _windowPresenter wrapper")
        return false
    }
    guard let field = reflectedField(in: windowPresenterWrapper,
                                     containerTypeName: "Application.WindowPresenter",
                                     fieldName: fieldName) else {
        appendActionProbe("\(fieldName): field not found")
        return false
    }

    appendActionProbe("\(fieldName): fieldType=\(String(reflecting: Swift.type(of: field)))")
    if let action = field as? @MainActor @Sendable () -> Void {
        appendActionProbe("\(fieldName): invoking main-actor sendable closure")
        action()
        return true
    }
    if let action = field as? () -> Void {
        appendActionProbe("\(fieldName): invoking plain closure")
        action()
        return true
    }
    appendActionProbe("\(fieldName): closure cast failed")
    return false
}

@_cdecl("dia_custom_swift_log_object")
public func diaCustomSwiftLogObject(_ rawObject: UnsafeRawPointer?,
                                    _ rawLabel: UnsafePointer<CChar>?,
                                    _ rawPath: UnsafePointer<CChar>?) {
    guard let rawObject, let rawPath else { return }
    let object = Unmanaged<AnyObject>.fromOpaque(rawObject).takeUnretainedValue()
    let label = rawLabel.map { String(cString: $0) } ?? "object"
    let path = String(cString: rawPath)
    var lines: [String] = ["\n=== SWIFT MIRROR \(label) ==="]
    describe(object, label: label, depth: 0, into: &lines)
    lines.append("")
    guard let data = lines.joined(separator: "\n").data(using: .utf8) else { return }
    if !FileManager.default.fileExists(atPath: path) {
        FileManager.default.createFile(atPath: path, contents: nil)
    }
    guard let handle = FileHandle(forWritingAtPath: path) else { return }
    defer { try? handle.close() }
    do {
        try handle.seekToEnd()
        try handle.write(contentsOf: data)
    } catch {
    }
}
