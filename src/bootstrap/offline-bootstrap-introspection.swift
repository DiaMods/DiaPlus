import Foundation

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
