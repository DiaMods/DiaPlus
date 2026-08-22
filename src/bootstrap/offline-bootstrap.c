#import <AppKit/AppKit.h>
#include <objc/runtime.h>
#include <dispatch/dispatch.h>
#include <dlfcn.h>
#include <mach-o/dyld.h>
#include <mach/mach.h>
#include <malloc/malloc.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

extern void dia_custom_swift_log_object(const void *object,
                                        const char *label,
                                        const char *path);
extern BOOL dia_custom_swift_invoke_window_presenter_action(
    const void *applicationController,
    const char *fieldName);
extern void *dia_custom_call_prompt_tools_allocating_init(
    const void *initializer,
    const void *classMetadata,
    const void *browserID,
    const void *dependencyPropagationToken);
extern void dia_custom_call_platform_window_prompt_tools_presenter(
    const void *implementation,
    const void *platformWindow,
    const void *promptToolsController);

// These offsets belong to Dia build 85660, the build cloned by this project.
// Keeping them here (rather than rewriting call sites in the app executable)
// makes the experiment fail closed on a future build with different code.
static const uintptr_t DIA_CUSTOM_PROMPT_TOOLS_INIT_OFFSET = 0x047d15c4;
static const uintptr_t DIA_CUSTOM_PROMPT_TOOLS_PRESENT_OFFSET = 0x050fb604;

static const void *dia_custom_main_image_address(uintptr_t unslidOffset) {
    const struct mach_header *header = _dyld_get_image_header(0);
    if (header == NULL) {
        return NULL;
    }
    return (const void *)((uintptr_t)header + unslidOffset);
}

static void dia_custom_log_request_url(NSURL *url) {
    const char *path = getenv("DIA_CUSTOM_NETWORK_LOG");
    if (path == NULL || path[0] == '\0' || url == nil) {
        return;
    }

    NSURLComponents *components = [NSURLComponents componentsWithURL:url
                                              resolvingAgainstBaseURL:NO];
    components.query = nil;
    components.fragment = nil;
    NSString *safeURL = components.string;
    if (safeURL == nil) {
        return;
    }

    FILE *output = fopen(path, "a");
    if (output == NULL) {
        return;
    }
    flockfile(output);
    fprintf(output, "%.3f\t%s\n",
            [[NSDate date] timeIntervalSince1970], [safeURL UTF8String]);
    funlockfile(output);
    fclose(output);
}

static BOOL dia_custom_should_block_request_url(NSURL *url) {
    NSString *host = [[url host] lowercaseString];
    if (host == nil || [host isEqualToString:@"localhost"] ||
        [host isEqualToString:@"127.0.0.1"] ||
        [host isEqualToString:@"::1"]) {
        return NO;
    }

    NSArray<NSString *> *blockedHosts = @[
        @"api.segment.io",
        @"cdn-settings.segment.com",
        @"clientstream.launchdarkly.com",
        @"mobile.launchdarkly.com",
        @"releases.diabrowser.com",
    ];
    if ([blockedHosts containsObject:host]) {
        return YES;
    }
    return [host hasSuffix:@".diabrowser.engineering"] ||
           [host hasSuffix:@".thebrowser.company"];
}

typedef void (*DiaCustomTaskResumeIMP)(id, SEL);

typedef struct {
    Class cls;
    DiaCustomTaskResumeIMP original;
} DiaCustomTaskResumeEntry;

static DiaCustomTaskResumeEntry dia_custom_task_resume_entries[8];
static size_t dia_custom_task_resume_entry_count = 0;

static void dia_custom_task_resume(id task, SEL command) {
    NSURLRequest *request = [task currentRequest];
    if (request == nil) {
        request = [task originalRequest];
    }
    dia_custom_log_request_url(request.URL);
    if (dia_custom_should_block_request_url(request.URL)) {
        [task cancel];
        return;
    }

    Class cls = object_getClass(task);
    while (cls != Nil) {
        for (size_t i = 0; i < dia_custom_task_resume_entry_count; ++i) {
            if (dia_custom_task_resume_entries[i].cls == cls) {
                dia_custom_task_resume_entries[i].original(task, command);
                return;
            }
        }
        cls = class_getSuperclass(cls);
    }
}

