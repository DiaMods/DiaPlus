#import <AppKit/AppKit.h>
#include <objc/runtime.h>
#include <dispatch/dispatch.h>
#include <mach-o/dyld.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include "prompt-tools-offsets.h"

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

static const void *dia_custom_main_image_address(uintptr_t unslidOffset) {
    const struct mach_header *header = _dyld_get_image_header(0);
    if (header == NULL) {
        return NULL;
    }
    return (const void *)((uintptr_t)header + unslidOffset);
}

static void dia_custom_log_status(NSString *message) {
    const char *rawPath = getenv("DIA_CUSTOM_RUNTIME_LOG");
    if (rawPath == NULL || rawPath[0] == '\0' || message == nil) {
        return;
    }
    FILE *output = fopen(rawPath, "a");
    if (output == NULL) {
        return;
    }
    fprintf(output, "%.3f\t%s\n",
            [[NSDate date] timeIntervalSince1970], [message UTF8String]);
    fclose(output);
}

static void dia_custom_log_request_url(NSURL *url, const char *disposition) {
    const char *path = getenv("DIA_CUSTOM_NETWORK_LOG");
    if (path == NULL || path[0] == '\0' || url == nil) {
        return;
    }

    NSURLComponents *components = [NSURLComponents componentsWithURL:url
                                              resolvingAgainstBaseURL:NO];
    components.user = nil;
    components.password = nil;
    components.query = nil;
    components.fragment = nil;
    NSString *host = [components.host lowercaseString];
    BOOL isLocal = [host isEqualToString:@"localhost"] ||
        [host isEqualToString:@"127.0.0.1"] ||
        [host isEqualToString:@"::1"];
    // Local route names are useful for bridge diagnostics. For every external
    // destination, retain only the origin so browsing paths never enter logs.
    if (!isLocal) {
        components.path = @"";
    }
    NSString *safeURL = components.string;
    if (safeURL == nil) {
        return;
    }

    FILE *output = fopen(path, "a");
    if (output == NULL) {
        return;
    }
    flockfile(output);
    fprintf(output, "%.3f\t%s\t%s\n",
            [[NSDate date] timeIntervalSince1970], disposition,
            [safeURL UTF8String]);
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
        @"diabrowser.engineering",
        @"diabrowser.com",
        @"thebrowser.company",
        @"thebrowser.com",
        @"model-server.browserinternalstaging.com",
        @"browser-intake-datadoghq.com",
        @"browser-intake-ap1-datadoghq.com",
        @"browser-intake-datadoghq.eu",
        @"browser-intake-us3-datadoghq.com",
        @"browser-intake-us5-datadoghq.com",
        @"o298668.ingest.us.sentry.io",
        @"releases.diabrowser.com",
        @"incoming.browserinternal.com",
    ];
    if ([blockedHosts containsObject:host]) {
        return YES;
    }
    return [host hasSuffix:@".diabrowser.engineering"] ||
           [host hasSuffix:@".diabrowser.com"] ||
           [host hasSuffix:@".thebrowser.company"] ||
           [host hasSuffix:@".thebrowser.com"] ||
           [host hasSuffix:@".browserinternal.com"] ||
           [host hasSuffix:@".browserinternalstaging.com"];
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
    BOOL blocked = dia_custom_should_block_request_url(request.URL);
    dia_custom_log_request_url(request.URL, blocked ? "BLOCKED" : "ALLOW");
    if (blocked) {
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
    if (dia_custom_task_resume_entry_count != 0) {
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
    dia_custom_log_request_url(request.URL, "OBSERVED");
    return NO;
}

+ (NSURLRequest *)canonicalRequestForRequest:(NSURLRequest *)request {
    return request;
}

- (void)startLoading {}
- (void)stopLoading {}
@end

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

static void dia_custom_schedule_network_log(void) {
    // Install synchronously because the model registry starts during
    // application construction. Logging is optional; host blocking is not.
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
    if (![build isEqualToString:@DIA_CUSTOM_PROMPT_TOOLS_BUILD] ||
        platformWindow == nil) {
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

static NSDictionary *dia_custom_model_catalog(void) {
    const char *rawPath = getenv("DIA_CUSTOM_MODEL_CATALOG_PATH");
    if (rawPath == NULL || rawPath[0] == '\0') {
        return nil;
    }
    NSData *data = [NSData dataWithContentsOfFile:
        [NSString stringWithUTF8String:rawPath]];
    if (data == nil) {
        return nil;
    }
    id value = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    return [value isKindOfClass:[NSDictionary class]] ? value : nil;
}

static NSArray<NSDictionary *> *dia_custom_catalog_models(NSDictionary *catalog) {
    id models = catalog[@"models"];
    return [models isKindOfClass:[NSArray class]] ? models : @[];
}

// -2 means the localhost bridge could not be reached, -1 means its state has
// not loaded yet, 0 means disabled, and 1 means enabled.
static NSInteger dia_custom_local_memory_state = -1;
static BOOL dia_custom_local_memory_request_in_flight = NO;
static NSDate *dia_custom_local_memory_last_refresh;
static NSInteger dia_custom_local_memory_retention_days = 0;
static NSInteger dia_custom_local_memory_entry_count = -1;

static NSURL *dia_custom_local_api_url(NSString *path) {
    const char *rawURL = getenv("DIA_CUSTOM_SETTINGS_URL");
    NSString *value = rawURL != NULL
        ? [NSString stringWithUTF8String:rawURL]
        : @"http://127.0.0.1:8765/settings";
    NSURLComponents *components = [NSURLComponents componentsWithString:value];
    NSString *host = [[components host] lowercaseString];
    if (!([host isEqualToString:@"127.0.0.1"] ||
          [host isEqualToString:@"localhost"] ||
          [host isEqualToString:@"::1"])) {
        components = [NSURLComponents
            componentsWithString:@"http://127.0.0.1:8765/settings"];
    }
    components.path = path;
    components.query = nil;
    components.fragment = nil;
    return components.URL;
}

static NSString *dia_custom_memory_retention_title(NSInteger days) {
    if (days <= 0) {
        return @"Forever";
    }
    if (days == 1) {
        return @"1 Day";
    }
    return [NSString stringWithFormat:@"%ld Days", (long)days];
}

static NSString *dia_custom_active_profile_name(void) {
    static NSString *cachedName;
    if (cachedName != nil) {
        return cachedName;
    }
    cachedName = @"Current Profile";
    const char *rawProfile = getenv("DIA_CUSTOM_PROFILE");
    if (rawProfile == NULL || rawProfile[0] == '\0') {
        return cachedName;
    }
    NSString *profile = [NSString stringWithUTF8String:rawProfile];
    NSString *path = [profile stringByAppendingPathComponent:
        @"User Data/Local State"];
    NSData *data = [NSData dataWithContentsOfFile:path];
    NSDictionary *root = data != nil
        ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil]
        : nil;
    NSDictionary *profileState = [root[@"profile"]
        isKindOfClass:[NSDictionary class]] ? root[@"profile"] : nil;
    NSDictionary *cache = [profileState[@"info_cache"]
        isKindOfClass:[NSDictionary class]] ? profileState[@"info_cache"] : nil;
    NSArray *active = [profileState[@"last_active_profiles"]
        isKindOfClass:[NSArray class]] ? profileState[@"last_active_profiles"] : nil;
    NSString *key = [active.firstObject isKindOfClass:[NSString class]]
        ? active.firstObject : nil;
    NSDictionary *record = [cache[key] isKindOfClass:[NSDictionary class]]
        ? cache[key] : nil;
    NSString *name = [record[@"name"] isKindOfClass:[NSString class]]
        ? record[@"name"] : nil;
    if (name.length > 0) {
        cachedName = [name copy];
    }
    return cachedName;
}

static NSView *dia_custom_find_identified_view(NSView *view,
                                                NSString *identifier) {
    if (view == nil || identifier == nil) {
        return nil;
    }
    if ([[[view identifier] description] isEqualToString:identifier]) {
        return view;
    }
    for (NSView *child in [view subviews]) {
        NSView *match = dia_custom_find_identified_view(child, identifier);
        if (match != nil) {
            return match;
        }
    }
    return nil;
}

static NSView *dia_custom_memory_content_host(NSView *view) {
    NSView *fallback = nil;
    for (NSView *candidate = view; candidate != nil;
         candidate = [candidate superview]) {
        if ([[candidate superview] isKindOfClass:[NSSplitView class]]) {
            return candidate;
        }
        if (fallback == nil && NSWidth(candidate.bounds) >= 420.0 &&
            NSHeight(candidate.bounds) >= 260.0) {
            fallback = candidate;
        }
    }
    return fallback;
}

static void dia_custom_populate_retention_popup(NSPopUpButton *popup) {
    if (popup == nil) {
        return;
    }
    NSArray<NSNumber *> *choices = @[@0, @1, @7, @30, @90, @365];
    if (dia_custom_local_memory_retention_days > 0 &&
        ![choices containsObject:@(dia_custom_local_memory_retention_days)]) {
        choices = [choices arrayByAddingObject:
            @(dia_custom_local_memory_retention_days)];
    }
    choices = [choices sortedArrayUsingSelector:@selector(compare:)];
    [popup removeAllItems];
    for (NSNumber *days in choices) {
        [popup addItemWithTitle:
            dia_custom_memory_retention_title([days integerValue])];
        [[popup lastItem] setRepresentedObject:days];
    }
    for (NSMenuItem *item in [popup itemArray]) {
        if ([[item representedObject] integerValue] ==
            dia_custom_local_memory_retention_days) {
            [popup selectItem:item];
            break;
        }
    }
}

static NSTextField *dia_custom_memory_label(NSString *value,
                                             NSFont *font,
                                             NSColor *color) {
    NSTextField *label = [NSTextField labelWithString:value ?: @""];
    label.font = font;
    label.textColor = color;
    label.translatesAutoresizingMaskIntoConstraints = NO;
    return label;
}

static void dia_custom_update_memory_panel(NSView *panel,
                                            id target,
                                            SEL toggleAction) {
    if (panel == nil) {
        return;
    }
    NSTextField *dot = (NSTextField *)dia_custom_find_identified_view(
        panel, @"DiaCustomMemoryProfileDot");
    if ([dot isKindOfClass:[NSTextField class]]) {
        dot.textColor = dia_custom_local_memory_state == 1
            ? [NSColor systemGreenColor] : [NSColor systemGrayColor];
    }
    NSPopUpButton *retention = (NSPopUpButton *)dia_custom_find_identified_view(
        panel, @"DiaCustomMemoryRetention");
    if ([retention isKindOfClass:[NSPopUpButton class]]) {
        retention.target = target;
        retention.action = NSSelectorFromString(@"setLocalMemoryRetention:");
        retention.enabled = dia_custom_local_memory_state != -2;
        dia_custom_populate_retention_popup(retention);
    }
    NSTextField *summary = (NSTextField *)dia_custom_find_identified_view(
        panel, @"DiaCustomMemorySummary");
    if ([summary isKindOfClass:[NSTextField class]]) {
        if (dia_custom_local_memory_entry_count < 0) {
            summary.stringValue = @"Loading local memory details…";
        } else if (dia_custom_local_memory_state == 0) {
            summary.stringValue = [NSString stringWithFormat:
                @"%ld items retained locally while capture is off.",
                (long)dia_custom_local_memory_entry_count];
        } else {
            summary.stringValue = [NSString stringWithFormat:
                @"%ld items stored locally. Retention is applied on this Mac.",
                (long)dia_custom_local_memory_entry_count];
        }
    }
    NSButton *reset = (NSButton *)dia_custom_find_identified_view(
        panel, @"DiaCustomResetMemoryButton");
    if ([reset isKindOfClass:[NSButton class]]) {
        reset.target = target;
        reset.action = NSSelectorFromString(@"resetLocalMemory:");
        reset.enabled = dia_custom_local_memory_state != -2 &&
            dia_custom_local_memory_entry_count > 0;
    }
    NSButton *footer = (NSButton *)dia_custom_find_identified_view(
        panel, @"DiaCustomMemoryFooterButton");
    if ([footer isKindOfClass:[NSButton class]]) {
        footer.target = target;
        footer.action = toggleAction;
        footer.enabled = dia_custom_local_memory_state == 0 ||
            dia_custom_local_memory_state == 1;
        footer.title = dia_custom_local_memory_state == 1
            ? @"Disable Memory" : dia_custom_local_memory_state == 0
                ? @"Enable Memory" : @"Memory Unavailable";
        footer.bezelColor = dia_custom_local_memory_state == 1
            ? [NSColor colorWithCalibratedRed:0.40
                                         green:0.13
                                          blue:0.13
                                         alpha:1.0]
            : [NSColor controlAccentColor];
        footer.contentTintColor = [NSColor whiteColor];
    }
}

static void dia_custom_install_memory_status_label(NSButton *button) {
    NSView *parent = [button superview];
    if (parent == nil) {
        return;
    }
    NSTextField *status = (NSTextField *)dia_custom_find_identified_view(
        parent, @"DiaCustomLocalMemoryStatus");
    if (![status isKindOfClass:[NSTextField class]]) {
        status = dia_custom_memory_label(
            @"Checking…",
            [NSFont systemFontOfSize:13.0 weight:NSFontWeightRegular],
            [NSColor secondaryLabelColor]);
        status.identifier = @"DiaCustomLocalMemoryStatus";
        [parent addSubview:status];
        [NSLayoutConstraint activateConstraints:@[
            [status.trailingAnchor constraintEqualToAnchor:button.trailingAnchor],
            [status.centerYAnchor constraintEqualToAnchor:button.centerYAnchor],
        ]];
    }
    status.stringValue = dia_custom_local_memory_state == 1
        ? @"✓ On" : dia_custom_local_memory_state == 0
            ? @"Off" : dia_custom_local_memory_state == -2
                ? @"Unavailable" : @"Checking…";
    status.hidden = NO;
    // Keep the native control in layout so SwiftUI preserves the trailing
    // status position, but make its drawing and accessibility inert.
    button.hidden = NO;
    button.enabled = NO;
    button.alphaValue = 0.0;
    [button setAccessibilityElement:NO];
    if ([button respondsToSelector:@selector(setAccessibilityHidden:)]) {
        [button setAccessibilityHidden:YES];
    }
}

static NSView *dia_custom_install_memory_panel(NSButton *button,
                                                NSTextField *explanation,
                                                id target,
                                                SEL toggleAction) {
    if (button == nil || explanation == nil) {
        return nil;
    }
    NSView *host = dia_custom_memory_content_host(button);
    if (host == nil || ![explanation isDescendantOf:host]) {
        return nil;
    }
    NSView *existing = dia_custom_find_identified_view(
        host, @"DiaCustomLocalMemoryPanel");
    if (existing != nil) {
        dia_custom_update_memory_panel(existing, target, toggleAction);
        return existing;
    }

    NSView *panel = [[NSView alloc] initWithFrame:NSZeroRect];
    panel.identifier = @"DiaCustomLocalMemoryPanel";
    panel.translatesAutoresizingMaskIntoConstraints = NO;
    [host addSubview:panel];

    NSTextField *heading = dia_custom_memory_label(
        @"Profile Settings", [NSFont systemFontOfSize:13.0 weight:NSFontWeightSemibold],
        [NSColor secondaryLabelColor]);
    NSView *card = [[NSView alloc] initWithFrame:NSZeroRect];
    card.identifier = @"DiaCustomMemoryProfileCard";
    card.translatesAutoresizingMaskIntoConstraints = NO;
    card.wantsLayer = YES;
    card.layer.cornerRadius = 10.0;
    card.layer.backgroundColor = [[NSColor controlBackgroundColor] CGColor];
    NSTextField *dot = dia_custom_memory_label(
        @"●", [NSFont systemFontOfSize:13.0 weight:NSFontWeightRegular],
        [NSColor systemGreenColor]);
    dot.identifier = @"DiaCustomMemoryProfileDot";
    NSTextField *profile = dia_custom_memory_label(
        dia_custom_active_profile_name(),
        [NSFont systemFontOfSize:13.0 weight:NSFontWeightSemibold],
        [NSColor labelColor]);
    NSPopUpButton *retention = [[NSPopUpButton alloc]
        initWithFrame:NSZeroRect pullsDown:NO];
    retention.identifier = @"DiaCustomMemoryRetention";
    retention.translatesAutoresizingMaskIntoConstraints = NO;
    retention.controlSize = NSControlSizeSmall;
    retention.bordered = NO;
    retention.toolTip = @"Choose how long Dia Custom keeps local memory";
    [card addSubview:dot];
    [card addSubview:profile];
    [card addSubview:retention];

    NSTextField *summary = dia_custom_memory_label(
        @"Loading local memory details…",
        [NSFont systemFontOfSize:11.0 weight:NSFontWeightRegular],
        [NSColor secondaryLabelColor]);
    summary.identifier = @"DiaCustomMemorySummary";
    NSButton *reset = [NSButton buttonWithTitle:@"Reset Memory…"
                                         target:target
                                         action:NSSelectorFromString(@"resetLocalMemory:")];
    reset.identifier = @"DiaCustomResetMemoryButton";
    reset.translatesAutoresizingMaskIntoConstraints = NO;
    reset.bezelStyle = NSBezelStyleRounded;
    NSButton *footer = [NSButton buttonWithTitle:@"Disable Memory"
                                          target:target
                                          action:toggleAction];
    footer.identifier = @"DiaCustomMemoryFooterButton";
    footer.translatesAutoresizingMaskIntoConstraints = NO;
    footer.bezelStyle = NSBezelStyleRounded;

    [panel addSubview:heading];
    [panel addSubview:card];
    [panel addSubview:summary];
    [panel addSubview:reset];
    [panel addSubview:footer];
    NSView *windowContent = [[button window] contentView] ?: host;
    [NSLayoutConstraint activateConstraints:@[
        [panel.leadingAnchor constraintEqualToAnchor:host.leadingAnchor constant:20.0],
        [panel.trailingAnchor constraintEqualToAnchor:host.trailingAnchor constant:-20.0],
        [panel.topAnchor constraintEqualToAnchor:explanation.bottomAnchor constant:18.0],
        [panel.bottomAnchor constraintEqualToAnchor:windowContent.bottomAnchor constant:-18.0],
        [heading.leadingAnchor constraintEqualToAnchor:panel.leadingAnchor],
        [heading.topAnchor constraintEqualToAnchor:panel.topAnchor],
        [card.leadingAnchor constraintEqualToAnchor:panel.leadingAnchor],
        [card.trailingAnchor constraintEqualToAnchor:panel.trailingAnchor],
        [card.topAnchor constraintEqualToAnchor:heading.bottomAnchor constant:8.0],
        [card.heightAnchor constraintEqualToConstant:44.0],
        [dot.leadingAnchor constraintEqualToAnchor:card.leadingAnchor constant:12.0],
        [dot.centerYAnchor constraintEqualToAnchor:card.centerYAnchor],
        [profile.leadingAnchor constraintEqualToAnchor:dot.trailingAnchor constant:8.0],
        [profile.centerYAnchor constraintEqualToAnchor:card.centerYAnchor],
        [retention.trailingAnchor constraintEqualToAnchor:card.trailingAnchor constant:-10.0],
        [retention.centerYAnchor constraintEqualToAnchor:card.centerYAnchor],
        [retention.widthAnchor constraintGreaterThanOrEqualToConstant:84.0],
        [summary.leadingAnchor constraintEqualToAnchor:panel.leadingAnchor constant:2.0],
        [summary.topAnchor constraintEqualToAnchor:card.bottomAnchor constant:8.0],
        [reset.bottomAnchor constraintEqualToAnchor:panel.bottomAnchor],
        [footer.bottomAnchor constraintEqualToAnchor:panel.bottomAnchor],
        [footer.trailingAnchor constraintEqualToAnchor:panel.trailingAnchor],
        [reset.trailingAnchor constraintEqualToAnchor:footer.leadingAnchor constant:-12.0],
    ]];
    dia_custom_update_memory_panel(panel, target, toggleAction);
    return panel;
}

static BOOL dia_custom_update_memory_controls_in_view(NSView *view,
                                                       id target,
                                                       SEL action) {
    if (view == nil) {
        return NO;
    }
    BOOL found = NO;
    NSString *identifier = [[view identifier] description];
    if ([view isKindOfClass:[NSButton class]]) {
        NSButton *button = (NSButton *)view;
        NSString *title = [button title];
        BOOL isUnclaimedNativeButton = identifier.length == 0 &&
            ([title isEqualToString:@"Enable Memory"] ||
             [title isEqualToString:@"Disable Memory"]);
        if ([identifier isEqualToString:@"DiaCustomLocalMemoryButton"] ||
            isUnclaimedNativeButton) {
            found = YES;
            [button setIdentifier:@"DiaCustomLocalMemoryButton"];
            [button setTarget:target];
            [button setAction:action];
            [button setToolTip:@"Control Dia Custom's private local memory"];
            [button setBordered:NO];
            [button setContentTintColor:[NSColor secondaryLabelColor]];
            NSString *desiredTitle = nil;
            BOOL desiredEnabled = NO;
            if (dia_custom_local_memory_state == 1) {
                desiredTitle = @"✓ On";
                desiredEnabled = YES;
            } else if (dia_custom_local_memory_state == 0) {
                desiredTitle = @"Off";
                desiredEnabled = YES;
            } else if (dia_custom_local_memory_state == -2) {
                desiredTitle = @"Unavailable";
            } else {
                desiredTitle = @"Checking…";
            }
            if (![[button title] isEqualToString:desiredTitle]) {
                [button setTitle:desiredTitle];
            }
            if ([button isEnabled] != desiredEnabled) {
                [button setEnabled:desiredEnabled];
            }
        }
    }
    if ([view isKindOfClass:[NSTextField class]]) {
        NSTextField *label = (NSTextField *)view;
        NSString *text = [label stringValue];
        if ([identifier isEqualToString:@"DiaCustomLocalMemoryExplanation"] ||
            [[text lowercaseString] containsString:@"summarized on our servers"]) {
            found = YES;
            [label setIdentifier:@"DiaCustomLocalMemoryExplanation"];
            NSString *desiredText = nil;
            if (dia_custom_local_memory_state == 1) {
                desiredText = @"Dia Custom remembers recent sites, chats, and preferences in an owner-only database on this Mac. Nothing is summarized by or sent to Dia.";
            } else if (dia_custom_local_memory_state == 0) {
                desiredText = @"Dia Custom local memory is off. New browsing activity and chats will not be saved; existing local memories are retained. Nothing is sent to Dia.";
            } else {
                desiredText = @"Checking Dia Custom's private local memory setting. Nothing is sent to Dia.";
            }
            if (![[label stringValue] isEqualToString:desiredText]) {
                [label setStringValue:desiredText];
            }
        }
    }
    for (NSView *child in [view subviews]) {
        found = dia_custom_update_memory_controls_in_view(
            child, target, action) || found;
    }
    return found;
}

static BOOL dia_custom_refresh_memory_controls(id target, SEL action) {
    BOOL found = NO;
    for (NSWindow *window in [NSApp windows]) {
        NSView *content = [window contentView];
        BOOL windowFound = dia_custom_update_memory_controls_in_view(
            content, target, action);
        if (windowFound) {
            NSButton *button = (NSButton *)dia_custom_find_identified_view(
                content, @"DiaCustomLocalMemoryButton");
            NSTextField *explanation = (NSTextField *)
                dia_custom_find_identified_view(
                    content, @"DiaCustomLocalMemoryExplanation");
            if ([button isKindOfClass:[NSButton class]] &&
                [explanation isKindOfClass:[NSTextField class]]) {
                NSView *panel = dia_custom_install_memory_panel(
                    button, explanation, target, action);
                if (panel != nil) {
                    // The official enabled-state pane presents this as a
                    // passive status; destructive/enable actions live in the
                    // footer where they cannot be clicked accidentally.
                    button.enabled = NO;
                    button.bordered = NO;
                    button.bezelColor = [NSColor clearColor];
                    button.contentTintColor = [NSColor secondaryLabelColor];
                    button.alphaValue = 1.0;
                    dia_custom_install_memory_status_label(button);
                }
            }
        }
        found = windowFound || found;
    }
    return found;
}

static void dia_custom_fetch_local_memory_state(id target,
                                                SEL action,
                                                BOOL force) {
    if (target == nil || dia_custom_local_memory_request_in_flight) {
        return;
    }
    if (!force && dia_custom_local_memory_last_refresh != nil &&
        [dia_custom_local_memory_last_refresh timeIntervalSinceNow] > -5.0) {
        return;
    }
    NSURL *url = dia_custom_local_api_url(@"/api/memory/enabled");
    if (url == nil) {
        dia_custom_local_memory_state = -2;
        dia_custom_refresh_memory_controls(target, action);
        return;
    }
    dia_custom_local_memory_request_in_flight = YES;
    [[[NSURLSession sharedSession]
        dataTaskWithURL:url
      completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
            NSInteger status = [response isKindOfClass:[NSHTTPURLResponse class]]
                ? [(NSHTTPURLResponse *)response statusCode] : 0;
            NSDictionary *value = data != nil
                ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil]
                : nil;
            dispatch_async(dispatch_get_main_queue(), ^{
                dia_custom_local_memory_request_in_flight = NO;
                dia_custom_local_memory_last_refresh = [NSDate date];
                if (error == nil && status >= 200 && status < 300 &&
                    [value[@"enabled"] respondsToSelector:@selector(boolValue)]) {
                    dia_custom_local_memory_state = [value[@"enabled"] boolValue]
                        ? 1 : 0;
                    if ([value[@"retentionDays"] respondsToSelector:
                        @selector(integerValue)]) {
                        dia_custom_local_memory_retention_days =
                            [value[@"retentionDays"] integerValue];
                    }
                    NSDictionary *stats = [value[@"stats"]
                        isKindOfClass:[NSDictionary class]]
                        ? value[@"stats"] : nil;
                    if ([stats[@"total"] respondsToSelector:
                        @selector(integerValue)]) {
                        dia_custom_local_memory_entry_count =
                            [stats[@"total"] integerValue];
                    }
                } else {
                    dia_custom_local_memory_state = -2;
                }
                dia_custom_refresh_memory_controls(target, action);
            });
        }] resume];
}

