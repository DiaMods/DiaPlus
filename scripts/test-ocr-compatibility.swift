import Foundation
import Vision
import PDFKit
import AppKit

@main
struct OCRCompatibilityTests {
    static func main() throws {
        let readerError = NSError(domain: "TextRecognition.CRImageReaderError", code: 9)
        let unrelated = NSError(domain: "TestOCR", code: 9)
        precondition(isOCRReaderCompatibilityError(readerError))
        precondition(isOCRReaderCompatibilityError(NSError(domain: "Vision", code: 1,
            userInfo: [NSUnderlyingErrorKey: readerError])))
        precondition(!isOCRReaderCompatibilityError(unrelated))

        var calls = 0
        let primary = try recognizeTextWithCompatibilityFallback { request in
            calls += 1
            precondition(request.automaticallyDetectsLanguage)
        }
        precondition(calls == 1 && !primary.compatibility)

        calls = 0
        let fallback = try recognizeTextWithCompatibilityFallback { request in
            calls += 1
            if calls == 1 { throw readerError }
            precondition(!request.automaticallyDetectsLanguage)
            precondition(!request.recognitionLanguages.isEmpty)
        }
        precondition(calls == 2 && fallback.compatibility)

        calls = 0
        let fast = try recognizeTextWithCompatibilityFallback { request in
            calls += 1
            if request.recognitionLevel == .accurate { throw readerError }
        }
        precondition(calls > 2 && fast.compatibility && fast.request.recognitionLevel == .fast)

        calls = 0
        do {
            _ = try recognizeTextWithCompatibilityFallback { _ in calls += 1; throw unrelated }
            fatalError("Unrelated failure was suppressed")
        } catch { precondition((error as NSError).domain == unrelated.domain && calls == 1) }
        do {
            _ = try recognizeTextWithCompatibilityFallback { _ in throw readerError }
            fatalError("Exhausted recognizers returned success")
        } catch { precondition(isOCRReaderCompatibilityError(error)) }

        // Exercise real recognition after a deliberately failed primary attempt,
        // even on Macs where the primary recognizer normally works.
        let document = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1]))!
        let thumbnail = document.page(at: 0)!.thumbnail(of: NSSize(width: 1400, height: 1400), for: .mediaBox)
        let image = thumbnail.cgImage(forProposedRect: nil, context: nil, hints: nil)!
        let handler = VNImageRequestHandler(cgImage: image)
        calls = 0
        let realFallback = try recognizeTextWithCompatibilityFallback { request in
            calls += 1
            if calls == 1 { throw readerError }
            try handler.perform([request])
        }
        let text = (realFallback.request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: " ")
        precondition(realFallback.compatibility && text.contains("MEDIA FIXTURE"), "Fallback must recognize real fixture text")
        print("OCR primary, specific-error fallback, fast/legacy fallback and failure propagation passed")
    }
}
