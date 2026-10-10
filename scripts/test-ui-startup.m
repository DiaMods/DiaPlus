// Exercise the real bootstrap against AppKit without launching Dia or touching
// a browser profile. The constructor ignores this test executable's name.
#include "../src/bootstrap/offline-bootstrap.c"
#include <assert.h>

static NSUInteger vendor_update_checks;
@interface SPUUpdater : NSObject
- (void)checkForUpdatesInBackground;
@end
@implementation SPUUpdater
- (void)checkForUpdatesInBackground { vendor_update_checks += 1; }
@end

static NSUInteger dock_window_requests;
static NSUInteger dock_incognito_requests;
@interface DiaCustomDockFixture : NSObject <NSApplicationDelegate>
- (NSMenu *)applicationDockMenu:(NSApplication *)application;
- (void)newWindow:(id)sender;
- (void)newIncognitoWindow:(id)sender;
- (void)unrelatedCommand:(id)sender;
@end
@implementation DiaCustomDockFixture
- (NSMenu *)applicationDockMenu:(NSApplication *)application {
    (void)application;
    NSMenu *menu = [[[NSMenu alloc] initWithTitle:@"Native Dock"] autorelease];
    for (NSDictionary *entry in @[
        @{@"title": @"New Window", @"action": @"newWindow:"},
        @{@"title": @"New Incognito Window", @"action": @"newIncognitoWindow:"},
        @{@"title": @"Unrelated", @"action": @"unrelatedCommand:"},
    ]) {
        NSMenuItem *item = [[[NSMenuItem alloc] initWithTitle:entry[@"title"]
            action:NSSelectorFromString(entry[@"action"]) keyEquivalent:@""] autorelease];
        item.target = self;
        item.enabled = NO;
        [menu addItem:item];
    }
    return menu;
}
- (BOOL)validateMenuItem:(NSMenuItem *)item { (void)item; return NO; }
- (void)newWindow:(id)sender { (void)sender; dock_window_requests += 1; }
- (void)newIncognitoWindow:(id)sender { (void)sender; dock_incognito_requests += 1; }
- (void)unrelatedCommand:(id)sender { (void)sender; assert(false); }
@end
@interface DiaCustomInheritedDockFixture : DiaCustomDockFixture
@end
@implementation DiaCustomInheritedDockFixture
@end

@interface MemoryPreferencePaneContentViewFixture : NSView
@end
@implementation MemoryPreferencePaneContentViewFixture
@end