static void dia_custom_install_local_memory_controls(id target, SEL action) {
    if (dia_custom_refresh_memory_controls(target, action)) {
        dia_custom_fetch_local_memory_state(target, action, NO);
    }
}

static BOOL dia_custom_model_popup_needs_refresh(NSPopUpButton *popup) {
    NSDictionary *catalog = dia_custom_model_catalog();
    NSArray<NSDictionary *> *models = dia_custom_catalog_models(catalog);
    NSString *selected = [catalog[@"selectedModel"] isKindOfClass:[NSString class]]
        ? catalog[@"selectedModel"] : nil;
    NSMutableArray<NSDictionary *> *validModels = [NSMutableArray array];
    for (NSDictionary *model in models) {
        if ([model[@"key"] isKindOfClass:[NSString class]]) {
            [validModels addObject:model];
        }
    }
    if ([validModels count] == 0) {
        return [popup numberOfItems] != 1 || [popup isEnabled];
    }
    if ([popup numberOfItems] != [validModels count]) {
        return YES;
    }
    for (NSUInteger index = 0; index < [validModels count]; ++index) {
        NSDictionary *model = validModels[index];
        NSMenuItem *item = [popup itemAtIndex:index];
        BOOL available = ![model[@"available"] respondsToSelector:@selector(boolValue)] ||
            [model[@"available"] boolValue];
        if (![[item representedObject] isEqual:model[@"key"]] ||
            [item isEnabled] != available) {
            return YES;
        }
    }
    return selected != nil &&
        ![[[popup selectedItem] representedObject] isEqual:selected];
}

