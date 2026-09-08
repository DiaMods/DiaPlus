import AppKit
import Foundation
let path = URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL.resolvingSymlinksInPath()
let apps = NSWorkspace.shared.runningApplications.filter {
    $0.bundleURL?.standardizedFileURL.resolvingSymlinksInPath() == path
}
for app in apps {
    guard app.bundleIdentifier == "local.rttm.dia", app.terminate() else { exit(2) }
}
let deadline = Date().addingTimeInterval(45)
while apps.contains(where: { !$0.isTerminated }) && Date() < deadline {
    RunLoop.current.run(until: Date().addingTimeInterval(0.1))
}
exit(apps.contains(where: { !$0.isTerminated }) ? 3 : 0)
