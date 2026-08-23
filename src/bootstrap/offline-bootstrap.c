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

static NSString *dia_custom_model_title(NSDictionary *model) {
    NSString *provider = [model[@"providerLabel"] isKindOfClass:[NSString class]]
        ? model[@"providerLabel"] : @"Model";
    NSString *label = [model[@"label"] isKindOfClass:[NSString class]]
        ? model[@"label"] : model[@"key"];
    return [NSString stringWithFormat:@"%@ · %@", provider, label ?: @"Unknown"];
}

static NSString *dia_custom_model_picker_title(NSDictionary *model) {
    NSString *label = [model[@"label"] isKindOfClass:[NSString class]]
        ? model[@"label"] : model[@"key"];
    return label ?: @"Model";
}

static NSMenu *dia_custom_model_menu;

static void dia_custom_populate_model_popup(NSPopUpButton *popup) {
    NSDictionary *catalog = dia_custom_model_catalog();
    NSArray<NSDictionary *> *models = dia_custom_catalog_models(catalog);
    NSString *selected = [catalog[@"selectedModel"] isKindOfClass:[NSString class]]
        ? catalog[@"selectedModel"] : nil;
    [popup removeAllItems];
    if ([models count] == 0) {
        [popup addItemWithTitle:@"Models loading…"];
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
        [popup setTitle:dia_custom_model_picker_title(selectedModel)];
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
            BOOL alreadyInstalled = NO;
            for (NSView *view in [stack arrangedSubviews]) {
                if ([[view identifier] isEqualToString:@"DiaCustomModelPicker"]) {
                    alreadyInstalled = YES;
                    break;
                }
            }
            if (alreadyInstalled) {
                continue;
            }
            NSPopUpButton *popup = [[NSPopUpButton alloc]
                initWithFrame:NSMakeRect(0, 0, 132, 26)
                   pullsDown:NO];
            [popup setIdentifier:@"DiaCustomModelPicker"];
            [popup setControlSize:NSControlSizeSmall];
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
            [stack insertArrangedSubview:popup atIndex:0];
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
- (void)openModelSettings:(id)sender;
- (void)windowBecameKey:(NSNotification *)notification;
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
    });
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
        dia_custom_schedule_model_picker_attempts(
            dia_custom_developer_menu_controller,
            @selector(selectCustomModel:),
            0);
        [[NSNotificationCenter defaultCenter]
            addObserver:dia_custom_developer_menu_controller
               selector:@selector(windowBecameKey:)
                   name:NSWindowDidBecomeKeyNotification
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