static void dia_custom_install_task_resume_log(void) {
    if (getenv("DIA_CUSTOM_NETWORK_LOG") == NULL ||
        dia_custom_task_resume_entry_count != 0) {
        return;
    }

    NSArray<NSString *> *classNames = @[
        @"NSURLSessionTask",
        @"__NSCFURLSessionTask",
        @"__NSCFLocalSessionTask",
    ];
    SEL selector = @selector(resume);

    // Capture every original implementation before installing any override so
    // an inherited method never points back to this logger.
    for (NSString *className in classNames) {
        Class cls = NSClassFromString(className);
        Method method = cls != Nil ? class_getInstanceMethod(cls, selector) : NULL;
        if (method == NULL || dia_custom_task_resume_entry_count >= 8) {
            continue;
        }
        dia_custom_task_resume_entries[dia_custom_task_resume_entry_count++] =
            (DiaCustomTaskResumeEntry){
                .cls = cls,
                .original = (DiaCustomTaskResumeIMP)method_getImplementation(method),
            };
    }

    for (size_t i = 0; i < dia_custom_task_resume_entry_count; ++i) {
        Class cls = dia_custom_task_resume_entries[i].cls;
        Method method = class_getInstanceMethod(cls, selector);
        const char *types = method_getTypeEncoding(method);
        if (!class_addMethod(cls, selector, (IMP)dia_custom_task_resume, types)) {
            method_setImplementation(method, (IMP)dia_custom_task_resume);
        }
    }
}

@interface DiaCustomLoggingURLProtocol : NSURLProtocol
@end

@implementation DiaCustomLoggingURLProtocol
+ (BOOL)canInitWithRequest:(NSURLRequest *)request {
    dia_custom_log_request_url(request.URL);
    return NO;
}

+ (NSURLRequest *)canonicalRequestForRequest:(NSURLRequest *)request {
    return request;
}

- (void)startLoading {}
- (void)stopLoading {}
@end

static int dia_custom_name_is_interesting(const char *name) {
    if (name == NULL) {
        return 0;
    }

    const char *needles[] = {
        "Auth", "auth", "Onboard", "onboard", "ApplicationController",
        "Unboxing", "Launch", "WindowController", "PromptTools",
        "RoutingOverrides", "Gauntlet", "Clia", "Preferences",
        "FeatureFlag", "DevTools", "SupertabFrontend", "PlatformWindow"
    };
    for (size_t i = 0; i < sizeof(needles) / sizeof(needles[0]); ++i) {
        if (strstr(name, needles[i]) != NULL) {
            return 1;
        }
    }
    return 0;
}

static void dia_custom_log_methods(FILE *output, Class cls, const char *prefix) {
    unsigned int count = 0;
    Method *methods = class_copyMethodList(cls, &count);
    for (unsigned int i = 0; i < count; ++i) {
        const char *selector = sel_getName(method_getName(methods[i]));
        fprintf(output, "  %s%s\n", prefix, selector != NULL ? selector : "<unknown>");
    }
    free(methods);
}

static void dia_custom_log_ivars(FILE *output, id object) {
    if (object == nil) {
        return;
    }
    Class cls = object_getClass(object);
    while (cls != Nil) {
        unsigned int count = 0;
        Ivar *ivars = class_copyIvarList(cls, &count);
        fprintf(output, "IVARS class=%s object=%p\n", class_getName(cls), object);
        for (unsigned int i = 0; i < count; ++i) {
            const char *name = ivar_getName(ivars[i]);
            const char *type = ivar_getTypeEncoding(ivars[i]);
            ptrdiff_t offset = ivar_getOffset(ivars[i]);
            fprintf(output, "  offset=%td name=%s type=%s",
                    offset,
                    name != NULL ? name : "<unknown>",
                    type != NULL ? type : "<unknown>");
            if (type != NULL && type[0] == '@') {
                id value = object_getIvar(object, ivars[i]);
                fprintf(output, " value=%s %p",
                        value != nil ? class_getName(object_getClass(value)) : "<nil>",
                        value);
            }
            fputc('\n', output);
        }
        free(ivars);
        cls = class_getSuperclass(cls);
    }
}

static BOOL dia_custom_class_implements_selector(Class cls, const char *selectorName) {
    unsigned int count = 0;
    Method *methods = class_copyMethodList(cls, &count);
    BOOL found = NO;
    for (unsigned int i = 0; i < count; ++i) {
        const char *name = sel_getName(method_getName(methods[i]));
        if (name != NULL && strcmp(name, selectorName) == 0) {
            found = YES;
            break;
        }
    }
    free(methods);
    return found;
}