static NSString *dia_custom_model_title(NSDictionary *model) {
    NSString *provider = [model[@"providerLabel"] isKindOfClass:[NSString class]]
        ? model[@"providerLabel"] : @"Model";
    NSString *label = [model[@"label"] isKindOfClass:[NSString class]]
        ? model[@"label"] : model[@"key"];
    return [NSString stringWithFormat:@"%@ · %@", provider, label ?: @"Unknown"];
}

static NSString *dia_custom_model_picker_title(NSDictionary *model) {
    NSString *providerID = [model[@"providerID"] isKindOfClass:[NSString class]]
        ? model[@"providerID"] : nil;
    if ([providerID isEqualToString:@"apple-on-device"]) {
        return @"Apple On-Device";
    }
    if ([providerID isEqualToString:@"apple-private-cloud"]) {
        return @"Apple Cloud";
    }
    NSString *label = [model[@"label"] isKindOfClass:[NSString class]]
        ? model[@"label"] : model[@"key"];
    return label ?: @"Model";
}

static NSMenu *dia_custom_model_menu;

static void dia_custom_set_model_popup_display_title(NSPopUpButton *popup,
                                                       NSString *title) {
    if (popup == nil) {
        return;
    }
    if ([popup respondsToSelector:@selector(setUsesItemFromMenu:)]) {
        [popup setUsesItemFromMenu:NO];
    }
    NSPopUpButtonCell *cell = [popup cell];
    if ([cell isKindOfClass:[NSPopUpButtonCell class]]) {
        // With usesItemFromMenu disabled, setTitle: attempts to select a menu
        // item with that title. Our compact label is intentionally different
        // from the full menu title, so give the cell the static display item
        // that AppKit documents for this mode instead.
        NSMenuItem *displayItem = [[NSMenuItem alloc]
            initWithTitle:title ?: @"Model" action:nil keyEquivalent:@""];
        [cell setMenuItem:displayItem];
        [cell setNeedsSizing:YES];
        [cell setNeedsDisplay:YES];
    } else {
        [popup setTitle:title ?: @"Model"];
    }
    [popup setNeedsDisplay:YES];
}

