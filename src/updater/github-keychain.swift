import Foundation
import Security

// Fixed service/account: this helper cannot access arbitrary Keychain records.
let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "local.rttm.dia.updater.github",
    kSecAttrAccount as String: "DiaMods/DiaPlus",
    kSecAttrSynchronizable as String: false]
func fail() -> Never { fputs("GitHub Keychain operation failed.\n", stderr); exit(1) }
let input = FileHandle.standardInput.readDataToEndOfFile()
guard input.count <= 65536,
      let request = try? JSONSerialization.jsonObject(with: input) as? [String: Any],
      let operation = request["operation"] as? String else { fail() }
var output: Any = NSNull()
switch operation {
case "get":
    var search = query
    search[kSecReturnData as String] = true
    search[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(search as CFDictionary, &result)
    if status != errSecItemNotFound {
        guard status == errSecSuccess, let data = result as? Data,
              let value = try? JSONSerialization.jsonObject(with: data) else { fail() }
        output = value
    }
case "set":
    guard let value = request["value"] as? [String: Any],
          let data = try? JSONSerialization.data(withJSONObject: value), data.count <= 32768 else { fail() }
    let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if status == errSecItemNotFound {
        var insertion = query
        insertion[kSecValueData as String] = data
        // The classic macOS login Keychain supports ad-hoc signed CLI helpers.
        // Its encrypted item uses the helper's default application ACL; never
        // use unsupported iOS accessibility attributes or iCloud synchronization.
        guard SecItemAdd(insertion as CFDictionary, nil) == errSecSuccess else { fail() }
    } else if status != errSecSuccess { fail() }
    output = true
case "delete":
    let status = SecItemDelete(query as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else { fail() }
    output = true
default: fail()
}
guard let encoded = try? JSONSerialization.data(withJSONObject: output, options: [.fragmentsAllowed]) else { fail() }
FileHandle.standardOutput.write(encoded)