static id dia_custom_object_ivar(id object, const char *name) {
    if (object == nil || name == NULL) {
        return nil;
    }
    Ivar ivar = class_getInstanceVariable(object_getClass(object), name);
    if (ivar == NULL) {
        return nil;
    }
    return object_getIvar(object, ivar);
}

typedef struct {
    Class targetClass;
    uintptr_t isaMask;
    id result;
} DiaCustomHeapSearch;

static void dia_custom_heap_range_recorder(task_t task,
                                           void *context,
                                           unsigned type,
                                           vm_range_t *ranges,
                                           unsigned rangeCount) {
    DiaCustomHeapSearch *search = context;
    if (search->result != nil) {
        return;
    }
    for (unsigned i = 0; i < rangeCount; ++i) {
        if (ranges[i].size < sizeof(uintptr_t)) {
            continue;
        }
        uintptr_t rawIsa = *(const uintptr_t *)(uintptr_t)ranges[i].address;
        Class candidateClass = (Class)(rawIsa & search->isaMask);
        if (candidateClass == search->targetClass ||
            (Class)rawIsa == search->targetClass) {
            search->result = (id)(uintptr_t)ranges[i].address;
            return;
        }
    }
}

static id dia_custom_find_live_object(NSString *className) {
    Class targetClass = NSClassFromString(className);
    if (targetClass == Nil) {
        return nil;
    }

    uintptr_t isaMask = UINTPTR_MAX;
    uintptr_t *runtimeMask = dlsym(RTLD_DEFAULT, "objc_debug_isa_class_mask");
    if (runtimeMask != NULL && *runtimeMask != 0) {
        isaMask = *runtimeMask;
    }

    vm_address_t *zones = NULL;
    unsigned zoneCount = 0;
    kern_return_t result = malloc_get_all_zones(
        mach_task_self(), NULL, &zones, &zoneCount);
    if (result != KERN_SUCCESS) {
        return nil;
    }

    DiaCustomHeapSearch search = {
        .targetClass = targetClass,
        .isaMask = isaMask,
        .result = nil,
    };
    for (unsigned i = 0; i < zoneCount && search.result == nil; ++i) {
        malloc_zone_t *zone = (malloc_zone_t *)(uintptr_t)zones[i];
        if (zone == NULL || zone->introspect == NULL ||
            zone->introspect->enumerator == NULL) {
            continue;
        }
        zone->introspect->enumerator(
            mach_task_self(), &search, MALLOC_PTR_IN_USE_RANGE_TYPE,
            (vm_address_t)(uintptr_t)zone, NULL,
            dia_custom_heap_range_recorder);
    }
    return search.result;
}

static void dia_custom_log_runtime(void) {
    const char *path = getenv("DIA_CUSTOM_RUNTIME_LOG");
    if (path == NULL || path[0] == '\0') {
        return;
    }

    FILE *output = fopen(path, "w");
    if (output == NULL) {
        return;
    }

    int count = objc_getClassList(NULL, 0);
    Class *classes = calloc((size_t)count, sizeof(Class));
    if (classes == NULL) {
        fclose(output);
        return;
    }
    count = objc_getClassList(classes, count);
    for (int i = 0; i < count; ++i) {
        const char *name = class_getName(classes[i]);
        BOOL ownsModelPickerAction = dia_custom_class_implements_selector(
            classes[i], "handleModelSelectorClicked");
        if (!dia_custom_name_is_interesting(name) && !ownsModelPickerAction) {
            continue;
        }
        fprintf(output, "%s\n", name);
        dia_custom_log_methods(output, classes[i], "-");
        Class meta = object_getClass(classes[i]);
        if (meta != Nil) {
            dia_custom_log_methods(output, meta, "+");
        }
    }
    free(classes);
    fclose(output);
}

static void dia_custom_log_menu(NSMenu *menu, FILE *output, NSUInteger depth) {
    for (NSMenuItem *item in [menu itemArray]) {
        id target = [item target];
        const char *targetName = target != nil
            ? class_getName(object_getClass(target))
            : "<responder-chain>";
        fprintf(output,
                "%*sMENU title=%s hidden=%d enabled=%d key=%s action=%s target=%s\n",
                (int)(depth * 2), "",
                [[item title] UTF8String], [item isHidden], [item isEnabled],
                [[item keyEquivalent] UTF8String],
                [item action] != NULL ? sel_getName([item action]) : "<none>",
                targetName != NULL ? targetName : "<unknown>");
        if ([item hasSubmenu]) {
            dia_custom_log_menu([item submenu], output, depth + 1);
        }
    }
}