static void dia_custom_populate_model_popup(NSPopUpButton *popup) {
    NSDictionary *catalog = dia_custom_model_catalog();
    NSArray<NSDictionary *> *models = dia_custom_catalog_models(catalog);
    NSString *selected = [catalog[@"selectedModel"] isKindOfClass:[NSString class]]
        ? catalog[@"selectedModel"] : nil;
    [popup removeAllItems];
    if ([models count] == 0) {
        [popup addItemWithTitle:@"Models loading…"];
        dia_custom_set_model_popup_display_title(popup, @"Models loading…");
        [popup setEnabled:NO];
        return;
    }
    [popup setEnabled:YES];
    NSDictionary *selectedModel = nil;
    for (NSDictionary *model in models) {
        NSString *key = [model[@"key"] isKindOfClass:[NSString class]]
            ? model[@"key"] : nil;
        if (key == nil) {
            continue;
        }
        [popup addItemWithTitle:dia_custom_model_title(model)];
        NSMenuItem *item = [popup lastItem];
        [item setRepresentedObject:key];
        BOOL available = ![model[@"available"] respondsToSelector:@selector(boolValue)] ||
            [model[@"available"] boolValue];
        [item setEnabled:available];
        if ([model[@"reason"] isKindOfClass:[NSString class]]) {
            [item setToolTip:model[@"reason"]];
        } else if ([model[@"description"] isKindOfClass:[NSString class]]) {
            [item setToolTip:model[@"description"]];
        }
        if ([key isEqualToString:selected]) {
            [popup selectItem:item];
            selectedModel = model;
        }
    }
    // Preserve the full provider/model names in the menu while keeping the
    // control itself narrow enough for Dia's command-bar toolbar.
    if (selectedModel != nil) {
        dia_custom_set_model_popup_display_title(
            popup, dia_custom_model_picker_title(selectedModel));
    }
}

