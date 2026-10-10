import AppKit
import Foundation
let path = URL(fileURLWithPath: CommandLine.arguments[1]).standardizedFileURL.resolvingSymlinksInPath()
let apps = NSWorkspace.shared.runningApplications.filter {
    $0.bundleURL?.standardizedFileURL.resolvingSymlinksInPath() == path
}
// Keep the original PIDs. NSRunningApplication.isTerminated can remain stale
// after the executable exits while LaunchServices tracks attributed services.
// Signal 0 only checks existence; it never terminates or forces an app.
let pids = apps.map { $0.processIdentifier }
func originalProcessesExited() -> Bool {
    return pids.allSatisfy { pid in kill(pid, 0) == -1 && errno == ESRCH }
}
for app in apps {
    guard app.bundleIdentifier == "local.rttm.dia", app.terminate() else { exit(2) }
}
let deadline = Date().addingTimeInterval(45)
while !originalProcessesExited() && Date() < deadline {
    RunLoop.current.run(until: Date().addingTimeInterval(0.1))
}
exit(originalProcessesExited() ? 0 : 3)
