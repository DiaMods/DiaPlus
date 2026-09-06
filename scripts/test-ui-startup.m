// Exercise the real bootstrap against AppKit without launching Dia or touching
// a browser profile. The constructor ignores this test executable's name.
#include "../src/bootstrap/offline-bootstrap.c"
#include <assert.h>

int main(void) {
    @autoreleasepool {
        setenv("DIA_CUSTOM_MODS", "developer-tools", 1);
        unsetenv("DIA_CUSTOM_RUNTIME_LOG");
        [NSApplication sharedApplication];
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
    }
    return 0;
}