static void dia_custom_refresh_model_popups_in_view(NSView *view) {
    if (view == nil) {
        return;
    }
    if ([view isKindOfClass:[NSPopUpButton class]] &&
        [[[view identifier] description] isEqualToString:@"DiaCustomModelPicker"]) {
        dia_custom_populate_model_popup((NSPopUpButton *)view);
    }
    for (NSView *child in [view subviews]) {
        dia_custom_refresh_model_popups_in_view(child);
    }
}

static NSPopUpButton *dia_custom_find_model_popup_in_view(NSView *view) {
    if (view == nil) {
        return nil;
    }
    if ([view isKindOfClass:[NSPopUpButton class]] &&
        [[[view identifier] description] isEqualToString:@"DiaCustomModelPicker"]) {
        return (NSPopUpButton *)view;
    }
    for (NSView *child in [view subviews]) {
        NSPopUpButton *match = dia_custom_find_model_popup_in_view(child);
        if (match != nil) {
            return match;
        }
    }
    return nil;
}

static void dia_custom_refresh_model_popups(void) {
    for (NSWindow *window in [NSApp windows]) {
        dia_custom_refresh_model_popups_in_view([window contentView]);
    }
}

static void dia_custom_rebuild_model_menu(id target, SEL action) {
    if (dia_custom_model_menu == nil) {
        return;
    }
    [dia_custom_model_menu removeAllItems];
    NSDictionary *catalog = dia_custom_model_catalog();
    NSArray<NSDictionary *> *models = dia_custom_catalog_models(catalog);
    NSString *selected = [catalog[@"selectedModel"] isKindOfClass:[NSString class]]
        ? catalog[@"selectedModel"] : nil;
    NSString *lastProvider = nil;
    for (NSDictionary *model in models) {
        NSString *key = [model[@"key"] isKindOfClass:[NSString class]]
            ? model[@"key"] : nil;
        NSString *provider = [model[@"providerLabel"] isKindOfClass:[NSString class]]
            ? model[@"providerLabel"] : @"Models";
        if (key == nil) {
            continue;
        }
        if (lastProvider != nil && ![provider isEqualToString:lastProvider]) {
            [dia_custom_model_menu addItem:[NSMenuItem separatorItem]];
        }
        lastProvider = provider;
        NSMenuItem *item = [[NSMenuItem alloc]
            initWithTitle:dia_custom_model_title(model)
                   action:action
            keyEquivalent:@""];
        [item setTarget:target];
        [item setRepresentedObject:key];
        BOOL available = ![model[@"available"] respondsToSelector:@selector(boolValue)] ||
            [model[@"available"] boolValue];
        [item setEnabled:available];
        [item setState:[key isEqualToString:selected]
            ? NSControlStateValueOn : NSControlStateValueOff];
        if ([model[@"reason"] isKindOfClass:[NSString class]]) {
            [item setToolTip:model[@"reason"]];
        }
        [dia_custom_model_menu addItem:item];
    }
    if ([models count] == 0) {
        NSMenuItem *loading = [[NSMenuItem alloc]
            initWithTitle:@"Models loading…" action:nil keyEquivalent:@""];
        [loading setEnabled:NO];
        [dia_custom_model_menu addItem:loading];
    }
    dia_custom_refresh_model_popups();
}

static NSStackView *dia_custom_toolbar_standard_stack(id toolbar) {
    @try {
        id value = [toolbar valueForKey:@"standardContentStackView"];
        if ([value isKindOfClass:[NSStackView class]]) {
            return value;
        }
    } @catch (__unused NSException *exception) {
    }
    Ivar ivar = class_getInstanceVariable(object_getClass(toolbar),
        "$__lazy_storage_$_standardContentStackView");
    if (ivar != NULL) {
        id value = object_getIvar(toolbar, ivar);
        if ([value isKindOfClass:[NSStackView class]]) {
            return value;
        }
    }
    return nil;
}

static BOOL dia_custom_view_text_contains(NSView *view, NSString *needle) {
    if (view == nil || needle == nil) {
        return NO;
    }
    NSMutableArray<NSString *> *values = [NSMutableArray arrayWithObject:
        NSStringFromClass([view class]) ?: @""];
    if ([view identifier] != nil) {
        [values addObject:[[view identifier] description]];
    }
    if ([view toolTip] != nil) {
        [values addObject:[view toolTip]];
    }
    @try {
        NSString *identifier = [view accessibilityIdentifier];
        NSString *label = [view accessibilityLabel];
        if (identifier != nil) [values addObject:identifier];
        if (label != nil) [values addObject:label];
    } @catch (__unused NSException *exception) {
    }
    NSString *summary = [[values componentsJoinedByString:@" "] lowercaseString];
    return [summary containsString:[needle lowercaseString]];
}

static BOOL dia_custom_view_tree_is_microphone(NSView *view) {
    if (dia_custom_view_text_contains(view, @"microphone") ||
        dia_custom_view_text_contains(view, @"voice") ||
        dia_custom_view_text_contains(view, @"dictation")) {
        return YES;
    }
    for (NSView *child in [view subviews]) {
        if (dia_custom_view_tree_is_microphone(child)) {
            return YES;
        }
    }
    return NO;
}

static BOOL dia_custom_toolbar_is_on_new_tab(id toolbar) {
    for (NSView *view = toolbar; view != nil; view = [view superview]) {
        if (dia_custom_view_text_contains(view, @"newtab") ||
            dia_custom_view_text_contains(view, @"new tab")) {
            return YES;
        }
    }
    return NO;
}

static NSUInteger dia_custom_model_picker_index(id toolbar,
                                                 NSStackView *stack,
                                                 NSPopUpButton *popup) {
    if (!dia_custom_toolbar_is_on_new_tab(toolbar)) {
        return 0;
    }
    NSMutableArray<NSView *> *nativeViews = [NSMutableArray array];
    for (NSView *view in [stack arrangedSubviews]) {
        if (view != popup) {
            [nativeViews addObject:view];
        }
    }
    for (NSUInteger index = 0; index < [nativeViews count]; ++index) {
        if (dia_custom_view_tree_is_microphone(nativeViews[index])) {
            return index;
        }
    }
    // Dia's new-tab toolbar ends with microphone and send. Keep the requested
    // placement stable if a build exposes neither control's accessibility
    // label by inserting before that final pair.
    return [nativeViews count] >= 2 ? [nativeViews count] - 2 : 0;
}