static void dia_custom_schedule_menu_log(void) {
    const char *path = getenv("DIA_CUSTOM_RUNTIME_LOG");
    if (path == NULL || path[0] == '\0') {
        return;
    }
    NSString *logPath = [NSString stringWithUTF8String:path];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 2500 * NSEC_PER_MSEC),
                   dispatch_get_main_queue(), ^{
        FILE *output = fopen([logPath fileSystemRepresentation], "a");
        if (output == NULL) {
            return;
        }
        fprintf(output, "\n=== MAIN MENU ===\n");
        dia_custom_log_menu([NSApp mainMenu], output, 0);
        fclose(output);
    });
}

static void dia_custom_schedule_network_log(void) {
    if (getenv("DIA_CUSTOM_NETWORK_LOG") == NULL) {
        return;
    }

    // Model Registry starts during application construction, before the main
    // queue runs. Install both observers synchronously so its first request is
    // visible too; the old delayed installation missed that request entirely.
    [NSURLProtocol registerClass:[DiaCustomLoggingURLProtocol class]];
    dia_custom_install_task_resume_log();
}

static void dia_custom_close_account_window(void) {
    if (getenv("DIA_CUSTOM_SKIP_ACCOUNT_UI") == NULL) {
        return;
    }

    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 1500 * NSEC_PER_MSEC),
                   dispatch_get_main_queue(), ^{
        NSArray<NSWindow *> *windows = [NSApp windows];
        for (NSWindow *window in windows) {
            NSString *identifier = [[window identifier] lowercaseString];
            NSString *className = [NSStringFromClass([window class]) lowercaseString];
            if ([identifier containsString:@"unboxing"] ||
                [className containsString:@"unboxing"]) {
                [window orderOut:nil];
                [window close];
            }
        }
    });
}

static id dia_custom_prompt_tools_window_controller(void) {
    NSArray<NSWindow *> *windows = [NSApp windows];
    NSWindow *preferred = [NSApp keyWindow] ?: [NSApp mainWindow];
    if (preferred != nil) {
        windows = [@[preferred] arrayByAddingObjectsFromArray:windows];
    }

    for (NSWindow *window in windows) {
        if (![NSStringFromClass([window class]) containsString:@"PlatformWindow"]) {
            continue;
        }
        @try {
            id controller = [window valueForKey:@"promptToolsWindowController"];
            if (controller != nil) {
                return controller;
            }
        } @catch (__unused NSException *exception) {
        }
    }
    return nil;
}

static NSWindow *dia_custom_platform_window(void) {
    NSArray<NSWindow *> *windows = [NSApp windows];
    NSWindow *preferred = [NSApp keyWindow] ?: [NSApp mainWindow];
    if (preferred != nil &&
        [NSStringFromClass([preferred class]) containsString:@"PlatformWindow"]) {
        return preferred;
    }
    for (NSWindow *window in windows) {
        if ([NSStringFromClass([window class]) containsString:@"PlatformWindow"] &&
            [window isVisible]) {
            return window;
        }
    }
    for (NSWindow *window in windows) {
        if ([NSStringFromClass([window class]) containsString:@"PlatformWindow"]) {
            return window;
        }
    }
    return nil;
}

static void dia_custom_log_prompt_tools_stage(NSString *stage, id value) {
    const char *path = getenv("DIA_CUSTOM_RUNTIME_LOG");
    if (path == NULL || path[0] == '\0') {
        return;
    }
    FILE *output = fopen(path, "a");
    if (output == NULL) {
        return;
    }
    fprintf(output, "PROMPT_TOOLS stage=%s class=%s value=%p\n",
            [stage UTF8String],
            value != nil ? class_getName(object_getClass(value)) : "<nil>",
            value);
    fflush(output);
    fclose(output);
}

static id dia_custom_prompt_tools_controller;

