#import <Foundation/Foundation.h>
#import <AppKit/AppKit.h>
#import <objc/runtime.h>
#include <crt_externs.h>
#include <dlfcn.h>
#include <stdio.h>
#include <stdlib.h>
#include <execinfo.h>

static id (*research_original_defaults)(id, SEL, NSString *);
extern void dia_research_snapshot_states(void);
static id research_read_defaults(id owner, SEL selector, NSString *key) {
    id value = research_original_defaults(owner, selector, key);
    if ([key isEqualToString:@"transientFeatureFlagOverrides"]) {
        fprintf(stderr, "research-native-default-read selector=%s valueType=%s\n",
            sel_getName(selector), value ? class_getName(object_getClass(value)) : "nil");
        void *frames[16]; int count = backtrace(frames, 16);
        for (int i = 1; i < count; i++) {
            Dl_info info;
            if (dladdr(frames[i], &info) && info.dli_fname &&
                strcmp(strrchr(info.dli_fname, '/') ?: "", "/Dia") == 0)
                fprintf(stderr, "research-native-default-caller=0x%lx\n", (unsigned long)((uintptr_t)frames[i] - (uintptr_t)info.dli_fbase));
        }
    }
    return value;
}

// Compiled into disposable copies only, and called BEFORE the normal bootstrap.
// Isolation must survive Finder/CUA relaunches that omit argv and environment.
static void dia_research_prepare(void) {
    @autoreleasepool {
        if (![NSBundle.mainBundle.bundleIdentifier isEqualToString:@"local.rttm.dia.browser-use-research"] ||
            ![NSBundle.mainBundle.bundlePath.stringByResolvingSymlinksInPath
                isEqualToString:[@DIA_RESEARCH_APP stringByResolvingSymlinksInPath]]) _exit(78);
        NSString *profile = @DIA_RESEARCH_PROFILE;
        for (NSString *key in NSProcessInfo.processInfo.environment.allKeys) {
            if ([key hasPrefix:@"DIA_CUSTOM_"]) unsetenv(key.UTF8String);
        }
        setenv("DIA_CUSTOM_PROFILE", profile.UTF8String, 1);
        setenv("DIA_CUSTOM_STATE_DIR", [profile stringByAppendingPathComponent:@"Bridge/.state"].UTF8String, 1);
        setenv("DIA_CUSTOM_PREFLIGHT", "1", 1);
        setenv("DIA_CUSTOM_STAGING", "1", 1);
        setenv("DIA_CUSTOM_RUNTIME_ID", "browser-use-research-87864", 1);
        setenv("DIA_CUSTOM_MODS", DIA_RESEARCH_MODS, 1);
        // Existing logger strips credentials/query strings and records only
        // origins for external traffic. Enable it only in this fixture copy.
        setenv("DIA_CUSTOM_NETWORK_LOG", [profile.stringByDeletingLastPathComponent
            stringByAppendingPathComponent:@"network.log"].UTF8String, 1);
        // Replace, rather than append, command line policy on every launch.
        NSArray *args = @[[NSBundle.mainBundle.executablePath copy],
            @"-customApplicationDataBaseURLPath", profile,
            [@"--user-data-dir=" stringByAppendingString:[profile stringByAppendingPathComponent:@"User Data"]],
            @"--use-mock-keychain", @"--remote-debugging-port=19223",
            @"--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
            @"--no-first-run", @"--disable-sync", @"--disable-component-update", @"--disable-background-networking",
            @"http://localhost:18865/qa"];
        char **argv = calloc(args.count + 1, sizeof(char *));
        for (NSUInteger i = 0; i < args.count; i++) argv[i] = strdup([args[i] UTF8String]);
        *_NSGetArgc() = (int)args.count;
        *_NSGetArgv() = argv;
        NSUserDefaults *defaults = NSUserDefaults.standardUserDefaults;
        NSMutableDictionary *policy = [[defaults volatileDomainForName:NSArgumentDomain] mutableCopy];
        policy[@"customApplicationDataBaseURLPath"] = profile;
        policy[@"transientFeatureFlagOverrides"] = [[@DIA_RESEARCH_FLAGS componentsSeparatedByString:@","] componentsJoinedByString:@"|"];
        policy[@"hasPresentedOnboardingIntro"] = @YES;
        policy[@"hasUserAuthenticated"] = @YES;
        policy[@"onboardingRemainingSteps"] = @[];
        for (NSString *key in @[@"onboardingForceCompleteFlowEnabled", @"shouldShareUsageData", @"firebaseSyncEnabled", @"cloudKitSyncEnabled"])
            policy[key] = @NO;
        [defaults setVolatileDomain:policy forName:NSArgumentDomain];
        Method getter = class_getInstanceMethod(NSUserDefaults.class, @selector(objectForKey:));
        research_original_defaults = (void *)method_getImplementation(getter);
        method_setImplementation(getter, (IMP)research_read_defaults);
        id raw = [defaults objectForKey:@"transientFeatureFlagOverrides"];
        fprintf(stderr, "research-feature-flags-before=%s\n", NSStringFromClass([raw class]).UTF8String);
        NSArray *flags = [[defaults stringForKey:@"transientFeatureFlagOverrides"] componentsSeparatedByString:@"|"];
        fprintf(stderr, "research-feature-flags-array=%lu browser=%d style=%d default-chat=%d\n", (unsigned long)flags.count,
            [flags containsObject:@"task-browser-use-enabled=true"], [flags containsObject:@"tasks-style-enabled=true"],
            [flags containsObject:@"task-execution-default-chat-enabled=true"]);
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
            dia_research_snapshot_states();
        });
    }
}