static void dia_custom_position_model_picker(id toolbar,
                                             NSStackView *stack,
                                             NSPopUpButton *popup) {
    NSArray<NSView *> *arranged = [stack arrangedSubviews];
    NSUInteger currentIndex = [arranged indexOfObjectIdenticalTo:popup];
    NSUInteger targetIndex = dia_custom_model_picker_index(toolbar, stack, popup);
    if (currentIndex == targetIndex) {
        return;
    }
    if (currentIndex != NSNotFound) {
        [popup retain];
        [stack removeArrangedSubview:popup];
        [popup removeFromSuperview];
        [stack insertArrangedSubview:popup atIndex:
            MIN(targetIndex, [[stack arrangedSubviews] count])];
        [popup release];
    } else {
        [stack insertArrangedSubview:popup atIndex:
            MIN(targetIndex, [[stack arrangedSubviews] count])];
    }
}

static void dia_custom_install_custom_model_picker(id target, SEL action) {
    if (target == nil) {
        return;
    }
    for (NSWindow *window in [NSApp windows]) {
        NSMutableArray *toolbars = [NSMutableArray array];
        dia_custom_collect_views_named([window contentView],
                                       @"BoostCommandBar.ToolbarView",
                                       toolbars);
        for (id toolbar in toolbars) {
            NSStackView *stack = dia_custom_toolbar_standard_stack(toolbar);
            if (stack == nil) {
                continue;
            }
            NSPopUpButton *installedPopup = nil;
            for (NSView *view in [stack arrangedSubviews]) {
                if ([[view identifier] isEqualToString:@"DiaCustomModelPicker"]) {
                    if ([view isKindOfClass:[NSPopUpButton class]]) {
                        installedPopup = (NSPopUpButton *)view;
                    }
                    break;
                }
            }
            if (installedPopup != nil) {
                // The picker is often installed before the bridge finishes its
                // first model-catalog refresh. Keep the existing view (and its
                // stable command-bar geometry), but repopulate it on each
                // scheduled attempt so "Models loading…" can become enabled.
                [installedPopup setTarget:target];
                [installedPopup setAction:action];
                [installedPopup setAutoenablesItems:NO];
                if (dia_custom_model_popup_needs_refresh(installedPopup)) {
                    dia_custom_populate_model_popup(installedPopup);
                }
                dia_custom_position_model_picker(toolbar, stack, installedPopup);
                [installedPopup setHidden:NO];
                [installedPopup setAlphaValue:1.0];
                continue;
            }
            NSPopUpButton *popup = [[NSPopUpButton alloc]
                initWithFrame:NSMakeRect(0, 0, 132, 26)
                   pullsDown:NO];
            [popup setIdentifier:@"DiaCustomModelPicker"];
            [popup setControlSize:NSControlSizeSmall];
            [popup setAutoenablesItems:NO];
            if ([popup respondsToSelector:@selector(setUsesItemFromMenu:)]) {
                [popup setUsesItemFromMenu:NO];
            }
            [popup setTarget:target];
            [popup setAction:action];
            [popup setToolTip:@"Choose the model for Dia Custom chat"];
            [popup setContentHuggingPriority:NSLayoutPriorityRequired
                              forOrientation:NSLayoutConstraintOrientationHorizontal];
            [popup setContentCompressionResistancePriority:NSLayoutPriorityRequired
                                           forOrientation:NSLayoutConstraintOrientationHorizontal];
            [popup.widthAnchor constraintEqualToConstant:132].active = YES;
            dia_custom_populate_model_popup(popup);
            // Reserve the final geometry without showing an intermediate
            // offscreen frame while New Chat animates its command bar.
            [popup setAlphaValue:0.0];
            dia_custom_position_model_picker(toolbar, stack, popup);
            for (NSView *ancestor = stack; ancestor != nil;
                 ancestor = [ancestor superview]) {
                [ancestor setNeedsUpdateConstraints:YES];
                [ancestor setNeedsLayout:YES];
            }
            [[window contentView] layoutSubtreeIfNeeded];
            dispatch_async(dispatch_get_main_queue(), ^{
                [[window contentView] layoutSubtreeIfNeeded];
                [popup setAlphaValue:1.0];
            });
            dia_custom_log_status(@"model-picker-installed");
        }
    }
}

static BOOL dia_custom_interface_refresh_pending = NO;

static void dia_custom_request_interface_refresh(id target,
                                                 SEL modelAction,
                                                 SEL memoryAction) {
    if (target == nil || dia_custom_interface_refresh_pending) {
        return;
    }
    dia_custom_interface_refresh_pending = YES;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 150 * NSEC_PER_MSEC),
                   dispatch_get_main_queue(), ^{
        dia_custom_interface_refresh_pending = NO;
        dia_custom_install_custom_model_picker(target, modelAction);
        dia_custom_install_local_memory_controls(target, memoryAction);
    });
}

static void dia_custom_schedule_model_picker_attempts(id target,
                                                       SEL action,
                                                       unsigned attempt) {
    if (target == nil || attempt >= 30) {
        return;
    }
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC),
                   dispatch_get_main_queue(), ^{
        dia_custom_install_custom_model_picker(target, action);
        dia_custom_schedule_model_picker_attempts(target, action, attempt + 1);
    });
}

@interface DiaCustomDeveloperMenuController : NSObject
- (void)openPromptTools:(id)sender;
- (void)openNativeModelPicker:(id)sender;
- (void)selectCustomModel:(id)sender;
- (void)toggleLocalMemory:(id)sender;
- (void)setLocalMemoryRetention:(id)sender;
- (void)resetLocalMemory:(id)sender;
- (void)openModelSettings:(id)sender;
- (void)windowBecameKey:(NSNotification *)notification;
- (void)windowDidUpdate:(NSNotification *)notification;
- (void)openBrowserDeveloperTools:(id)sender;
- (void)openAgentServerDashboard:(id)sender;
- (void)openLogLevels:(id)sender;
@end

@implementation DiaCustomDeveloperMenuController
- (NSString *)modelKeyFromSender:(id)sender {
    if ([sender isKindOfClass:[NSPopUpButton class]]) {
        return [[[sender selectedItem] representedObject]
            isKindOfClass:[NSString class]]
            ? [[sender selectedItem] representedObject] : nil;
    }
    id value = [sender respondsToSelector:@selector(representedObject)]
        ? [sender representedObject] : nil;
    return [value isKindOfClass:[NSString class]] ? value : nil;
}