static id dia_custom_create_prompt_tools_controller(NSWindow *platformWindow) {
    if (dia_custom_prompt_tools_controller != nil) {
        return dia_custom_prompt_tools_controller;
    }

    NSString *build = [[NSBundle mainBundle]
        objectForInfoDictionaryKey:@"CFBundleVersion"];
    if (![build isEqualToString:@"85660"] || platformWindow == nil) {
        dia_custom_log_prompt_tools_stage(@"unsupported-build-or-window", nil);
        return nil;
    }

    id windowViewModel = nil;
    @try {
        windowViewModel = [platformWindow valueForKey:@"viewModel"];
    } @catch (__unused NSException *exception) {
        return nil;
    }
    Ivar browserIDIvar = windowViewModel != nil
        ? class_getInstanceVariable(object_getClass(windowViewModel), "browserID")
        : NULL;
    Class promptToolsClass = NSClassFromString(
        @"SupertabFrontend.PromptToolsController");
    if (browserIDIvar == NULL || promptToolsClass == Nil) {
        dia_custom_log_prompt_tools_stage(@"missing-runtime-types", nil);
        return nil;
    }

    const uint8_t *browserID = (const uint8_t *)(__bridge const void *)windowViewModel
        + ivar_getOffset(browserIDIvar);

    // A nil propagation parent is a valid root token. Prompt Tools' static
    // dependencies (including routing-overrides persistence) still resolve
    // from DependencyValues; browser-context-only helpers remain optional.
    // Swift's weak-reference value witness accepts this all-zero nil layout.
    uintptr_t dependencyPropagationToken[2] = {0, 0};
    const void *initializer = dia_custom_main_image_address(
        DIA_CUSTOM_PROMPT_TOOLS_INIT_OFFSET);
    dia_custom_log_prompt_tools_stage(@"constructing", nil);
    id controller = (__bridge id)dia_custom_call_prompt_tools_allocating_init(
        initializer,
        (__bridge const void *)promptToolsClass,
        browserID,
        dependencyPropagationToken);
    if (controller == nil || ![controller isKindOfClass:promptToolsClass]) {
        dia_custom_log_prompt_tools_stage(@"constructor-returned-invalid", controller);
        return nil;
    }
    dia_custom_prompt_tools_controller = controller;
    dia_custom_log_prompt_tools_stage(@"constructed", controller);
    return controller;
}

static BOOL dia_custom_present_prompt_tools(void) {
    NSWindow *platformWindow = dia_custom_platform_window();
    if (platformWindow == nil) {
        return NO;
    }
    id controller = dia_custom_create_prompt_tools_controller(platformWindow);
    if (controller == nil) {
        return NO;
    }

    id existingWindowController = dia_custom_prompt_tools_window_controller();
    if (existingWindowController == nil) {
        const void *presenter = dia_custom_main_image_address(
            DIA_CUSTOM_PROMPT_TOOLS_PRESENT_OFFSET);
        dia_custom_log_prompt_tools_stage(@"presenting", controller);
        dia_custom_call_platform_window_prompt_tools_presenter(
            presenter,
            (__bridge const void *)platformWindow,
            (__bridge const void *)controller);
        existingWindowController = dia_custom_prompt_tools_window_controller();
    }

    if ([existingWindowController respondsToSelector:@selector(showWindow:)]) {
        [existingWindowController showWindow:nil];
    }
    if ([existingWindowController respondsToSelector:@selector(window)]) {
        [[existingWindowController window] makeKeyAndOrderFront:nil];
    }
    [NSApp activateIgnoringOtherApps:YES];
    dia_custom_log_prompt_tools_stage(@"presented", existingWindowController);
    return existingWindowController != nil;
}

static NSView *dia_custom_find_view_named(NSView *root, NSString *classFragment) {
    if (root == nil) {
        return nil;
    }
    if ([NSStringFromClass([root class]) containsString:classFragment]) {
        return root;
    }
    for (NSView *child in [root subviews]) {
        NSView *match = dia_custom_find_view_named(child, classFragment);
        if (match != nil) {
            return match;
        }
    }
    return nil;
}

static void dia_custom_collect_views_named(NSView *root,
                                           NSString *classFragment,
                                           NSMutableArray *results) {
    if (root == nil) {
        return;
    }
    if ([NSStringFromClass([root class]) containsString:classFragment]) {
        [results addObject:root];
    }
    for (NSView *child in [root subviews]) {
        dia_custom_collect_views_named(child, classFragment, results);
    }
}

static id dia_custom_native_model_picker_owner(void) {
    NSArray<NSWindow *> *windows = [NSApp windows];
    NSWindow *preferred = [NSApp keyWindow] ?: [NSApp mainWindow];
    if (preferred != nil) {
        windows = [@[preferred] arrayByAddingObjectsFromArray:windows];
    }
    id fallback = nil;
    for (NSWindow *window in windows) {
        NSMutableArray *toolbars = [NSMutableArray array];
        dia_custom_collect_views_named([window contentView],
                                       @"BoostCommandBar.ToolbarView",
                                       toolbars);
        for (id toolbar in toolbars) {
            if (fallback == nil) {
                fallback = toolbar;
            }
            @try {
                if ([toolbar valueForKey:@"modelSelectorButton"] != nil) {
                    return toolbar;
                }
            } @catch (__unused NSException *exception) {
            }
        }
    }
    return fallback;
}