int main(void) {
    @autoreleasepool {
        DiaCustomModsPaneContext *context = [[DiaCustomModsPaneContext alloc] init];
        assert([context conformsToProtocol:@protocol(WKUIDelegate)]);
        __block BOOL confirmed = YES;
        __block NSUInteger completions = 0;
        [context webView:nil runJavaScriptConfirmPanelWithMessage:@"untrusted"
            initiatedByFrame:nil completionHandler:^(BOOL result) {
            confirmed = result; completions += 1;
        }];
        assert(!confirmed && completions == 1);
        assert([context webView:nil createWebViewWithConfiguration:nil
            forNavigationAction:nil windowFeatures:nil] == nil);
        [context release];
        puts("ok    Settings owns WebKit confirmations and denies untrusted dialogs/popups");
    }
    @autoreleasepool {
        setenv("DIA_CUSTOM_MODS", "developer-tools", 1);
        unsetenv("DIA_CUSTOM_RUNTIME_LOG");
        int originalCount = *_NSGetArgc();
        char **originalArguments = *_NSGetArgv();
        char *fixtureArguments[] = { "test-ui-startup", NULL };
        *_NSGetArgc() = 1;
        *_NSGetArgv() = fixtureArguments;
        dia_custom_install_process_arguments(@"/tmp/native-keychain-profile");
        int expandedCount = *_NSGetArgc();
        char **expandedArguments = *_NSGetArgv();
        assert(!dia_custom_has_process_argument(expandedArguments, expandedCount,
            "--use-mock-keychain"));
        assert(dia_custom_has_process_argument(expandedArguments, expandedCount,
            "--user-data-dir=/tmp/native-keychain-profile/User Data"));
        *_NSGetArgc() = originalCount;
        *_NSGetArgv() = originalArguments;
        for (int index = 1; index < expandedCount; ++index) free(expandedArguments[index]);
        free(expandedArguments);
        puts("ok    Finder launch retains the custom app's real Keychain encryption");
        NSDictionary *health = @{
            @"ok": @YES, @"coreReady": @YES, @"catalog": @{@"modelCount": @1},
            @"runtimeID": @"fixture", @"profileDirectory": @"/tmp/native-health-profile",
            @"enabledMods": @[@"native-memory", @"local-web"],
        };
        assert(dia_custom_bridge_health_matches(health, @"fixture",
            @"/tmp/native-health-profile", @"local-web,native-memory"));
        for (NSDictionary *change in @[
            @{@"ok": @NO}, @{@"coreReady": @NO}, @{@"catalog": @{@"modelCount": @0}},
            @{@"runtimeID": @"stale"}, @{@"profileDirectory": @"/tmp/other-profile"},
            @{@"enabledMods": @[@"local-web"]}, @{@"enabledMods": @[@1]},
        ]) {
            NSMutableDictionary *invalid = [health mutableCopy];
            [invalid addEntriesFromDictionary:change];
            assert(!dia_custom_bridge_health_matches(invalid, @"fixture",
                @"/tmp/native-health-profile", @"local-web,native-memory"));
            [invalid release];
        }
        assert(!dia_custom_bridge_health_matches(@[], @"fixture", @"/tmp/p", @"a"));
        assert(!dia_custom_swift_invoke_morning_brief(NULL, NULL, NULL));
        puts("ok    Finder bridge health validates runtime, profile, mods and readiness");
        [NSApplication sharedApplication];
        setenv("DIA_CUSTOM_MODS", "native-memory", 1);
        dia_custom_local_memory_state = -1;
        dia_custom_local_memory_request_in_flight = NO;
        dia_custom_set_memory_last_refresh(nil);
        dia_custom_install_local_memory_controls(NSApp, @selector(toggleLocalMemory:));
        assert(!dia_custom_local_memory_request_in_flight);
        assert(dia_custom_local_memory_last_refresh == nil);
        assert(dia_custom_local_memory_state == -1);
        puts("ok    absent native Memory settings do not poll or mutate bridge-owned Memory state");
        MemoryPreferencePaneContentViewFixture *memoryPane = [[[MemoryPreferencePaneContentViewFixture alloc] init] autorelease];
        NSButton *memoryToggle = [[[NSButton alloc] init] autorelease];
        memoryToggle.title = @"Enable Memory";
        [memoryPane addSubview:memoryToggle];
        NSView *otherPane = [[[NSView alloc] init] autorelease];
        dia_custom_local_memory_state = 0;
        assert(!dia_custom_apply_native_memory_state_in_view(otherPane, NSApp));
        assert(dia_custom_apply_native_memory_state_in_view(memoryPane, NSApp));
        assert(memoryToggle.target == NSApp);
        assert(memoryToggle.action == @selector(toggleLocalMemory:));
        assert(memoryToggle.enabled);
        puts("ok    existing native Memory panes retain their optional local control mirror");
        setenv("DIA_CUSTOM_MODS", "developer-tools", 1);
        id originalDelegate = NSApp.delegate;
        DiaCustomInheritedDockFixture *dockDelegate = [[[DiaCustomInheritedDockFixture alloc] init] autorelease];
        IMP originalBaseDockMethod = class_getMethodImplementation([DiaCustomDockFixture class], @selector(applicationDockMenu:));
        NSApp.delegate = dockDelegate;
        assert(dia_custom_install_dock_menu_hook());
        assert(dia_custom_install_dock_menu_hook());
        assert(class_getMethodImplementation([DiaCustomDockFixture class], @selector(applicationDockMenu:)) == originalBaseDockMethod);
        NSMenuItem *lastWindowItem = nil;
        for (NSUInteger request = 0; request < 2; ++request) {
            NSMenu *dock = [dockDelegate applicationDockMenu:NSApp];
            NSMenuItem *windowItem = [dock itemAtIndex:0];
            NSMenuItem *incognitoItem = [dock itemAtIndex:1];
            assert(windowItem != lastWindowItem);
            lastWindowItem = windowItem;
            [dock update];
            windowItem.enabled = NO;
            incognitoItem.enabled = NO;
            assert(windowItem.enabled && incognitoItem.enabled);
            assert(![dock itemAtIndex:2].enabled);
            assert(windowItem.target == dockDelegate && windowItem.action == @selector(newWindow:));
            assert(incognitoItem.target == dockDelegate && incognitoItem.action == @selector(newIncognitoWindow:));
            assert([NSApp sendAction:windowItem.action to:windowItem.target from:windowItem]);
            assert([NSApp sendAction:incognitoItem.action to:incognitoItem.target from:incognitoItem]);
        }
        assert(dock_window_requests == 2 && dock_incognito_requests == 2);
        DiaCustomDockFixture *unrelatedDelegate = [[[DiaCustomDockFixture alloc] init] autorelease];
        assert(![[unrelatedDelegate applicationDockMenu:NSApp] itemAtIndex:0].enabled);
        NSApp.delegate = originalDelegate;
        puts("ok    fresh Dock window items remain enabled with original native actions and unrelated validation intact");
        NSApp.mainMenu = nil;
        dia_custom_install_ui_runtime();
        id controller = dia_custom_developer_menu_controller;
        assert(controller != nil);
        dia_custom_install_ui_runtime();
        assert(controller == dia_custom_developer_menu_controller);

        // An absent menu must not prevent observer/controller registration.
        [NSNotificationCenter.defaultCenter
            postNotificationName:NSApplicationWillFinishLaunchingNotification
                          object:NSApp];
        NSMenu *main = [[NSMenu alloc] initWithTitle:@"Main"];
        NSMenuItem *view = [[NSMenuItem alloc] initWithTitle:@"View"
                                                   action:nil keyEquivalent:@""];
        view.submenu = [[NSMenu alloc] initWithTitle:@"View"];
        [main addItem:view];
        NSApp.mainMenu = main;
        for (NSUInteger index = 0; index < 3; ++index) {
            [NSNotificationCenter.defaultCenter
                postNotificationName:NSApplicationDidFinishLaunchingNotification
                              object:NSApp];
            [NSNotificationCenter.defaultCenter
                postNotificationName:NSWindowDidBecomeKeyNotification
                              object:nil];
        }
        assert(view.submenu.numberOfItems == 1);
        NSMenu *developer = [view.submenu itemWithTitle:@"Developer"].submenu;
        assert(developer.numberOfItems == 4);
        assert([developer itemWithTitle:@"AI Model"] == nil);
        for (NSMenuItem *item in developer.itemArray) {
            assert(item.target == controller);
        }
        puts("ok    UI startup observes launch before menus exist and installs once");

        NSMenuItem *updates = [[NSMenuItem alloc] initWithTitle:@"Check for Updates…"
            action:@selector(checkForUpdates:) keyEquivalent:@""];
        [main addItem:updates];
        SPUUpdater *vendor = [[SPUUpdater alloc] init];
        dia_custom_install_updater_controls(controller);
        assert(updates.action == @selector(checkForUpdates:));
        [vendor checkForUpdatesInBackground];
        assert(vendor_update_checks == 1);
        setenv("DIA_CUSTOM_MODS", "developer-tools,custom-updater", 1);
        dia_custom_install_updater_controls(controller);
        assert(updates.action == @selector(openCustomUpdater:));
        assert(updates.target == controller);
        [vendor checkForUpdatesInBackground];
        assert(vendor_update_checks == 1);
        puts("ok    custom updater retargets native menu and suppresses vendor checks only when enabled");
    }
    return 0;
}