- (void)selectCustomModel:(id)sender {
    NSString *modelKey = [self modelKeyFromSender:sender];
    NSDictionary *catalog = dia_custom_model_catalog();
    NSString *token = [catalog[@"selectionToken"] isKindOfClass:[NSString class]]
        ? catalog[@"selectionToken"] : nil;
    const char *settingsValue = getenv("DIA_CUSTOM_SETTINGS_URL");
    NSString *settings = settingsValue != NULL
        ? [NSString stringWithUTF8String:settingsValue]
        : @"http://127.0.0.1:8765/settings";
    NSURLComponents *components = [NSURLComponents
        componentsWithString:settings];
    components.path = @"/api/selection";
    components.query = nil;
    components.fragment = nil;
    if (modelKey == nil || token == nil || components.URL == nil) {
        NSBeep();
        return;
    }

    NSMutableURLRequest *request = [NSMutableURLRequest
        requestWithURL:components.URL];
    request.HTTPMethod = @"PUT";
    [request setValue:@"application/json" forHTTPHeaderField:@"content-type"];
    [request setValue:token forHTTPHeaderField:@"x-dia-custom-token"];
    request.HTTPBody = [NSJSONSerialization dataWithJSONObject:@{
        @"model": modelKey,
    } options:0 error:nil];
    DiaCustomDeveloperMenuController *controller = self;
    [[[NSURLSession sharedSession]
        dataTaskWithRequest:request
         completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
            NSInteger status = [response isKindOfClass:[NSHTTPURLResponse class]]
                ? [(NSHTTPURLResponse *)response statusCode] : 0;
            dispatch_async(dispatch_get_main_queue(), ^{
                DiaCustomDeveloperMenuController *strongSelf = controller;
                if (error != nil || status < 200 || status >= 300) {
                    NSString *message = error.localizedDescription;
                    if (message == nil && data != nil) {
                        NSDictionary *value = [NSJSONSerialization
                            JSONObjectWithData:data options:0 error:nil];
                        message = [value[@"error"] isKindOfClass:[NSString class]]
                            ? value[@"error"] : nil;
                    }
                    NSAlert *alert = [[NSAlert alloc] init];
                    alert.messageText = @"Could not change Dia Custom model";
                    alert.informativeText = message ?: @"The local bridge rejected the selection.";
                    [alert runModal];
                    dia_custom_rebuild_model_menu(strongSelf,
                        @selector(selectCustomModel:));
                    return;
                }
                dia_custom_rebuild_model_menu(strongSelf,
                    @selector(selectCustomModel:));
                dia_custom_install_custom_model_picker(strongSelf,
                    @selector(selectCustomModel:));
            });
        }] resume];
}

- (void)openModelSettings:(id)sender {
    const char *rawURL = getenv("DIA_CUSTOM_SETTINGS_URL");
    NSString *value = rawURL != NULL
        ? [NSString stringWithUTF8String:rawURL]
        : @"http://127.0.0.1:8765/settings";
    NSURL *url = [NSURL URLWithString:value];
    if (url == nil || ![[NSWorkspace sharedWorkspace] openURL:url]) {
        NSBeep();
    }
}

- (void)windowBecameKey:(NSNotification *)notification {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 250 * NSEC_PER_MSEC),
                   dispatch_get_main_queue(), ^{
        dia_custom_install_custom_model_picker(self,
            @selector(selectCustomModel:));
        dia_custom_install_local_memory_controls(self,
            @selector(toggleLocalMemory:));
    });
}

- (void)windowDidUpdate:(NSNotification *)notification {
    dia_custom_request_interface_refresh(self,
        @selector(selectCustomModel:),
        @selector(toggleLocalMemory:));
}

- (void)toggleLocalMemory:(id)sender {
    if (![sender isKindOfClass:[NSButton class]]) {
        return;
    }
    if (dia_custom_local_memory_state != 0 &&
        dia_custom_local_memory_state != 1) {
        dia_custom_local_memory_state = -1;
        dia_custom_refresh_memory_controls(self,
            @selector(toggleLocalMemory:));
        dia_custom_fetch_local_memory_state(self,
            @selector(toggleLocalMemory:), YES);
        return;
    }

    NSInteger previousState = dia_custom_local_memory_state;
    BOOL requestedState = previousState == 0;
    NSDictionary *catalog = dia_custom_model_catalog();
    NSString *token = [catalog[@"selectionToken"] isKindOfClass:[NSString class]]
        ? catalog[@"selectionToken"] : nil;
    NSURL *url = dia_custom_local_api_url(@"/api/memory/enabled");
    if (token == nil || url == nil) {
        NSBeep();
        return;
    }

    NSButton *button = (NSButton *)sender;
    [button setEnabled:NO];
    [button setTitle:@"Saving…"];
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
    request.HTTPMethod = @"PUT";
    [request setValue:@"application/json" forHTTPHeaderField:@"content-type"];
    [request setValue:token forHTTPHeaderField:@"x-dia-custom-token"];
    request.HTTPBody = [NSJSONSerialization dataWithJSONObject:@{
        @"enabled": @(requestedState),
    } options:0 error:nil];
    DiaCustomDeveloperMenuController *controller = self;
    [[[NSURLSession sharedSession]
        dataTaskWithRequest:request
         completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
            NSInteger status = [response isKindOfClass:[NSHTTPURLResponse class]]
                ? [(NSHTTPURLResponse *)response statusCode] : 0;
            NSDictionary *value = data != nil
                ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil]
                : nil;
            dispatch_async(dispatch_get_main_queue(), ^{
                DiaCustomDeveloperMenuController *strongSelf = controller;
                dia_custom_local_memory_last_refresh = [NSDate date];
                if (error == nil && status >= 200 && status < 300 &&
                    [value[@"enabled"] respondsToSelector:@selector(boolValue)]) {
                    dia_custom_local_memory_state = [value[@"enabled"] boolValue]
                        ? 1 : 0;
                } else {
                    dia_custom_local_memory_state = previousState;
                    NSString *message = error.localizedDescription;
                    if (message == nil && [value[@"error"] isKindOfClass:[NSString class]]) {
                        message = value[@"error"];
                    }
                    NSAlert *alert = [[NSAlert alloc] init];
                    alert.messageText = @"Could not change local memory";
                    alert.informativeText = message ?:
                        @"The localhost bridge rejected the memory setting.";
                    [alert runModal];
                }
                dia_custom_refresh_memory_controls(strongSelf,
                    @selector(toggleLocalMemory:));
            });
        }] resume];
}

- (void)setLocalMemoryRetention:(id)sender {
    if (![sender isKindOfClass:[NSPopUpButton class]]) {
        return;
    }
    NSPopUpButton *popup = (NSPopUpButton *)sender;
    NSNumber *selection = [[[popup selectedItem] representedObject]
        isKindOfClass:[NSNumber class]]
        ? [[popup selectedItem] representedObject] : nil;
    if (selection == nil) {
        dia_custom_populate_retention_popup(popup);
        return;
    }
    NSInteger requestedDays = [selection integerValue];
    NSInteger previousDays = dia_custom_local_memory_retention_days;
    if (requestedDays == previousDays) {
        return;
    }
    if (requestedDays > 0 &&
        (previousDays == 0 || requestedDays < previousDays)) {
        NSAlert *confirmation = [[NSAlert alloc] init];
        confirmation.alertStyle = NSAlertStyleWarning;
        confirmation.messageText = @"Shorten local memory retention?";
        confirmation.informativeText = [NSString stringWithFormat:
            @"Dia Custom will permanently remove local memory older than %@. This does not contact Dia.",
            dia_custom_memory_retention_title(requestedDays)];
        [confirmation addButtonWithTitle:@"Apply Retention"];
        [confirmation addButtonWithTitle:@"Cancel"];
        if ([confirmation runModal] != NSAlertFirstButtonReturn) {
            dia_custom_populate_retention_popup(popup);
            return;
        }
    }

    NSDictionary *catalog = dia_custom_model_catalog();
    NSString *token = [catalog[@"selectionToken"] isKindOfClass:[NSString class]]
        ? catalog[@"selectionToken"] : nil;
    NSURL *url = dia_custom_local_api_url(@"/api/memory/retention");
    if (token == nil || url == nil) {
        NSBeep();
        dia_custom_populate_retention_popup(popup);
        return;
    }
    popup.enabled = NO;
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
    request.HTTPMethod = @"PUT";
    [request setValue:@"application/json" forHTTPHeaderField:@"content-type"];
    [request setValue:token forHTTPHeaderField:@"x-dia-custom-token"];
    request.HTTPBody = [NSJSONSerialization dataWithJSONObject:@{
        @"retentionDays": @(requestedDays),
    } options:0 error:nil];
    DiaCustomDeveloperMenuController *controller = self;
    [[[NSURLSession sharedSession]
        dataTaskWithRequest:request
         completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
            NSInteger status = [response isKindOfClass:[NSHTTPURLResponse class]]
                ? [(NSHTTPURLResponse *)response statusCode] : 0;
            NSDictionary *value = data != nil
                ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil]
                : nil;
            dispatch_async(dispatch_get_main_queue(), ^{
                DiaCustomDeveloperMenuController *strongSelf = controller;
                NSDictionary *localMemory = [value[@"localMemory"]
                    isKindOfClass:[NSDictionary class]]
                    ? value[@"localMemory"] : nil;
                NSDictionary *stats = [value[@"stats"]
                    isKindOfClass:[NSDictionary class]] ? value[@"stats"] : nil;
                if (error == nil && status >= 200 && status < 300 &&
                    [localMemory[@"retentionDays"] respondsToSelector:
                        @selector(integerValue)]) {
                    dia_custom_local_memory_retention_days =
                        [localMemory[@"retentionDays"] integerValue];
                    if ([stats[@"total"] respondsToSelector:
                        @selector(integerValue)]) {
                        dia_custom_local_memory_entry_count =
                            [stats[@"total"] integerValue];
                    }
                } else {
                    dia_custom_local_memory_retention_days = previousDays;
                    NSString *message = error.localizedDescription;
                    if (message == nil && [value[@"error"]
                        isKindOfClass:[NSString class]]) {
                        message = value[@"error"];
                    }
                    NSAlert *alert = [[NSAlert alloc] init];
                    alert.messageText = @"Could not change memory retention";
                    alert.informativeText = message ?:
                        @"The localhost bridge rejected the retention setting.";
                    [alert runModal];
                }
                dia_custom_local_memory_last_refresh = [NSDate date];
                dia_custom_refresh_memory_controls(strongSelf,
                    @selector(toggleLocalMemory:));
            });
        }] resume];
}