static id dia_custom_enable_native_model_picker(void) {
    id owner = dia_custom_native_model_picker_owner();
    if (owner == nil) {
        return nil;
    }
    @try {
        id button = [owner valueForKey:@"modelSelectorButton"];
        if ([button respondsToSelector:@selector(setHidden:)]) {
            [button setHidden:NO];
        }
        if ([button respondsToSelector:@selector(setEnabled:)]) {
            [button setEnabled:YES];
        }
        if ([owner respondsToSelector:@selector(setNeedsLayout:)]) {
            [owner setNeedsLayout:YES];
        }
        if ([owner respondsToSelector:@selector(layoutSubtreeIfNeeded)]) {
            [owner layoutSubtreeIfNeeded];
        }
        return button;
    } @catch (__unused NSException *exception) {
        return nil;
    }
}

@interface DiaCustomDeveloperMenuController : NSObject
- (void)openPromptTools:(id)sender;
- (void)openNativeModelPicker:(id)sender;
- (void)openBrowserDeveloperTools:(id)sender;
- (void)openAgentServerDashboard:(id)sender;
- (void)openLogLevels:(id)sender;
@end

@implementation DiaCustomDeveloperMenuController
- (void)openPromptTools:(id)sender {
    if (!dia_custom_present_prompt_tools()) {
        NSBeep();
    }
}

- (void)openBrowserDeveloperTools:(id)sender {
    if (![NSApp sendAction:NSSelectorFromString(@"toggleDevTools:")
                        to:nil
                      from:sender]) {
        NSBeep();
    }
}

- (BOOL)invokeWindowPresenterAction:(const char *)fieldName {
    id applicationController = dia_custom_object_ivar([NSApp delegate], "controller");
    if (applicationController == nil) {
        return NO;
    }
    return dia_custom_swift_invoke_window_presenter_action(
        (const void *)applicationController,
        fieldName);
}

- (void)openAgentServerDashboard:(id)sender {
    if (![self invokeWindowPresenterAction:"_presentAgentServerDashboardWindow"]) {
        NSBeep();
    }
}

- (void)openLogLevels:(id)sender {
    if (![self invokeWindowPresenterAction:"_presentLogLevelsWindow"]) {
        NSBeep();
    }
}

- (void)openNativeModelPicker:(id)sender {
    dia_custom_enable_native_model_picker();
    id owner = dia_custom_native_model_picker_owner();
    SEL selector = NSSelectorFromString(@"handleModelSelectorClicked");
    if (owner != nil && [owner respondsToSelector:selector]) {
        IMP implementation = [owner methodForSelector:selector];
        ((void (*)(id, SEL))implementation)(owner, selector);
    } else if (![NSApp sendAction:selector to:nil from:sender]) {
        NSBeep();
    }
}
@end

static DiaCustomDeveloperMenuController *dia_custom_developer_menu_controller;

