import AppKit
import Combine
import Foundation

// Compile this fixture as module NewTabPage so the production type guard and
// reflection/Combine calling convention run unchanged against both layouts.
final class NewTabPageViewModel {
    struct State: Equatable {
        var windowID = "window-sentinel"
        var displayDefaultBrowserUpsell = true
        var displayReleaseNotesPostcard = false
        var displayWelcomePostcardTeaser = true
        #if DAYLIGHT_LAYOUT
        var hidePostcardsOnlyWhenCommandBarIntersects = false
        #endif
        var displayTrialGuideStampCard = false
        var displayAppsUpsellBar = true
        var displayNewSingleAppUpsell = false
        var themePalette: String? = "theme-sentinel"
        var skillOverridePalette: String? = "skill-sentinel"
        var profileCustomizationPermitted = true
        var displayTryForAWeek = false
        var greeting: String? = "greeting-sentinel"
        var bookmarkBarMode = 37
        var konamiCodeOnboardingIntroTriggerEnabled = false
        #if !DAYLIGHT_LAYOUT && !GALLERY_LAYOUT
        var diaProBackgroundButtonState: Int? = 89
        #endif
        var lightConfiguration = "light-sentinel"
        #if DAYLIGHT_LAYOUT || GALLERY_LAYOUT
        var daylightEffectInputs = "daylight-sentinel"
        #endif
        var areAnimationsEnabled = false
        #if REBRAND_LAYOUT || DAYLIGHT_LAYOUT || GALLERY_LAYOUT
        var isRebrandEnabled = false
        #endif
        var isPersonalizeButtonEnabled = true
        #if REBRAND_LAYOUT || DAYLIGHT_LAYOUT || GALLERY_LAYOUT
        #if INVALID_TYPE
        var showDiaIcon = "wrong-type-sentinel"
        #else
        var showDiaIcon = false
        #endif
        #else
        var showParticlesLogo = false
        #endif
        var isPresentingCliaOnboardingView = true
        #if GALLERY_LAYOUT
        var creationGallery: [String]? = ["gallery-sentinel"]
        #endif
        #if UNKNOWN_LAYOUT
        var unexpectedField = false
        #endif
    }

    let stateSubject: CurrentValueSubject<State, Never>
    init(_ state: State) { stateSubject = CurrentValueSubject(state) }
}

@main
struct AdvancedChatFixture {
    @MainActor
    static func main() {
        for rebrand in [false, true] {
            var initial = NewTabPageViewModel.State()
            #if REBRAND_LAYOUT || DAYLIGHT_LAYOUT || GALLERY_LAYOUT
            initial.isRebrandEnabled = rebrand
            #endif
            let model = NewTabPageViewModel(initial)
            var publications = 0
            let subscription = model.stateSubject.sink { _ in publications += 1 }
            let applied = diaCustomSwiftEnableAdvancedNewTabSurface(
                Unmanaged.passUnretained(model).toOpaque())
            #if INVALID_TYPE || UNKNOWN_LAYOUT
            assert(!applied)
            assert(model.stateSubject.value == initial)
            assert(publications == 1)
            #else
            assert(applied)
            var expected = initial
            expected.isPersonalizeButtonEnabled = false
            #if REBRAND_LAYOUT || DAYLIGHT_LAYOUT || GALLERY_LAYOUT
            expected.showDiaIcon = true
            #else
            expected.showParticlesLogo = true
            #endif
            assert(model.stateSubject.value == expected,
                "only the two Advanced Chat appearance fields may change")
            assert(publications == 2, "the real Combine subject must publish the change")
            assert(diaCustomSwiftEnableAdvancedNewTabSurface(Unmanaged.passUnretained(model).toOpaque()))
            assert(publications == 2, "an already applied appearance must not republish")
            #endif
            withExtendedLifetime(subscription) {}
        }
        #if INVALID_TYPE
        print("ok    Advanced Chat rejects a non-Boolean native appearance field without mutation")
        #elseif UNKNOWN_LAYOUT
        print("ok    Advanced Chat rejects an unknown native state layout without mutation")
        #elseif GALLERY_LAYOUT
        print("ok    Advanced Chat preserves the 1.55 creation gallery and all nonappearance state")
        #elseif DAYLIGHT_LAYOUT
        print("ok    Advanced Chat applies the 22-field daylight layout and preserves native state")
        #elseif REBRAND_LAYOUT
        print("ok    Advanced Chat applies the 21-field rebrand layout and preserves native rebrand/settings state")
        #else
        print("ok    Advanced Chat applies the guarded 20-field native layout through Combine")
        #endif
    }
}