- (void)resetLocalMemory:(id)sender {
    NSAlert *confirmation = [[NSAlert alloc] init];
    confirmation.alertStyle = NSAlertStyleWarning;
    confirmation.messageText = @"Reset local Memory?";
    confirmation.informativeText =
        @"This permanently deletes Dia Custom browsing and chat memory on this Mac. Imported connector records are kept. Nothing is sent to Dia.";
    [confirmation addButtonWithTitle:@"Reset Memory"];
    [confirmation addButtonWithTitle:@"Cancel"];
    if ([confirmation runModal] != NSAlertFirstButtonReturn) {
        return;
    }

    NSDictionary *catalog = dia_custom_model_catalog();
    NSString *token = [catalog[@"selectionToken"] isKindOfClass:[NSString class]]
        ? catalog[@"selectionToken"] : nil;
    NSURL *url = dia_custom_local_api_url(@"/api/memory");
    if (token == nil || url == nil) {
        NSBeep();
        return;
    }
    if ([sender respondsToSelector:@selector(setEnabled:)]) {
        [sender setEnabled:NO];
    }
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
    request.HTTPMethod = @"DELETE";
    [request setValue:@"application/json" forHTTPHeaderField:@"content-type"];
    [request setValue:token forHTTPHeaderField:@"x-dia-custom-token"];
    request.HTTPBody = [NSJSONSerialization dataWithJSONObject:@{
        @"entryTypes": @[@"navigation", @"conversation"],
    } options:0 error:nil];
    DiaCustomDeveloperMenuController *controller = self;
    [[[NSURLSession sharedSession]
        dataTaskWithRequest:request
         completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
            NSInteger status = [response isKindOfClass:[NSHTTPURLResponse class]]
                ? [(NSHTTPURLResponse *)response statusCode] : 0;
            NSDictionary *value = data != nil
                ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil]
                : nil;
            dispatch_async(dispatch_get_main_queue(), ^{
                DiaCustomDeveloperMenuController *strongSelf = controller;
                if (error != nil || status < 200 || status >= 300) {
                    NSString *message = error.localizedDescription;
                    if (message == nil && [value[@"error"]
                        isKindOfClass:[NSString class]]) {
                        message = value[@"error"];
                    }
                    NSAlert *alert = [[NSAlert alloc] init];
                    alert.messageText = @"Could not reset local Memory";
                    alert.informativeText = message ?:
                        @"The localhost bridge rejected the reset.";
                    [alert runModal];
                }
                dia_custom_local_memory_last_refresh = nil;
                dia_custom_fetch_local_memory_state(strongSelf,
                    @selector(toggleLocalMemory:), YES);
            });
        }] resume];
}

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
    id nativeButton = dia_custom_enable_native_model_picker();
    id owner = dia_custom_native_model_picker_owner();
    SEL selector = NSSelectorFromString(@"handleModelSelectorClicked");
    if (nativeButton != nil && owner != nil &&
        [owner respondsToSelector:selector]) {
        IMP implementation = [owner methodForSelector:selector];
        ((void (*)(id, SEL))implementation)(owner, selector);
    } else {
        dia_custom_install_custom_model_picker(self,
            @selector(selectCustomModel:));
        NSPopUpButton *popup = dia_custom_find_model_popup_in_view(
            [dia_custom_platform_window() contentView]);
        if (popup != nil) {
            [popup performClick:nil];
        } else if (![NSApp sendAction:selector to:nil from:sender]) {
            NSBeep();
        }
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
        if (developerMenu == nil) {
            developerMenu = [[NSMenu alloc] initWithTitle:@"Developer"];
            NSMenuItem *developerItem = [[NSMenuItem alloc]
                initWithTitle:@"Developer" action:nil keyEquivalent:@""];
            [developerItem setSubmenu:developerMenu];
            [viewMenu addItem:developerItem];
        }
        if ([developerMenu itemWithTitle:@"AI Model"] != nil) {
            return;
        }

        dia_custom_developer_menu_controller =
            [[DiaCustomDeveloperMenuController alloc] init];
        [developerMenu addItem:[NSMenuItem separatorItem]];

        dia_custom_model_menu = [[NSMenu alloc] initWithTitle:@"AI Model"];
        NSMenuItem *modelMenuItem = [[NSMenuItem alloc]
            initWithTitle:@"AI Model" action:nil keyEquivalent:@""];
        [modelMenuItem setSubmenu:dia_custom_model_menu];
        [developerMenu addItem:modelMenuItem];
        dia_custom_rebuild_model_menu(dia_custom_developer_menu_controller,
            @selector(selectCustomModel:));

        NSMenuItem *modelSettings = [[NSMenuItem alloc]
            initWithTitle:@"Model Providers & Settings…"
                   action:@selector(openModelSettings:)
            keyEquivalent:@""];
        [modelSettings setTarget:dia_custom_developer_menu_controller];
        [developerMenu addItem:modelSettings];

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

        dia_custom_install_custom_model_picker(
            dia_custom_developer_menu_controller,
            @selector(selectCustomModel:));
        dia_custom_install_local_memory_controls(
            dia_custom_developer_menu_controller,
            @selector(toggleLocalMemory:));
        dia_custom_schedule_model_picker_attempts(
            dia_custom_developer_menu_controller,
            @selector(selectCustomModel:),
            0);
        [[NSNotificationCenter defaultCenter]
            addObserver:dia_custom_developer_menu_controller
               selector:@selector(windowBecameKey:)
                   name:NSWindowDidBecomeKeyNotification
                 object:nil];
        [[NSNotificationCenter defaultCenter]
            addObserver:dia_custom_developer_menu_controller
               selector:@selector(windowDidUpdate:)
                   name:NSWindowDidUpdateNotification
                 object:nil];
        dia_custom_log_status(@"developer-menu-installed");

    });
}

__attribute__((constructor))
static void dia_custom_install_runtime_overrides(void) {
    const char *program = getprogname();
    if (program == NULL || strcmp(program, "Dia") != 0) {
        return;
    }

    dia_custom_schedule_network_log();
    dia_custom_close_account_window();
    dia_custom_install_developer_menu();
}