static void dia_custom_install_developer_menu(void) {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 8000 * NSEC_PER_MSEC),
                   dispatch_get_main_queue(), ^{
        NSMenu *viewMenu = nil;
        for (NSMenuItem *item in [[NSApp mainMenu] itemArray]) {
            if ([[item title] isEqualToString:@"View"]) {
                viewMenu = [item submenu];
                break;
            }
        }
        if (viewMenu == nil) {
            return;
        }

        NSMenu *developerMenu = nil;
        for (NSMenuItem *item in [viewMenu itemArray]) {
            if ([[item title] isEqualToString:@"Developer"]) {
                developerMenu = [item submenu];
                break;
            }
        }
        if (developerMenu == nil ||
            [developerMenu itemWithTitle:@"Prompt Tools & Model Routing"] != nil) {
            return;
        }

        dia_custom_developer_menu_controller =
            [[DiaCustomDeveloperMenuController alloc] init];
        id nativeModelPickerButton = dia_custom_enable_native_model_picker();
        [developerMenu addItem:[NSMenuItem separatorItem]];

        NSMenuItem *promptTools = [[NSMenuItem alloc]
            initWithTitle:@"Prompt Tools & Model Routing"
                   action:@selector(openPromptTools:)
            keyEquivalent:@""];
        [promptTools setTarget:dia_custom_developer_menu_controller];
        [developerMenu addItem:promptTools];

        NSMenuItem *modelPicker = [[NSMenuItem alloc]
            initWithTitle:@"Native Model Picker"
                   action:@selector(openNativeModelPicker:)
            keyEquivalent:@""];
        [modelPicker setTarget:dia_custom_developer_menu_controller];
        [developerMenu addItem:modelPicker];

        NSMenuItem *browserTools = [[NSMenuItem alloc]
            initWithTitle:@"Browser Developer Tools"
                   action:@selector(openBrowserDeveloperTools:)
            keyEquivalent:@""];
        [browserTools setTarget:dia_custom_developer_menu_controller];
        [developerMenu addItem:browserTools];

        NSMenuItem *agentServerDashboard = [[NSMenuItem alloc]
            initWithTitle:@"Agent Server Dashboard"
                   action:@selector(openAgentServerDashboard:)
            keyEquivalent:@""];
        [agentServerDashboard setTarget:dia_custom_developer_menu_controller];
        [developerMenu addItem:agentServerDashboard];

        NSMenuItem *logLevels = [[NSMenuItem alloc]
            initWithTitle:@"Log Levels"
                   action:@selector(openLogLevels:)
            keyEquivalent:@""];
        [logLevels setTarget:dia_custom_developer_menu_controller];
        [developerMenu addItem:logLevels];

        const char *path = getenv("DIA_CUSTOM_RUNTIME_LOG");
        if (path != NULL && path[0] != '\0') {
            FILE *output = fopen(path, "a");
            if (output != NULL) {
                id controller = dia_custom_prompt_tools_window_controller();
                fprintf(output, "\n=== DIA CUSTOM DEVELOPER ===\n");
                fprintf(output, "promptToolsWindowController=%s\n",
                        controller != nil
                            ? class_getName(object_getClass(controller))
                            : "<nil>");
                id modelPickerOwner = dia_custom_native_model_picker_owner();
                fprintf(output, "nativeModelPickerOwner=%s\n",
                        modelPickerOwner != nil
                            ? class_getName(object_getClass(modelPickerOwner))
                            : "<nil>");
                fprintf(output, "nativeModelPickerButton=%s hidden=%d enabled=%d\n",
                        nativeModelPickerButton != nil
                            ? class_getName(object_getClass(nativeModelPickerButton))
                            : "<nil>",
                        [nativeModelPickerButton respondsToSelector:@selector(isHidden)]
                            ? [nativeModelPickerButton isHidden]
                            : -1,
                        [nativeModelPickerButton respondsToSelector:@selector(isEnabled)]
                            ? [nativeModelPickerButton isEnabled]
                            : -1);
                NSArray<NSString *> *selectors = @[
                    @"handleModelSelectorClicked",
                    @"toggleDeveloperMode",
                    @"_presentFeatureFlagsWindow",
                    @"_presentInternalToolWindow",
                    @"_openLLMDebugger",
                ];
                for (NSString *selectorName in selectors) {
                    SEL selector = NSSelectorFromString(selectorName);
                    id target = [NSApp targetForAction:selector];
                    fprintf(output, "actionTarget %s=%s\n",
                            [selectorName UTF8String],
                            target != nil
                                ? class_getName(object_getClass(target))
                                : "<nil>");
                }
                NSArray<NSWindow *> *windows = [NSApp windows];
                fprintf(output, "windowCount=%lu\n", (unsigned long)[windows count]);
                for (NSWindow *candidate in windows) {
                    id candidateController = [candidate windowController];
                    fprintf(output,
                            "WINDOW class=%s controller=%s key=%d main=%d "
                            "identifier=%s title=%s\n",
                            class_getName(object_getClass(candidate)),
                            candidateController != nil
                                ? class_getName(object_getClass(candidateController))
                                : "<nil>",
                            [candidate isKeyWindow],
                            [candidate isMainWindow],
                            [[[candidate identifier] description] UTF8String] ?: "<nil>",
                            [[[candidate title] description] UTF8String] ?: "<nil>");
                    if (![NSStringFromClass([candidate class])
                            containsString:@"PlatformWindow"]) {
                        continue;
                    }
                    @try {
                        id viewModel = [candidate valueForKey:@"viewModel"];
                        fprintf(output, "platformWindowViewModel=%s\n",
                                viewModel != nil
                                    ? class_getName(object_getClass(viewModel))
                                    : "<nil>");
                    } @catch (__unused NSException *exception) {
                        fprintf(output, "platformWindowViewModel=<kvc-error>\n");
                    }
                    dia_custom_log_ivars(output, candidate);
                    dia_custom_log_ivars(output, candidateController);
                }
                id appDelegate = [NSApp delegate];
                id applicationController = dia_custom_object_ivar(
                    appDelegate, "controller");
                id menuOrchestrator = dia_custom_object_ivar(
                    appDelegate, "mainMenuOrchestrator");
                id menuItemsByAction = dia_custom_object_ivar(
                    menuOrchestrator, "menuItemsByAction");
                id platformWindowPresenter = dia_custom_find_live_object(
                    @"Application.PlatformWindowPresenter");
                id promptToolsController = dia_custom_find_live_object(
                    @"SupertabFrontend.PromptToolsController");
                id promptToolsViewModel = dia_custom_find_live_object(
                    @"SupertabFrontend.PromptToolsViewModel");
                id routingOverridesViewModel = dia_custom_find_live_object(
                    @"SupertabFrontend.RoutingOverridesViewModel");
                fprintf(output, "appDelegate=%s controller=%s menuOrchestrator=%s\n",
                        appDelegate != nil
                            ? class_getName(object_getClass(appDelegate))
                            : "<nil>",
                        applicationController != nil
                            ? class_getName(object_getClass(applicationController))
                            : "<nil>",
                        menuOrchestrator != nil
                            ? class_getName(object_getClass(menuOrchestrator))
                            : "<nil>");
                fprintf(output, "menuItemsByAction=%s\n",
                        menuItemsByAction != nil
                            ? class_getName(object_getClass(menuItemsByAction))
                            : "<nil>");
                fprintf(output, "platformWindowPresenter=%s %p\n",
                        platformWindowPresenter != nil
                            ? class_getName(object_getClass(platformWindowPresenter))
                            : "<nil>",
                        platformWindowPresenter);
                fprintf(output, "promptToolsController=%s %p viewModel=%s %p "
                        "routingOverridesViewModel=%s %p\n",
                        promptToolsController != nil
                            ? class_getName(object_getClass(promptToolsController))
                            : "<nil>",
                        promptToolsController,
                        promptToolsViewModel != nil
                            ? class_getName(object_getClass(promptToolsViewModel))
                            : "<nil>",
                        promptToolsViewModel,
                        routingOverridesViewModel != nil
                            ? class_getName(object_getClass(routingOverridesViewModel))
                            : "<nil>",
                        routingOverridesViewModel);
                fclose(output);
                NSString *swiftLogPath = [
                    [NSString stringWithUTF8String:path]
                    stringByAppendingString:@".swift"];
                dia_custom_swift_log_object((const void *)applicationController,
                                            "applicationController",
                                            [swiftLogPath fileSystemRepresentation]);
                dia_custom_swift_log_object((const void *)menuOrchestrator,
                                            "menuOrchestrator",
                                            [swiftLogPath fileSystemRepresentation]);
                for (NSWindow *candidate in windows) {
                    if (![NSStringFromClass([candidate class])
                            containsString:@"PlatformWindow"]) {
                        continue;
                    }
                    dia_custom_swift_log_object(
                        (const void *)candidate,
                        "platformWindow",
                        [swiftLogPath fileSystemRepresentation]);
                    dia_custom_swift_log_object(
                        (const void *)[candidate windowController],
                        "platformWindowController",
                        [swiftLogPath fileSystemRepresentation]);
                }
                dia_custom_swift_log_object((const void *)modelPickerOwner,
                                            "toolbarView",
                                            [swiftLogPath fileSystemRepresentation]);
                dia_custom_swift_log_object((const void *)platformWindowPresenter,
                                            "platformWindowPresenter",
                                            [swiftLogPath fileSystemRepresentation]);
                dia_custom_swift_log_object((const void *)promptToolsController,
                                            "promptToolsController",
                                            [swiftLogPath fileSystemRepresentation]);
            }
        }
    });
}

__attribute__((constructor))
static void dia_custom_install_runtime_overrides(void) {
    const char *program = getprogname();
    if (program == NULL || strcmp(program, "Dia") != 0) {
        return;
    }

    dia_custom_log_runtime();
    dia_custom_schedule_menu_log();
    dia_custom_schedule_network_log();
    dia_custom_close_account_window();
    dia_custom_install_developer_menu();
}
