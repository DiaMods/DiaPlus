import Foundation
import Vision

// Some macOS preview/hosted images cannot initialize the automatic-language
// recognizer. Retry only that precise native failure, never arbitrary OCR errors.
func isOCRReaderCompatibilityError(_ error: Error) -> Bool {
    var current = error as NSError
    for _ in 0..<8 {
        if current.domain == "TextRecognition.CRImageReaderError", current.code == 9 { return true }
        guard let underlying = current.userInfo[NSUnderlyingErrorKey] as? NSError else { return false }
        current = underlying
    }
    return false
}

func recognizeTextWithCompatibilityFallback(
    perform: (VNRecognizeTextRequest) throws -> Void
) throws -> (request: VNRecognizeTextRequest, compatibility: Bool) {
    let primary = VNRecognizeTextRequest()
    primary.recognitionLevel = .accurate
    primary.automaticallyDetectsLanguage = true
    do {
        try perform(primary)
        return (primary, false)
    } catch {
        guard isOCRReaderCompatibilityError(error) else { throw error }
        var lastError = error
        let revisions = VNRecognizeTextRequest.supportedRevisions.filter { $0 <= primary.revision }.sorted(by: >)
        for level in [VNRequestTextRecognitionLevel.accurate, .fast] {
            for revision in revisions {
                let request = VNRecognizeTextRequest()
                request.revision = revision
                request.recognitionLevel = level
                request.automaticallyDetectsLanguage = false
                // Query each revision/level; do not assume they support the same languages.
                let supported = try request.supportedRecognitionLanguages()
                let preferred = Locale.preferredLanguages + ["en-US"]
                let language = preferred.compactMap { preference in
                    supported.first { $0 == preference } ?? supported.first {
                        $0.split(separator: "-").first == preference.split(separator: "-").first
                    }
                }.first ?? supported.first
                guard let language else { continue }
                request.recognitionLanguages = [language]
                do {
                    try perform(request)
                    return (request, true)
                } catch {
                    guard isOCRReaderCompatibilityError(error) else { throw error }
                    lastError = error
                }
            }
        }
        // Exhaustion remains a real extraction failure, not empty successful OCR.
        throw lastError
    }
}
