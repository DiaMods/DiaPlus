import Foundation
import Darwin
import AppKit

@_silgen_name("swift_reflectionMirror_recursiveCount")
private func recursiveFieldCount(_ type: Any.Type) -> Int

@_silgen_name("swift_reflectionMirror_recursiveChildOffset")
private func recursiveFieldOffset(_ type: Any.Type, index: Int) -> Int

@_silgen_name("dia_custom_call_current_value_subject_send")
private func callCurrentValueSubjectSend(
    _ implementation: UnsafeRawPointer,
    _ subject: UnsafeRawPointer,
    _ value: UnsafeRawPointer
)

private func reflectedField(in value: Any,
                            containerTypeName: String,
                            fieldName: String,
                            depth: Int = 0) -> Any? {
    guard depth <= 18 else { return nil }
    let typeName = String(reflecting: Swift.type(of: value))
    let mirror = Mirror(reflecting: value)

    if typeName == containerTypeName {
        let normalizedName = fieldName.trimmingCharacters(in: CharacterSet(charactersIn: "_"))
        if let child = mirror.children.first(where: {
            ($0.label ?? "").trimmingCharacters(
                in: CharacterSet(charactersIn: "_")) == normalizedName
        }) {
            return reflectedVoidAction(in: child.value) ?? child.value
        }
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

private func reflectedVoidAction(in value: Any, depth: Int = 0) -> Any? {
    guard depth <= 12 else { return nil }
    if value is @MainActor @Sendable () -> Void || value is () -> Void {
        return value
    }
    let mirror = Mirror(reflecting: value)
    for child in mirror.children {
        if child.label == "keyPath" || child.label == "file" ||
            child.label == "fileID" || child.label == "line" ||
            child.label == "lock" {
            continue
        }
        if let action = reflectedVoidAction(in: child.value, depth: depth + 1) {
            return action
        }
    }
    return nil
}

private func reflectedContainerLabels(in value: Any,
                                      containerTypeName: String,
                                      depth: Int = 0) -> [String]? {
    guard depth <= 18 else { return nil }
    let mirror = Mirror(reflecting: value)
    if String(reflecting: Swift.type(of: value)) == containerTypeName {
        return mirror.children.map { $0.label ?? "<unnamed>" }
    }
    for child in mirror.children {
        if child.label == "keyPath" || child.label == "file" ||
            child.label == "fileID" || child.label == "line" ||
            child.label == "lock" {
            continue
        }
        if let labels = reflectedContainerLabels(in: child.value,
                                                  containerTypeName: containerTypeName,
                                                  depth: depth + 1) {
            return labels
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

private func directReflectedValue(in value: Any, named name: String) -> Any? {
    let normalizedName = name.trimmingCharacters(
        in: CharacterSet(charactersIn: "_"))
    let mirror = Mirror(reflecting: value)
    if let value = mirror.children.first(where: {
        ($0.label ?? "").trimmingCharacters(
            in: CharacterSet(charactersIn: "_")) == normalizedName
    })?.value {
        return value
    }
    return mirror.superclassMirror?.children.first(where: {
        ($0.label ?? "").trimmingCharacters(
            in: CharacterSet(charactersIn: "_")) == normalizedName
    })?.value
}

private func reflectedMenuItem(in value: Any, depth: Int = 0) -> NSMenuItem? {
    guard depth <= 4 else { return nil }
    if let menuItem = value as? NSMenuItem { return menuItem }
    for child in Mirror(reflecting: value).children {
        if let menuItem = reflectedMenuItem(in: child.value, depth: depth + 1) {
            return menuItem
        }
    }
    return nil
}

@MainActor
private func invokeNativeMenuAction(in orchestrator: AnyObject,
                                    named actionName: String) -> Bool {
    guard let itemsByAction = directReflectedValue(in: orchestrator,
                                                   named: "menuItemsByAction") else {
        let labels = Mirror(reflecting: orchestrator).children
            .compactMap(\.label).joined(separator: ",")
        appendActionProbe("\(actionName): native menu registry unavailable; type=\(String(reflecting: Swift.type(of: orchestrator))) labels=\(labels)")
        return false
    }
    for entry in Mirror(reflecting: itemsByAction).children {
        let pair = Array(Mirror(reflecting: entry.value).children)
        guard pair.count >= 2,
              String(describing: pair[0].value) == actionName else { continue }
        appendActionProbe("\(actionName): found native menu action")
        guard let menuItem = reflectedMenuItem(in: pair[1].value),
              let action = menuItem.action else {
            appendActionProbe("\(actionName): native menu item unavailable")
            return false
        }
        let sent = NSApplication.shared.sendAction(action,
                                                   to: menuItem.target,
                                                   from: menuItem)
        appendActionProbe("\(actionName): native menu action sent=\(sent)")
        return sent
    }
    appendActionProbe("\(actionName): native menu action not registered")
    return false
}

@_cdecl("dia_custom_swift_invoke_menu_action")
@MainActor
public func diaCustomSwiftInvokeMenuAction(
    _ rawMenuOrchestrator: UnsafeRawPointer?,
    _ rawActionName: UnsafePointer<CChar>?
) -> Bool {
    guard let rawMenuOrchestrator, let rawActionName else { return false }
    let owner = Unmanaged<AnyObject>
        .fromOpaque(rawMenuOrchestrator)
        .takeUnretainedValue()
    let orchestrator = (directReflectedValue(in: owner,
                                             named: "mainMenuOrchestrator") ??
        directReflectedValue(in: owner, named: "menuOrchestrator")) as AnyObject? ?? owner
    return invokeNativeMenuAction(in: orchestrator,
                                  named: String(cString: rawActionName))
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
        let labels = reflectedContainerLabels(
            in: windowPresenterWrapper,
            containerTypeName: "Application.WindowPresenter"
        ) ?? []
        appendActionProbe("\(fieldName): field not found; labels=\(labels.joined(separator: ","))")
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

private func sendMemoryStateCopy<T>(
    _ value: T,
    enabled: Bool,
    subject: AnyObject,
    implementation: UnsafeRawPointer
) -> Bool {
    let fields = Mirror(reflecting: value).children
    guard let first = fields.first,
          let current = first.value as? Bool else {
        appendActionProbe("memory-state: first field is not Bool")
        return false
    }

    let label = first.label ?? "<unnamed>"
    guard label.localizedCaseInsensitiveContains("memory") ||
          label.localizedCaseInsensitiveContains("enabled") else {
        appendActionProbe("memory-state: refusing unexpected first field \(label)")
        return false
    }
    if current == enabled {
        return true
    }

    var copy = value
    let didSend = withUnsafeMutableBytes(of: &copy) { bytes -> Bool in
        guard let firstByte = bytes.baseAddress, !bytes.isEmpty else {
            return false
        }
        firstByte.storeBytes(of: enabled, as: Bool.self)
        callCurrentValueSubjectSend(
            implementation,
            Unmanaged.passUnretained(subject).toOpaque(),
            UnsafeRawPointer(firstByte)
        )
        return true
    }
    if didSend {
        appendActionProbe("memory-state: sent \(label)=\(enabled)")
    }
    return didSend
}

@_cdecl("dia_custom_swift_set_native_memory_enabled")
@MainActor
public func diaCustomSwiftSetNativeMemoryEnabled(
    _ rawViewModel: UnsafeRawPointer?,
    _ enabled: Bool
) -> Bool {
    guard let rawViewModel else { return false }
    let viewModel = Unmanaged<AnyObject>
        .fromOpaque(rawViewModel)
        .takeUnretainedValue()
    guard let subject = Mirror(reflecting: viewModel).children
        .first(where: { $0.label == "stateSubject" })?.value as AnyObject? else {
        appendActionProbe("memory-state: missing stateSubject")
        return false
    }
    guard let currentValue = Mirror(reflecting: subject).children
        .first(where: { $0.label == "currentValue" })?.value else {
        appendActionProbe("memory-state: missing currentValue")
        return false
    }
    guard let symbol = dlsym(
        UnsafeMutableRawPointer(bitPattern: -2),
        "$s7Combine19CurrentValueSubjectC4sendyyxF"
    ) else {
        appendActionProbe("memory-state: CurrentValueSubject.send unavailable")
        return false
    }

    func open<T>(_ value: T) -> Bool {
        sendMemoryStateCopy(
            value,
            enabled: enabled,
            subject: subject,
            implementation: UnsafeRawPointer(symbol)
        )
    }
    return _openExistential(currentValue, do: open)
}

private func newTabPageViewModel(from rootObject: AnyObject) -> AnyObject? {
    let rootType = String(reflecting: Swift.type(of: rootObject))
    if rootType == "NewTabPage.NewTabPageViewModel" {
        return rootObject
    }
    guard rootType == "NewTabPage.NewTabPageViewController",
          let candidate = Mirror(reflecting: rootObject).children
            .first(where: { $0.label == "viewModel" })?.value else {
        return nil
    }
    let unwrapped = unwrappedOptional(candidate)
    guard let unwrapped,
          String(reflecting: Swift.type(of: unwrapped)) ==
            "NewTabPage.NewTabPageViewModel" else {
        return nil
    }
    return unwrapped as AnyObject
}

@MainActor
private func sendAdvancedNewTabStateCopy<T>(
    _ value: T,
    subject: AnyObject,
    implementation: UnsafeRawPointer
) -> Bool {
    let fields = Array(Mirror(reflecting: value).children)
    let expectedLabels = [
        "windowID",
        "displayDefaultBrowserUpsell",
        "displayReleaseNotesPostcard",
        "displayWelcomePostcardTeaser",
        "displayTrialGuideStampCard",
        "displayAppsUpsellBar",
        "displayNewSingleAppUpsell",
        "themePalette",
        "skillOverridePalette",
        "profileCustomizationPermitted",
        "displayTryForAWeek",
        "greeting",
        "bookmarkBarMode",
        "konamiCodeOnboardingIntroTriggerEnabled",
        "diaProBackgroundButtonState",
        "lightConfiguration",
        "areAnimationsEnabled",
        "isPersonalizeButtonEnabled",
        "showParticlesLogo",
        "isPresentingCliaOnboardingView",
    ]
    guard String(reflecting: T.self) == "NewTabPage.NewTabPageViewModel.State",
          fields.count == expectedLabels.count,
          fields.count == recursiveFieldCount(T.self),
          zip(fields, expectedLabels).allSatisfy({ $0.label == $1 }),
          fields[17].value is Bool,
          fields[18].value is Bool,
          fields[19].value is Bool else {
        if !didLogUnexpectedAdvancedNewTabState {
            didLogUnexpectedAdvancedNewTabState = true
            let fieldLayout = fields.enumerated().map { index, field in
                "\(index):\(field.label ?? "<unnamed>")=" +
                    String(reflecting: Swift.type(of: field.value))
            }.joined(separator: ",")
            appendActionProbe(
                "advanced-new-tab-state: refusing native layout " +
                "type=\(String(reflecting: T.self)) " +
                "count=\(fields.count)/\(recursiveFieldCount(T.self)) " +
                "fields=[\(fieldLayout)]")
        }
        return false
    }
    let personalizeEnabled = fields[17].value as! Bool
    let particlesVisible = fields[18].value as! Bool
    if !personalizeEnabled && particlesVisible {
        return true
    }

    var copy = value
    return withUnsafeMutableBytes(of: &copy) { bytes -> Bool in
        let personalizeOffset = recursiveFieldOffset(T.self, index: 17)
        let particlesOffset = recursiveFieldOffset(T.self, index: 18)
        guard let base = bytes.baseAddress,
              personalizeOffset >= 0,
              particlesOffset >= 0,
              personalizeOffset + MemoryLayout<Bool>.size <= bytes.count,
              particlesOffset + MemoryLayout<Bool>.size <= bytes.count else {
            return false
        }
        base.advanced(by: personalizeOffset).storeBytes(of: false, as: Bool.self)
        base.advanced(by: particlesOffset).storeBytes(of: true, as: Bool.self)
        callCurrentValueSubjectSend(
            implementation,
            Unmanaged.passUnretained(subject).toOpaque(),
            UnsafeRawPointer(base))
        appendActionProbe(
            "advanced-new-tab-state: enabled particles and disabled legacy personalization")
        return true
    }
}

@MainActor
private var didLogUnexpectedAdvancedNewTabState = false

@_cdecl("dia_custom_swift_enable_advanced_new_tab_surface")
@MainActor
public func diaCustomSwiftEnableAdvancedNewTabSurface(
    _ rawRootObject: UnsafeRawPointer?
) -> Bool {
    guard let rawRootObject else { return false }
    let rootObject = Unmanaged<AnyObject>
        .fromOpaque(rawRootObject)
        .takeUnretainedValue()
    guard let viewModel = newTabPageViewModel(from: rootObject),
          let subject = Mirror(reflecting: viewModel).children
            .first(where: { $0.label == "stateSubject" })?.value as AnyObject?,
          let currentValue = Mirror(reflecting: subject).children
            .first(where: { $0.label == "currentValue" })?.value,
          let symbol = dlsym(
            UnsafeMutableRawPointer(bitPattern: -2),
            "$s7Combine19CurrentValueSubjectC4sendyyxF") else {
        appendActionProbe("advanced-new-tab-state: native view model unavailable")
        return false
    }
    func open<T>(_ value: T) -> Bool {
        sendAdvancedNewTabStateCopy(
            value,
            subject: subject,
            implementation: UnsafeRawPointer(symbol))
    }
    return _openExistential(currentValue, do: open)
}

private func sendAppsLocalStateCopy<T>(
    _ value: T,
    morningBriefEnabled: Bool,
    subject: AnyObject,
    implementation: UnsafeRawPointer
) -> Bool {
    let fields = Array(Mirror(reflecting: value).children)
    guard fields.count == recursiveFieldCount(T.self),
          fields.first?.label == "isCliaEnabled",
          fields.count > 17,
          fields[10].label == "isRedesignEnabled",
          fields[15].label == "morningBriefPreference",
          fields[16].label == "isMorningBriefSourceAvailable",
          fields[17].label == "isMorningBriefSubscriptionEligible",
          fields[0].value is Bool,
          fields[10].value is Bool,
          String(reflecting: Swift.type(of: fields[15].value)) ==
            "Swift.Optional<CliaReport.MorningBriefGenerationPreference>",
          fields[16].value is Bool?,
          fields[17].value is Bool else {
        appendActionProbe("apps-state: refusing unexpected native state layout")
        return false
    }
    let currentEnabled = fields[0].value as! Bool
    let currentRedesign = fields[10].value as! Bool
    let currentPreference = String(describing: fields[15].value)
    let currentSource = fields[16].value as! Bool?
    let currentEligible = fields[17].value as! Bool
    let desiredPreference = morningBriefEnabled ? ".daily)" : ".never)"
    if currentEnabled && currentRedesign && currentSource == true && currentEligible &&
        currentPreference.hasSuffix(desiredPreference) {
        return true
    }
    var copy = value
    return withUnsafeMutableBytes(of: &copy) { bytes -> Bool in
        let offsets = [0, 10, 15, 16, 17].map {
            recursiveFieldOffset(T.self, index: $0)
        }
        guard let base = bytes.baseAddress,
              offsets.allSatisfy({ $0 >= 0 && $0 < bytes.count }) else { return false }
        base.advanced(by: offsets[0]).storeBytes(of: true, as: Bool.self)
        base.advanced(by: offsets[1]).storeBytes(of: true, as: Bool.self)
        // Native enum reflection confirms byte 0 is `.daily`, byte 1 is
        // `.never`, and byte 2 is Optional.none for this audited build.
        base.advanced(by: offsets[2]).storeBytes(
            of: morningBriefEnabled ? UInt8(0) : UInt8(1), as: UInt8.self)
        var sourceAvailable: Bool? = true
        withUnsafeBytes(of: &sourceAvailable) { sourceBytes in
            base.advanced(by: offsets[3]).copyMemory(
                from: sourceBytes.baseAddress!, byteCount: sourceBytes.count)
        }
        base.advanced(by: offsets[4]).storeBytes(of: true, as: Bool.self)
        callCurrentValueSubjectSend(
            implementation,
            Unmanaged.passUnretained(subject).toOpaque(),
            UnsafeRawPointer(base)
        )
        appendActionProbe("apps-state: sent local enabled state morningBrief=\(morningBriefEnabled)")
        return true
    }
}

@_cdecl("dia_custom_swift_set_native_apps_enabled")
@MainActor
public func diaCustomSwiftSetNativeAppsEnabled(
    _ rawViewModel: UnsafeRawPointer?,
    _ morningBriefEnabled: Bool
) -> Bool {
    guard let rawViewModel else { return false }
    let viewModel = Unmanaged<AnyObject>.fromOpaque(rawViewModel).takeUnretainedValue()
    guard let subject = Mirror(reflecting: viewModel).children
        .first(where: { $0.label == "stateSubject" })?.value as AnyObject?,
          let currentValue = Mirror(reflecting: subject).children
        .first(where: { $0.label == "currentValue" })?.value,
          let symbol = dlsym(
            UnsafeMutableRawPointer(bitPattern: -2),
            "$s7Combine19CurrentValueSubjectC4sendyyxF"
          ) else {
        appendActionProbe("apps-state: state subject unavailable")
        return false
    }
    func open<T>(_ value: T) -> Bool {
        sendAppsLocalStateCopy(
            value,
            morningBriefEnabled: morningBriefEnabled,
            subject: subject,
            implementation: UnsafeRawPointer(symbol)
        )
    }
    return _openExistential(currentValue, do: open)
}

private func unwrappedOptional(_ value: Any) -> Any? {
    let mirror = Mirror(reflecting: value)
    guard mirror.displayStyle == .optional else { return value }
    return mirror.children.first?.value
}

private func reflectedValue(_ value: Any, named name: String) -> Any? {
    Mirror(reflecting: value).children.first(where: { $0.label == name })?.value
}

private func reflectedString(_ value: Any, named name: String) -> String? {
    guard let candidate = reflectedValue(value, named: name),
          let unwrapped = unwrappedOptional(candidate) else { return nil }
    return unwrapped as? String
}

private func stableProfileIdentifier(_ value: Any, depth: Int = 0) -> String? {
    guard depth <= 5, let candidate = unwrappedOptional(value) else { return nil }
    let raw: String?
    if let string = candidate as? String {
        raw = string
    } else if let uuid = candidate as? UUID {
        raw = uuid.uuidString
    } else if String(reflecting: Swift.type(of: candidate)).hasSuffix(".ProfileID") {
        raw = String(describing: candidate)
    } else {
        raw = ["rawValue", "profileID", "id", "identifier", "value"]
            .compactMap { label in
                reflectedValue(candidate, named: label)
                    .flatMap { stableProfileIdentifier($0, depth: depth + 1) }
            }
            .first
    }
    guard let identifier = raw?.trimmingCharacters(in: .whitespacesAndNewlines),
          !identifier.isEmpty,
          identifier.count <= 120,
          !identifier.contains("/"),
          !identifier.contains("\\"),
          !identifier.contains("\0") else { return nil }
    return identifier
}

private func nativeAppsSelectedProfileID<T>(_ value: T) -> String? {
    guard let selected = reflectedValue(value, named: "selectedProfileID") else {
        return nil
    }
    return stableProfileIdentifier(selected)
}

@_cdecl("dia_custom_swift_native_apps_selected_profile_id")
@MainActor
public func diaCustomSwiftNativeAppsSelectedProfileID(
    _ rawViewModel: UnsafeRawPointer?
) -> UnsafeMutablePointer<CChar>? {
    guard let rawViewModel else { return nil }
    let viewModel = Unmanaged<AnyObject>.fromOpaque(rawViewModel).takeUnretainedValue()
    guard let subject = Mirror(reflecting: viewModel).children
        .first(where: { $0.label == "stateSubject" })?.value as AnyObject?,
          let currentValue = Mirror(reflecting: subject).children
        .first(where: { $0.label == "currentValue" })?.value else { return nil }
    func open<T>(_ value: T) -> String? { nativeAppsSelectedProfileID(value) }
    guard let profileID = _openExistential(currentValue, do: open) else { return nil }
    return strdup(profileID)
}

@_cdecl("dia_custom_swift_native_apps_morning_brief_state")
@MainActor
public func diaCustomSwiftNativeAppsMorningBriefState(
    _ rawObject: UnsafeRawPointer?
) -> Int32 {
    guard let rawObject else { return -1 }
    let object = Unmanaged<AnyObject>.fromOpaque(rawObject).takeUnretainedValue()
    var preference = Mirror(reflecting: object).children
        .first(where: { $0.label == "morningBriefPreference" })?.value
    if preference == nil,
       let subject = Mirror(reflecting: object).children
        .first(where: { $0.label == "stateSubject" })?.value {
        let state = Mirror(reflecting: subject).children
            .first(where: { $0.label == "currentValue" })?.value
        if let state {
            preference = Mirror(reflecting: state).children
                .first(where: { $0.label == "morningBriefPreference" })?.value
        }
    }
    guard let preference else { return -1 }
    let description = String(describing: preference).lowercased()
    if description == "daily" || description.hasSuffix(".daily)") { return 1 }
    if description == "never" || description.hasSuffix(".never)") ||
        description == "nil" { return 0 }
    return -1
}

private func nativeConnectorID(displayName: String, fallback: String? = nil) -> String {
    let known: [String: String] = [
        "google calendar": "google-calendar",
        "google drive": "google-drive",
        "gmail": "gmail",
        "github": "github",
        "slack": "slack",
        "notion": "notion",
        "linkedin": "linkedin",
    ]
    if let exact = known[displayName.lowercased()] { return exact }
    let source = fallback?.isEmpty == false ? fallback! : displayName
    let scalars = source.lowercased().unicodeScalars.map { scalar -> Character in
        CharacterSet.alphanumerics.contains(scalar) ? Character(String(scalar)) : "-"
    }
    return String(scalars).split(separator: "-").filter { !$0.isEmpty }.joined(separator: "-")
}

private func nativeAppsConnections<T>(_ value: T) -> [[String: Any]]? {
    let fields = Array(Mirror(reflecting: value).children)
    guard fields.count > 8,
          fields[3].label == "builtInApps",
          fields[8].label == "providerRowDisplays" else { return nil }
    var rows: [String: [String: Any]] = [:]

    for child in Mirror(reflecting: fields[3].value).children {
        let item = child.value
        guard let displayName = reflectedString(item, named: "displayName") else { continue }
        let state = reflectedValue(item, named: "connectionState")
            .map { String(describing: $0).lowercased() } ?? ""
        let id = nativeConnectorID(displayName: displayName)
        rows[id] = [
            "id": id,
            "connected": !state.contains("notconnected") && state.contains("connected"),
            "autoConnected": state.contains("auto"),
        ]
    }

    for child in Mirror(reflecting: fields[8].value).children {
        let item = child.value
        guard let displayName = reflectedString(item, named: "displayName") else { continue }
        let fallbackID = reflectedString(item, named: "id")
        let id = nativeConnectorID(displayName: displayName, fallback: fallbackID)
        let connected = reflectedValue(item, named: "isConnected") as? Bool ?? false
        var row: [String: Any] = [
            "id": id,
            "connected": connected,
            "autoConnected": false,
        ]
        for name in ["activeGoogleEmail", "subtitle"] {
            if let label = reflectedString(item, named: name), !label.isEmpty {
                row["accountLabel"] = String(label.prefix(200))
                break
            }
        }
        rows[id] = row
    }
    return rows.values.sorted {
        ($0["id"] as? String ?? "") < ($1["id"] as? String ?? "")
    }
}

@_cdecl("dia_custom_swift_native_apps_connections_json")
@MainActor
public func diaCustomSwiftNativeAppsConnectionsJSON(
    _ rawViewModel: UnsafeRawPointer?
) -> UnsafeMutablePointer<CChar>? {
    guard let rawViewModel else { return nil }
    let viewModel = Unmanaged<AnyObject>.fromOpaque(rawViewModel).takeUnretainedValue()
    guard let subject = Mirror(reflecting: viewModel).children
        .first(where: { $0.label == "stateSubject" })?.value as AnyObject?,
          let currentValue = Mirror(reflecting: subject).children
        .first(where: { $0.label == "currentValue" })?.value else { return nil }
    func open<T>(_ value: T) -> [[String: Any]]? { nativeAppsConnections(value) }
    guard let connections = _openExistential(currentValue, do: open),
          JSONSerialization.isValidJSONObject(connections),
          let data = try? JSONSerialization.data(withJSONObject: connections),
          let json = String(data: data, encoding: .utf8) else { return nil }
    return strdup(json)
}

@_cdecl("dia_custom_swift_invoke_native_apps_enable")
@MainActor
public func diaCustomSwiftInvokeNativeAppsEnable(_ rawView: UnsafeRawPointer?) -> Bool {
    guard let rawView else { return false }
    let view = Unmanaged<AnyObject>.fromOpaque(rawView).takeUnretainedValue()
    guard let candidate = Mirror(reflecting: view).children
        .first(where: { $0.label == "onToggleClia" })?.value else {
        appendActionProbe("apps-enable-action: onToggleClia unavailable")
        return false
    }
    appendActionProbe("apps-enable-action: type=\(String(reflecting: Swift.type(of: candidate)))")
    if let action = candidate as? @MainActor @Sendable (Bool) -> Void {
        action(true)
        return true
    }
    if let action = candidate as? (Bool) -> Void {
        action(true)
        return true
    }
    if let action = candidate as? @MainActor @Sendable () -> Void {
        action()
        return true
    }
    if let action = candidate as? () -> Void {
        action()
        return true
    }
    appendActionProbe("apps-enable-action: closure cast failed")
    return false
}
