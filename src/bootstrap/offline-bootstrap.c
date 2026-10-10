#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#include <objc/runtime.h>
#include <dispatch/dispatch.h>
#include <mach-o/dyld.h>
#include <crt_externs.h>
#include <arpa/inet.h>
#include <fcntl.h>
#include <libproc.h>
#include <signal.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <unistd.h>
#include "prompt-tools-offsets.h"
#include "native-actions-offsets.h"

extern BOOL dia_custom_swift_invoke_window_presenter_action(
    const void *applicationController,
    const char *fieldName);
extern BOOL dia_custom_swift_invoke_menu_action(
    const void *menuOrchestrator,
    const char *actionName);
extern BOOL dia_custom_swift_set_native_apps_enabled(
    const void *viewModel,
    BOOL morningBriefEnabled);
extern char *dia_custom_swift_native_apps_connections_json(
    const void *viewModel);
extern char *dia_custom_swift_native_apps_selected_profile_id(
    const void *viewModel);
extern int32_t dia_custom_swift_native_apps_morning_brief_state(
    const void *object);
extern BOOL dia_custom_swift_invoke_native_apps_enable(const void *view);
extern BOOL dia_custom_swift_toolbar_uses_response_commands(const void *toolbar);
extern BOOL dia_custom_swift_invoke_morning_brief(
    const void *applicationController, const void *platformWindow, const void *implementation);
extern void dia_custom_call_swift_void_method(const void *implementation, const void *object);
extern void *dia_custom_call_prompt_tools_allocating_init(
    const void *initializer,
    const void *classMetadata,
    const void *browserID,
    const void *dependencyPropagationToken);
extern void dia_custom_call_platform_window_prompt_tools_presenter(
    const void *implementation,
    const void *platformWindow,
    const void *promptToolsController);

static BOOL dia_custom_mod_enabled(const char *modID) {
    const char *raw = getenv("DIA_CUSTOM_MODS");
    if (raw == NULL || raw[0] == '\0') {
        raw = getenv("DIA_CUSTOM_MODULES");
    }
    if (raw == NULL || raw[0] == '\0') {
        NSString *bundled = [NSBundle.mainBundle
            objectForInfoDictionaryKey:@"DiaCustomEnabledMods"];
        raw = [bundled isKindOfClass:[NSString class]]
            ? bundled.UTF8String : NULL;
    }
    if (raw == NULL || raw[0] == '\0') {
        // Clones from before the Dia Mods manifest enabled every integration.
        return YES;
    }
    NSString *wanted = [NSString stringWithUTF8String:modID];
    NSString *value = [NSString stringWithUTF8String:raw];
    for (NSString *candidate in [value componentsSeparatedByString:@","]) {
        candidate = [candidate stringByTrimmingCharactersInSet:
            NSCharacterSet.whitespaceAndNewlineCharacterSet];
        if ([candidate isEqualToString:wanted]) {
            return YES;
        }
    }
    return NO;
}

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

static void dia_custom_set_environment_if_missing(const char *name,
                                                   NSString *value) {
    if (name == NULL || value.length == 0 || getenv(name) != NULL) return;
    setenv(name, value.UTF8String, 1);
}

static BOOL dia_custom_has_process_argument(char **arguments, int count,
                                             const char *prefix) {
    size_t length = strlen(prefix);
    for (int index = 0; index < count; ++index) {
        if (arguments[index] != NULL &&
            strncmp(arguments[index], prefix, length) == 0) return YES;
    }
    return NO;
}

static void dia_custom_install_process_arguments(NSString *profile) {
    int *countPointer = _NSGetArgc();
    char ***argumentsPointer = _NSGetArgv();
    if (countPointer == NULL || argumentsPointer == NULL ||
        *argumentsPointer == NULL || profile.length == 0) return;
    int count = *countPointer;
    char **arguments = *argumentsPointer;
    NSMutableArray<NSString *> *additions = [NSMutableArray array];
    if (!dia_custom_has_process_argument(arguments, count,
            "-customApplicationDataBaseURLPath")) {
        [additions addObject:@"-customApplicationDataBaseURLPath"];
        [additions addObject:profile];
    }
    // Keep Chromium on the custom app's established macOS Keychain key. A
    // mock key invalidates existing encrypted preference hashes and cookies.
    NSArray<NSString *> *singleArguments = @[
        [@"--user-data-dir=" stringByAppendingString:
            [profile stringByAppendingPathComponent:@"User Data"]],
        @"--disable-component-update",
        @"--remote-debugging-port=9223",
        @"--no-first-run",
        @"--disable-sync",
        @"--host-resolver-rules=MAP diabrowser.engineering ~NOTFOUND, MAP *.diabrowser.engineering ~NOTFOUND, MAP diabrowser.com ~NOTFOUND, MAP *.diabrowser.com ~NOTFOUND, MAP thebrowser.company ~NOTFOUND, MAP *.thebrowser.company ~NOTFOUND, MAP thebrowser.com ~NOTFOUND, MAP *.thebrowser.com ~NOTFOUND, MAP browserinternal.com ~NOTFOUND, MAP *.browserinternal.com ~NOTFOUND, MAP browserinternalstaging.com ~NOTFOUND, MAP *.browserinternalstaging.com ~NOTFOUND, MAP api.segment.io ~NOTFOUND, MAP cdn-settings.segment.com ~NOTFOUND, MAP clientstream.launchdarkly.com ~NOTFOUND, MAP mobile.launchdarkly.com ~NOTFOUND, MAP browser-intake-datadoghq.com ~NOTFOUND, MAP browser-intake-ap1-datadoghq.com ~NOTFOUND, MAP browser-intake-datadoghq.eu ~NOTFOUND, MAP browser-intake-us3-datadoghq.com ~NOTFOUND, MAP browser-intake-us5-datadoghq.com ~NOTFOUND, MAP o298668.ingest.us.sentry.io ~NOTFOUND, EXCLUDE localhost",
    ];
    for (NSString *argument in singleArguments) {
        NSString *prefix = [argument componentsSeparatedByString:@"="][0];
        if (!dia_custom_has_process_argument(arguments, count,
                prefix.UTF8String)) [additions addObject:argument];
    }
    if (additions.count == 0) return;
    char **expanded = calloc((size_t)count + additions.count + 1,
                             sizeof(char *));
    if (expanded == NULL) return;
    for (int index = 0; index < count; ++index) expanded[index] = arguments[index];
    for (NSUInteger index = 0; index < additions.count; ++index) {
        expanded[count + (int)index] = strdup(additions[index].UTF8String);
    }
    *countPointer = count + (int)additions.count;
    *argumentsPointer = expanded;
}

static BOOL dia_custom_bridge_health_matches(id value, NSString *runtimeID,
                                               NSString *profile, NSString *mods) {
    if (![value isKindOfClass:[NSDictionary class]] || runtimeID.length == 0 ||
        profile.length == 0 || mods.length == 0) return NO;
    NSDictionary *health = value;
    NSDictionary *catalog = [health[@"catalog"] isKindOfClass:[NSDictionary class]]
        ? health[@"catalog"] : nil;
    if (![health[@"ok"] isEqual:@YES] || ![health[@"coreReady"] isEqual:@YES] ||
        ![catalog[@"modelCount"] isKindOfClass:[NSNumber class]] ||
        [catalog[@"modelCount"] integerValue] <= 0 ||
        ![health[@"runtimeID"] isEqual:runtimeID]) return NO;
    NSString *actualProfile = [health[@"profileDirectory"] isKindOfClass:[NSString class]]
        ? health[@"profileDirectory"] : nil;
    if (actualProfile.length == 0 ||
        ![[actualProfile.stringByStandardizingPath stringByResolvingSymlinksInPath]
            isEqualToString:[profile.stringByStandardizingPath stringByResolvingSymlinksInPath]]) {
        return NO;
    }
    NSArray *actualMods = [health[@"enabledMods"] isKindOfClass:[NSArray class]]
        ? health[@"enabledMods"] : nil;
    if (actualMods == nil) return NO;
    for (id entry in actualMods) {
        if (![entry isKindOfClass:[NSString class]]) return NO;
    }
    NSMutableSet *expectedMods = [NSMutableSet set];
    for (NSString *entry in [mods componentsSeparatedByString:@","]) {
        NSString *identifier = [entry stringByTrimmingCharactersInSet:
            NSCharacterSet.whitespaceAndNewlineCharacterSet];
        if (identifier.length > 0) [expectedMods addObject:identifier];
    }
    return [expectedMods isEqualToSet:[NSSet setWithArray:actualMods]];
}

static BOOL dia_custom_bridge_is_healthy(NSString *runtimeID) {
    int socketDescriptor = socket(AF_INET, SOCK_STREAM, 0);
    if (socketDescriptor < 0) return NO;
    struct timeval timeout = { .tv_sec = 0, .tv_usec = 300000 };
    setsockopt(socketDescriptor, SOL_SOCKET, SO_RCVTIMEO,
               &timeout, sizeof(timeout));
    setsockopt(socketDescriptor, SOL_SOCKET, SO_SNDTIMEO,
               &timeout, sizeof(timeout));
    struct sockaddr_in address = {0};
    address.sin_family = AF_INET;
    address.sin_port = htons(8765);
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    if (connect(socketDescriptor, (struct sockaddr *)&address,
                sizeof(address)) != 0) {
        close(socketDescriptor);
        return NO;
    }
    // HTTP/1.0 keeps the bounded body unchunked, so JSON is parsed exactly once.
    const char *request = "GET /health HTTP/1.0\r\nHost: 127.0.0.1:8765\r\nConnection: close\r\n\r\n";
    if (send(socketDescriptor, request, strlen(request), 0) < 0) {
        close(socketDescriptor);
        return NO;
    }
    char response[65536];
    size_t total = 0;
    ssize_t received = 0;
    while (total + 1 < sizeof(response) &&
           (received = recv(socketDescriptor, response + total,
                            sizeof(response) - total - 1, 0)) > 0) {
        total += (size_t)received;
    }
    close(socketDescriptor);
    response[total] = '\0';
    if (received < 0 || total + 1 >= sizeof(response) ||
        (strncmp(response, "HTTP/1.1 200 ", 13) != 0 &&
         strncmp(response, "HTTP/1.0 200 ", 13) != 0)) return NO;
    char *body = strstr(response, "\r\n\r\n");
    if (body == NULL) return NO;
    body += 4;
    NSData *data = [NSData dataWithBytes:body length:total - (size_t)(body - response)];
    id health = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    const char *profile = getenv("DIA_CUSTOM_PROFILE");
    const char *mods = getenv("DIA_CUSTOM_MODS");
    return dia_custom_bridge_health_matches(health, runtimeID,
        profile != NULL ? [NSString stringWithUTF8String:profile] : nil,
        mods != NULL ? [NSString stringWithUTF8String:mods] : nil);
}

extern char **environ;

static void dia_custom_start_bundled_bridge(NSString *nodePath,
                                            NSString *serverPath,
                                            NSString *pidPath,
                                            NSString *logPath,
                                            NSString *runtimeID) {
    if (dia_custom_bridge_is_healthy(runtimeID)) return;
    NSData *pidData = [NSData dataWithContentsOfFile:pidPath];
    NSString *pidText = pidData != nil
        ? [[[NSString alloc] initWithData:pidData
                                encoding:NSUTF8StringEncoding] autorelease]
        : nil;
    pid_t previousPID = (pid_t)pidText.intValue;
    if (previousPID > 1) {
        char executablePath[PROC_PIDPATHINFO_MAXSIZE] = {0};
        BOOL hasPath = proc_pidpath(previousPID, executablePath,
                                    sizeof(executablePath)) > 0;
        NSString *runningPath = hasPath
            ? [NSString stringWithUTF8String:executablePath] : nil;
        BOOL isRecordedCloneNode = hasPath &&
            [runningPath.lastPathComponent isEqualToString:@"DiaCustomNode"] &&
            ([runningPath containsString:@"/Dia+.app/"] ||
             [runningPath containsString:@"/Dia Custom RTTM.app/"] ||
             [runningPath containsString:@"/Dia Custom RTTM.pre-rebuild."] ||
             [runningPath containsString:@"/Dia Custom RTTM.failed."]);
        if (strcmp(executablePath, nodePath.UTF8String) == 0 ||
            isRecordedCloneNode) {
            kill(previousPID, SIGTERM);
            for (NSUInteger attempt = 0; attempt < 20; ++attempt) {
                if (kill(previousPID, 0) != 0) break;
                usleep(50000);
            }
        }
    }
    posix_spawn_file_actions_t actions;
    posix_spawn_file_actions_init(&actions);
    posix_spawn_file_actions_addopen(&actions, STDOUT_FILENO,
        logPath.fileSystemRepresentation, O_WRONLY | O_CREAT | O_APPEND, 0600);
    posix_spawn_file_actions_addopen(&actions, STDERR_FILENO,
        logPath.fileSystemRepresentation, O_WRONLY | O_CREAT | O_APPEND, 0600);
    char *spawnArguments[] = {
        (char *)nodePath.UTF8String,
        (char *)serverPath.UTF8String,
        NULL,
    };
    pid_t bridgePID = 0;
    int status = posix_spawn(&bridgePID, nodePath.fileSystemRepresentation,
                             &actions, NULL, spawnArguments, environ);
    posix_spawn_file_actions_destroy(&actions);
    if (status != 0 || bridgePID <= 1) {
        dia_custom_log_status(@"bundled-bridge-spawn-failed");
        return;
    }
    for (NSUInteger attempt = 0; attempt < 50; ++attempt) {
        if (dia_custom_bridge_is_healthy(runtimeID)) {
            NSString *newPID = [NSString stringWithFormat:@"%d\n", bridgePID];
            [newPID writeToFile:pidPath atomically:YES
                       encoding:NSUTF8StringEncoding error:nil];
            chmod(pidPath.fileSystemRepresentation, 0600);
            dia_custom_log_status(@"bundled-bridge-ready");
            return;
        }
        usleep(100000);
    }
    kill(bridgePID, SIGTERM);
    dia_custom_log_status(@"bundled-bridge-start-timeout");
}

static NSString *dia_custom_resolved_startup_mods(NSString *state,
                                                   NSString *bridge,
                                                   NSString *fallback) {
    if (state.length == 0 || bridge.length == 0) return fallback;
    NSData *manifestData = [NSData dataWithContentsOfFile:
        [bridge stringByAppendingPathComponent:@"config/dia-mods.json"]];
    NSDictionary *manifest = manifestData != nil
        ? [NSJSONSerialization JSONObjectWithData:manifestData options:0 error:nil]
        : nil;
    NSArray *mods = [manifest[@"mods"] isKindOfClass:[NSArray class]]
        ? manifest[@"mods"] : nil;
    if (mods.count == 0) return fallback;
    NSData *stateData = [NSData dataWithContentsOfFile:
        [state stringByAppendingPathComponent:@"mods.json"]];
    NSDictionary *saved = stateData != nil
        ? [NSJSONSerialization JSONObjectWithData:stateData options:0 error:nil]
        : nil;
    NSDictionary *overrides = [saved[@"overrides"] isKindOfClass:[NSDictionary class]]
        ? saved[@"overrides"] : @{};
    NSData *compatibilityData = [NSData dataWithContentsOfFile:
        [state stringByAppendingPathComponent:@"compatibility.json"]];
    NSDictionary *compatibility = compatibilityData != nil
        ? [NSJSONSerialization JSONObjectWithData:compatibilityData options:0 error:nil]
        : nil;
    NSString *currentBuild = [NSBundle.mainBundle
        objectForInfoDictionaryKey:@"CFBundleVersion"];
    BOOL compatibilityMatches = [compatibility[@"build"] isKindOfClass:[NSString class]] &&
        [compatibility[@"build"] isEqualToString:currentBuild];
    NSMutableSet<NSString *> *unavailable = [NSMutableSet set];
    if (compatibilityMatches && [compatibility[@"perMod"] isKindOfClass:[NSArray class]]) {
        for (NSDictionary *entry in compatibility[@"perMod"]) {
            if (![entry isKindOfClass:[NSDictionary class]] ||
                ![entry[@"compatible"] isEqual:@NO]) continue;
            if ([entry[@"id"] isKindOfClass:[NSString class]]) {
                [unavailable addObject:entry[@"id"]];
            }
        }
    }
    NSMutableArray<NSString *> *enabled = [NSMutableArray array];
    for (NSDictionary *mod in mods) {
        if (![mod isKindOfClass:[NSDictionary class]]) continue;
        NSString *identifier = [mod[@"id"] isKindOfClass:[NSString class]]
            ? mod[@"id"] : nil;
        if (identifier.length == 0) continue;
        NSNumber *override = [overrides[identifier] isKindOfClass:[NSNumber class]]
            ? overrides[identifier] : nil;
        BOOL selected = [mod[@"required"] boolValue] ||
            (override != nil ? override.boolValue
                             : ![mod[@"defaultEnabled"] isEqual:@NO]);
        if (selected && ![mod[@"availability"] isEqual:@"pending-audit"] &&
            ![unavailable containsObject:identifier]) {
            [enabled addObject:identifier];
        }
    }
    return enabled.count > 0 ? [enabled componentsJoinedByString:@","] : fallback;
}

static void dia_custom_prepare_self_contained_runtime(void) {
    NSString *profile = getenv("DIA_CUSTOM_PROFILE") != NULL
        ? [NSString stringWithUTF8String:getenv("DIA_CUSTOM_PROFILE")]
        : [NSHomeDirectory() stringByAppendingPathComponent:
            @"Library/Application Support/Dia Custom RTTM"];
    NSString *state = [profile stringByAppendingPathComponent:@"Bridge/.state"];
    NSString *diagnostics = [profile stringByAppendingPathComponent:@"Diagnostics"];
    NSFileManager *manager = NSFileManager.defaultManager;
    [manager createDirectoryAtPath:state withIntermediateDirectories:YES
                        attributes:@{NSFilePosixPermissions: @0700} error:nil];
    [manager createDirectoryAtPath:diagnostics withIntermediateDirectories:YES
                        attributes:@{NSFilePosixPermissions: @0700} error:nil];
    NSString *bundle = NSBundle.mainBundle.bundlePath;
    NSString *bridge = [bundle stringByAppendingPathComponent:
        @"Contents/Resources/DiaCustomBridge"];
    NSString *node = [bundle stringByAppendingPathComponent:
        @"Contents/Helpers/DiaCustomNode"];
    NSString *runtimeID = [NSBundle.mainBundle
        objectForInfoDictionaryKey:@"DiaCustomBridgeRuntimeID"];
    NSString *mods = [NSBundle.mainBundle
        objectForInfoDictionaryKey:@"DiaCustomEnabledMods"];
    mods = dia_custom_resolved_startup_mods(state, bridge, mods);
    dia_custom_set_environment_if_missing("DIA_CUSTOM_PROFILE", profile);
    dia_custom_set_environment_if_missing("DIA_CUSTOM_STATE_DIR", state);
    // The bridge can derive these files from DIA_CUSTOM_STATE_DIR, but the
    // native AppKit hooks read them directly. Export the same explicit paths
    // used by scripts/launch.sh so a Finder launch behaves identically.
    dia_custom_set_environment_if_missing("DIA_CUSTOM_CONFIG_PATH",
        [state stringByAppendingPathComponent:@"config.json"]);
    dia_custom_set_environment_if_missing("DIA_CUSTOM_MODEL_CATALOG_PATH",
        [state stringByAppendingPathComponent:@"models.json"]);
    dia_custom_set_environment_if_missing("DIA_CUSTOM_TOOL_COVERAGE_PATH",
        [state stringByAppendingPathComponent:@"tool-coverage.json"]);
    dia_custom_set_environment_if_missing("DIA_CUSTOM_MEMORY_PATH",
        [state stringByAppendingPathComponent:@"memory.sqlite3"]);
    dia_custom_set_environment_if_missing("DIA_CUSTOM_MODS", mods);
    dia_custom_set_environment_if_missing("DIA_CUSTOM_MODS_MANIFEST_PATH",
        [bridge stringByAppendingPathComponent:@"config/dia-mods.json"]);
    dia_custom_set_environment_if_missing("DIA_CUSTOM_APPLE_MODEL_HELPER",
        [bundle stringByAppendingPathComponent:@"Contents/Helpers/DiaCustomAppleModel"]);
    dia_custom_set_environment_if_missing("DIA_CUSTOM_CAPTURE_DIR",
        [diagnostics stringByAppendingPathComponent:@"Captures"]);
    dia_custom_set_environment_if_missing("DIA_CUSTOM_RUNTIME_LOG",
        [diagnostics stringByAppendingPathComponent:@"runtime-classes.txt"]);
    dia_custom_set_environment_if_missing("DIA_CUSTOM_NETWORK_LOG",
        [diagnostics stringByAppendingPathComponent:@"network-requests.txt"]);
    dia_custom_set_environment_if_missing("DIA_CUSTOM_SETTINGS_URL",
        @"http://127.0.0.1:8765/settings");
    dia_custom_set_environment_if_missing("DIA_CUSTOM_RUNTIME_ID", runtimeID);
    dia_custom_install_process_arguments(profile);
    dia_custom_log_status(@"self-contained-launch-policy-installed");
    NSString *server = [bridge stringByAppendingPathComponent:@"src/server.js"];
    if (getenv("DIA_CUSTOM_PREFLIGHT") == NULL &&
        [manager isExecutableFileAtPath:node] &&
        [manager fileExistsAtPath:server]) {
        dia_custom_start_bundled_bridge(node, server,
            [state stringByAppendingPathComponent:@"bridge.pid"],
            [state stringByAppendingPathComponent:@"bridge.log"],
            runtimeID);
    }
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

static BOOL dia_custom_set_bool_ivar(id object, const char *name, BOOL value) {
    if (object == nil || name == NULL) return NO;
    Ivar ivar = class_getInstanceVariable(object_getClass(object), name);
    if (ivar == NULL) return NO;
    ptrdiff_t offset = ivar_getOffset(ivar);
    if (offset <= 0 ||
        offset >= (ptrdiff_t)class_getInstanceSize(object_getClass(object))) {
        return NO;
    }
    *((BOOL *)((uint8_t *)(__bridge void *)object + offset)) = value;
    return YES;
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

static NSMenuItem *dia_custom_find_menu_item(NSMenu *menu,
                                              NSArray<NSString *> *titles) {
    for (NSMenuItem *item in menu.itemArray) {
        for (NSString *title in titles) {
            if ([item.title isEqualToString:title]) return item;
        }
        NSMenuItem *nested = item.submenu != nil
            ? dia_custom_find_menu_item(item.submenu, titles) : nil;
        if (nested != nil) return nested;
    }
    return nil;
}

// Dia 1.46's anonymous dependency repeatedly sets both native window items to
// disabled even though the same controller creates windows through AppleScript
// and Tabs -> Move to Window -> New Window. Mark only those two concrete menu
// items, then ignore the false `setEnabled:NO` writes directed at them. Dia's
// original targets, actions, validation side effects, and every other menu
// item's state remain untouched.
typedef void (*DiaCustomSetMenuItemEnabledIMP)(id, SEL, BOOL);
static DiaCustomSetMenuItemEnabledIMP dia_custom_original_set_menu_item_enabled;
static const void *dia_custom_window_menu_item_key =
    &dia_custom_window_menu_item_key;
static BOOL dia_custom_window_menu_enabled_hook_installed = NO;

static void dia_custom_set_menu_item_enabled(id item, SEL selector,
                                              BOOL enabled) {
    if (objc_getAssociatedObject(item, dia_custom_window_menu_item_key) != nil) {
        enabled = YES;
    }
    dia_custom_original_set_menu_item_enabled(item, selector, enabled);
}

static BOOL dia_custom_install_window_menu_enabled_hook(void) {
    if (dia_custom_window_menu_enabled_hook_installed) return YES;
    Method method = class_getInstanceMethod([NSMenuItem class],
                                            @selector(setEnabled:));
    if (method == NULL) return NO;
    dia_custom_original_set_menu_item_enabled =
        (DiaCustomSetMenuItemEnabledIMP)method_getImplementation(method);
    method_setImplementation(method,
                             (IMP)dia_custom_set_menu_item_enabled);
    dia_custom_window_menu_enabled_hook_installed = YES;
    return YES;
}

static NSUInteger dia_custom_mark_window_menu_items(NSMenu *menu) {
    NSUInteger marked = 0;
    for (NSMenuItem *item in menu.itemArray) {
        SEL action = item.action;
        BOOL isNativeWindowItem =
            action == sel_registerName("newWindow:") ||
            action == sel_registerName("newIncognitoWindow:") ||
            [item.title isEqualToString:@"New Window"] ||
            [item.title isEqualToString:@"New Incognito Window"];
        if (isNativeWindowItem) {
            objc_setAssociatedObject(item, dia_custom_window_menu_item_key,
                                     @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
            item.enabled = YES;
            marked += 1;
        }
        if (item.submenu != nil) {
            marked += dia_custom_mark_window_menu_items(item.submenu);
        }
    }
    return marked;
}

typedef NSMenu *(*DiaCustomDockMenuIMP)(id, SEL, NSApplication *);
static const void *dia_custom_dock_menu_original_key =
    &dia_custom_dock_menu_original_key;

static NSMenu *dia_custom_application_dock_menu(id delegate, SEL selector,
                                               NSApplication *application) {
    NSValue *stored = nil;
    for (Class owner = object_getClass(delegate); owner != Nil && stored == nil;
         owner = class_getSuperclass(owner)) {
        stored = objc_getAssociatedObject(owner, dia_custom_dock_menu_original_key);
    }
    DiaCustomDockMenuIMP original = (DiaCustomDockMenuIMP)stored.pointerValue;
    NSMenu *menu = original != NULL ? original(delegate, selector, application) : nil;
    // AppKit asks for fresh Dock menu items independently of NSApp.mainMenu.
    // Mark the returned native items before AppKit validates/serializes them;
    // their original actions, targets and every unrelated item stay intact.
    if (menu != nil) dia_custom_mark_window_menu_items(menu);
    return menu;
}

static BOOL dia_custom_install_dock_menu_hook(void) {
    id delegate = NSApp.delegate;
    if (delegate == nil || !dia_custom_install_window_menu_enabled_hook()) return NO;
    Class owner = object_getClass(delegate);
    SEL selector = @selector(applicationDockMenu:);
    Method method = class_getInstanceMethod(owner, selector);
    if (method == NULL) return NO;
    IMP original = method_getImplementation(method);
    if (original == (IMP)dia_custom_application_dock_menu) return YES;
    objc_setAssociatedObject(owner, dia_custom_dock_menu_original_key,
        [NSValue valueWithPointer:original], OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    // Replacing on the concrete delegate class also handles inherited methods
    // without changing the superclass used by unrelated delegates.
    class_replaceMethod(owner, selector, (IMP)dia_custom_application_dock_menu,
                        method_getTypeEncoding(method));
    return YES;
}

static void dia_custom_schedule_window_menu_repair(NSUInteger attempt) {
    dispatch_async(dispatch_get_main_queue(), ^{
        dia_custom_install_window_menu_enabled_hook();
        BOOL dockReady = dia_custom_install_dock_menu_hook();
        NSUInteger marked = NSApp.mainMenu != nil
            ? dia_custom_mark_window_menu_items(NSApp.mainMenu) : 0;
        if (marked >= 2 && dockReady) {
            dia_custom_log_status(@"native-window-menu-items-and-dock-repaired");
            return;
        }
        if (attempt >= 20) {
            dia_custom_log_status(@"native-window-menu-items-unavailable");
            return;
        }
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW,
                                     250 * NSEC_PER_MSEC),
                       dispatch_get_main_queue(), ^{
            dia_custom_schedule_window_menu_repair(attempt + 1);
        });
    });
}

typedef id (*DiaCustomObjectGetterIMP)(id, SEL);
static DiaCustomObjectGetterIMP dia_custom_arc_import_original_name;
static DiaCustomObjectGetterIMP dia_custom_arc_import_original_app_path;
typedef NSString *(*DiaCustomLocalizedStringIMP)(id, SEL, NSString *,
                                                 NSString *, NSString *);
typedef NSImage *(*DiaCustomImageResourceIMP)(id, SEL, NSString *);
static DiaCustomLocalizedStringIMP dia_custom_original_localized_string;
static DiaCustomImageResourceIMP dia_custom_original_image_resource;

static NSString *dia_custom_import_profile_count_label(void) {
    NSString *path = [NSHomeDirectory() stringByAppendingPathComponent:
        @"Library/Application Support/DiaImport/.dia-custom-import.json"];
    NSData *data = [NSData dataWithContentsOfFile:path];
    NSDictionary *manifest = data != nil
        ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil]
        : nil;
    NSArray *profiles = [manifest[@"profiles"] isKindOfClass:[NSArray class]]
        ? manifest[@"profiles"] : nil;
    if (profiles.count == 1) return @"1 profile";
    if (profiles.count > 1) {
        return [NSString stringWithFormat:@"%lu profiles",
            (unsigned long)profiles.count];
    }
    return @"Profiles";
}

static NSString *dia_custom_localized_string(id bundle, SEL selector,
                                              NSString *key,
                                              NSString *value,
                                              NSString *table) {
    NSString *result = dia_custom_original_localized_string != NULL
        ? dia_custom_original_localized_string(bundle, selector, key, value, table)
        : value;
    NSString *lowerKey = key.lowercaseString;
    if ([result isEqualToString:@"Arc"] ||
        [lowerKey isEqualToString:@"arc"] ||
        [lowerKey containsString:@"import browser item view arc title"]) {
        return @"Dia";
    }
    NSString *lowerResult = result.lowercaseString;
    if ([result isEqualToString:@"Import from Arc"] ||
        [lowerKey isEqualToString:@"import from arc"] ||
        [lowerKey hasPrefix:@"import from %"] ||
        [lowerResult hasPrefix:@"import from %"] ||
        [lowerKey containsString:
            @"onboarding import profiles view title format"]) {
        return @"Import from Dia";
    }
    if ([result isEqualToString:@"Importing from Arc"] ||
        [lowerKey isEqualToString:@"importing from arc"] ||
        [lowerKey hasPrefix:@"importing from %"] ||
        [lowerResult hasPrefix:@"importing from %"] ||
        [lowerKey containsString:
            @"import progress view importing from browser title format"]) {
        return @"Importing from Dia";
    }
    if ([result isEqualToString:
            @"We'll import your Arc spaces, tabs, and folders to Dia."]) {
        return @"We'll import your Dia profiles, bookmarks, history, and extensions.";
    }
    if ([result isEqualToString:@"Select spaces to import"]) {
        return @"Select profiles to import";
    }
    BOOL spacesCountFormat =
        ([lowerKey containsString:@"spaces"] &&
         ([lowerKey containsString:@"%"] ||
          [lowerKey containsString:@"button format"])) ||
        ([lowerResult containsString:@"spaces"] &&
         [lowerResult containsString:@"%"]);
    if (spacesCountFormat) {
        dia_custom_log_status(@"official-dia-import-profile-count-label");
        return dia_custom_import_profile_count_label();
    }
    return result;
}

static NSImage *dia_custom_image_resource(id bundle, SEL selector,
                                           NSString *resourceName) {
    if ([resourceName caseInsensitiveCompare:@"ArcLogo"] == NSOrderedSame) {
        NSImage *icon = [NSWorkspace.sharedWorkspace
            iconForFile:@"/Applications/Dia.app"];
        if (icon != nil) return icon;
    }
    return dia_custom_original_image_resource != NULL
        ? dia_custom_original_image_resource(bundle, selector, resourceName)
        : nil;
}

static void dia_custom_install_dia_import_presentation_override(void) {
    if (!dia_custom_mod_enabled("dia-import") ||
        dia_custom_original_localized_string != NULL) return;
    Class bundleClass = [NSBundle class];
    Method localizedMethod = class_getInstanceMethod(bundleClass,
        @selector(localizedStringForKey:value:table:));
    Method imageMethod = class_getInstanceMethod(bundleClass,
        @selector(imageForResource:));
    if (localizedMethod == NULL || imageMethod == NULL) {
        dia_custom_log_status(@"official-dia-import-presentation-unavailable");
        return;
    }
    dia_custom_original_localized_string = (DiaCustomLocalizedStringIMP)
        method_getImplementation(localizedMethod);
    dia_custom_original_image_resource = (DiaCustomImageResourceIMP)
        method_getImplementation(imageMethod);
    method_setImplementation(localizedMethod,
        (IMP)dia_custom_localized_string);
    method_setImplementation(imageMethod,
        (IMP)dia_custom_image_resource);
    dia_custom_log_status(@"official-dia-import-presentation-installed");
}

static id dia_custom_arc_import_name(id object, SEL selector) {
    return dia_custom_arc_import_original_name != NULL
        ? dia_custom_arc_import_original_name(object, selector) : @"Dia";
}

static id dia_custom_arc_import_app_path(id object, SEL selector) {
    id original = dia_custom_arc_import_original_app_path != NULL
        ? dia_custom_arc_import_original_app_path(object, selector) : nil;
    NSString *path = @"/Applications/Dia.app";
    if ([original isKindOfClass:[NSURL class]]) {
        return [NSURL fileURLWithPath:path];
    }
    return path;
}

static Class dia_custom_find_runtime_class(NSString *suffix) {
    int count = objc_getClassList(NULL, 0);
    if (count <= 0) return Nil;
    Class *classes = calloc((size_t)count, sizeof(Class));
    count = objc_getClassList(classes, count);
    Class match = Nil;
    for (int index = 0; index < count; ++index) {
        NSString *name = NSStringFromClass(classes[index]);
        if ([name isEqualToString:suffix] ||
            [name hasSuffix:[@"." stringByAppendingString:suffix]]) {
            match = classes[index];
            break;
        }
    }
    free(classes);
    return match;
}

static void dia_custom_install_dia_import_source_override(NSUInteger attempt) {
    if (!dia_custom_mod_enabled("dia-import") || attempt >= 30 ||
        dia_custom_arc_import_original_name != NULL) return;
    Class cls = dia_custom_find_runtime_class(@"ArcImportSourceProfile");
    Method nameMethod = cls != Nil
        ? class_getInstanceMethod(cls, @selector(name)) : NULL;
    Method pathMethod = cls != Nil
        ? class_getInstanceMethod(cls, @selector(appPath)) : NULL;
    if (nameMethod != NULL && pathMethod != NULL) {
        dia_custom_arc_import_original_name =
            (DiaCustomObjectGetterIMP)method_getImplementation(nameMethod);
        dia_custom_arc_import_original_app_path =
            (DiaCustomObjectGetterIMP)method_getImplementation(pathMethod);
        if (!class_addMethod(cls, @selector(name),
                (IMP)dia_custom_arc_import_name,
                method_getTypeEncoding(nameMethod))) {
            method_setImplementation(nameMethod, (IMP)dia_custom_arc_import_name);
        }
        if (!class_addMethod(cls, @selector(appPath),
                (IMP)dia_custom_arc_import_app_path,
                method_getTypeEncoding(pathMethod))) {
            method_setImplementation(pathMethod,
                (IMP)dia_custom_arc_import_app_path);
        }
        dia_custom_log_status(@"official-dia-import-source-installed");
        return;
    }
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC),
                   dispatch_get_main_queue(), ^{
        dia_custom_install_dia_import_source_override(attempt + 1);
    });
}

static NSString *dia_custom_import_request_path(void) {
    const char *rawProfile = getenv("DIA_CUSTOM_PROFILE");
    if (rawProfile == NULL || rawProfile[0] == '\0') return nil;
    return [[NSString stringWithUTF8String:rawProfile]
        stringByAppendingPathComponent:@"Bridge/.state/open-dia-import"];
}

static void dia_custom_poll_dia_import_request(void) {
    if (!dia_custom_mod_enabled("dia-import")) return;
    NSString *requestPath = dia_custom_import_request_path();
    if (requestPath != nil &&
        [NSFileManager.defaultManager fileExistsAtPath:requestPath]) {
        NSMenuItem *item = dia_custom_find_menu_item(NSApp.mainMenu, @[
            @"Import from Another Browser",
            @"Import from Another Browser…",
            @"Import from Another Browser...",
            @"Import from another browser",
        ]);
        if (item != nil && item.action != NULL) {
            [NSApp activateIgnoringOtherApps:YES];
            [NSApp sendAction:item.action to:item.target from:item];
            [NSFileManager.defaultManager removeItemAtPath:requestPath error:nil];
            dia_custom_log_status(@"official-dia-native-import-opened");
        }
    }
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC),
                   dispatch_get_main_queue(), ^{
        dia_custom_poll_dia_import_request();
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
static NSDictionary *dia_custom_local_memory_profile_retention_days;

static void dia_custom_set_memory_last_refresh(NSDate *value) {
    if (dia_custom_local_memory_last_refresh == value) {
        return;
    }
    [dia_custom_local_memory_last_refresh release];
    dia_custom_local_memory_last_refresh = [value retain];
}

static void dia_custom_set_profile_retention_days(NSDictionary *value) {
    if (dia_custom_local_memory_profile_retention_days == value) {
        return;
    }
    [dia_custom_local_memory_profile_retention_days release];
    dia_custom_local_memory_profile_retention_days = [value copy];
}

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

// Dia has no extension point for third-party preference panes. The Mod Manager
// therefore adds one guarded sidebar item to the existing Settings split view
// and presents its loopback-only configuration surface inside that same window.
// Native panes and their controllers remain untouched.
typedef NSInteger (*DiaCustomNumberOfRowsIMP)(id, SEL, NSTableView *);
typedef NSView *(*DiaCustomViewForRowIMP)(id, SEL, NSTableView *,
                                         NSTableColumn *, NSInteger);
typedef void (*DiaCustomSelectionChangedIMP)(id, SEL, NSNotification *);
static DiaCustomNumberOfRowsIMP dia_custom_mods_original_number_of_rows;
static DiaCustomViewForRowIMP dia_custom_mods_original_view_for_row;
static DiaCustomSelectionChangedIMP dia_custom_mods_original_selection_changed;
static Class dia_custom_mods_data_source_class;
static Class dia_custom_mods_delegate_class;
static BOOL dia_custom_mods_table_hooks_installed = NO;

static const void *dia_custom_mods_window_context_key =
    &dia_custom_mods_window_context_key;
static const void *dia_custom_mods_table_context_key =
    &dia_custom_mods_table_context_key;
static id dia_custom_mods_window_close_observer;

@interface DiaCustomModsPaneContext : NSObject <WKUIDelegate> {
@public
    NSWindow *settingsWindow;
    NSView *contentHost;
    NSTableView *nativeTable;
    WKWebView *contentView;
    NSString *previousWindowTitle;
    NSTextField *toolbarTitle;
    NSAttributedString *previousToolbarTitle;
    id dataSource;
    id delegate;
    BOOL reloadingTable;
}
@end

static void dia_custom_install_mods_window_close_observer(void) {
    if (dia_custom_mods_window_close_observer != nil) return;
    dia_custom_mods_window_close_observer = [[NSNotificationCenter.defaultCenter
        addObserverForName:NSWindowWillCloseNotification
                    object:nil
                     queue:NSOperationQueue.mainQueue
                usingBlock:^(NSNotification *notification) {
        NSWindow *window = [notification.object isKindOfClass:[NSWindow class]]
            ? notification.object : nil;
        if (window == nil) return;
        DiaCustomModsPaneContext *context = objc_getAssociatedObject(
            window, dia_custom_mods_window_context_key);
        if (context == nil) return;
        // A native Settings controller can retain its table delegate. Detach
        // our per-window context while the window graph is still valid so no
        // stale title, table, host, or WebView survives a closed window.
        context->settingsWindow = nil;
        objc_setAssociatedObject(window,
                                 dia_custom_mods_window_context_key,
                                 nil,
                                 OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        dia_custom_log_status(@"mod-manager-window-context-cleared");
    }] retain];
}

@implementation DiaCustomModsPaneContext
- (void)webView:(WKWebView *)webView
    runJavaScriptConfirmPanelWithMessage:(NSString *)message
    initiatedByFrame:(WKFrameInfo *)frame
    completionHandler:(void (^)(BOOL))completionHandler {
    WKSecurityOrigin *origin = frame.securityOrigin;
    BOOL local = [origin.protocol isEqualToString:@"http"] &&
        ([origin.host isEqualToString:@"127.0.0.1"] ||
         [origin.host isEqualToString:@"localhost"]) &&
        origin.port == webView.URL.port.integerValue;
    if (!local || settingsWindow == nil) {
        completionHandler(NO);
        return;
    }
    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = @"Confirm Dia+ action";
    alert.informativeText = message ?: @"";
    [alert addButtonWithTitle:@"Continue"];
    [alert addButtonWithTitle:@"Cancel"];
    [alert beginSheetModalForWindow:settingsWindow
        completionHandler:^(NSModalResponse response) {
        completionHandler(response == NSAlertFirstButtonReturn);
        [alert release];
    }];
}
- (WKWebView *)webView:(WKWebView *)webView
    createWebViewWithConfiguration:(WKWebViewConfiguration *)configuration
    forNavigationAction:(WKNavigationAction *)navigationAction
    windowFeatures:(WKWindowFeatures *)windowFeatures {
    (void)webView; (void)configuration; (void)windowFeatures;
    NSURL *url = navigationAction.request.URL;
    // Only an explicit click on the fixed public device-authorization page can
    // leave Settings. Never navigate this privileged WebView to GitHub/login.
    if (navigationAction.navigationType == WKNavigationTypeLinkActivated &&
        navigationAction.targetFrame == nil &&
        [url.absoluteString isEqualToString:@"https://github.com/login/device"]) {
        [NSWorkspace.sharedWorkspace openURL:url];
    }
    return nil;
}
- (void)dealloc {
    if (nativeTable != nil &&
        objc_getAssociatedObject(nativeTable,
                                 dia_custom_mods_table_context_key) == self) {
        objc_setAssociatedObject(nativeTable,
                                 dia_custom_mods_table_context_key,
                                 nil,
                                 OBJC_ASSOCIATION_ASSIGN);
    }
    [contentHost release];
    [nativeTable release];
    contentView.UIDelegate = nil;
    [contentView release];
    [previousWindowTitle release];
    [toolbarTitle release];
    [previousToolbarTitle release];
    [dataSource release];
    [delegate release];
    [super dealloc];
}
@end

static DiaCustomModsPaneContext *dia_custom_mods_context_for_table(
    NSTableView *table) {
    if (table == nil) return nil;
    id context = objc_getAssociatedObject(
        table, dia_custom_mods_table_context_key);
    return [context isKindOfClass:[DiaCustomModsPaneContext class]]
        ? context : nil;
}

static DiaCustomModsPaneContext *dia_custom_mods_context_for_window(
    NSWindow *window,
    BOOL create) {
    if (window == nil) return nil;
    DiaCustomModsPaneContext *context = objc_getAssociatedObject(
        window, dia_custom_mods_window_context_key);
    if (context == nil && create) {
        context = [[[DiaCustomModsPaneContext alloc] init] autorelease];
        context->settingsWindow = window;
        objc_setAssociatedObject(window,
                                 dia_custom_mods_window_context_key,
                                 context,
                                 OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    }
    return context;
}

static void dia_custom_set_mods_table_objects(
    DiaCustomModsPaneContext *context,
    NSTableView *table,
    id nextDataSource,
    id nextDelegate) {
    if (context == nil) return;
    if (context->nativeTable != table) {
        if (context->nativeTable != nil &&
            objc_getAssociatedObject(context->nativeTable,
                                     dia_custom_mods_table_context_key) ==
                context) {
            objc_setAssociatedObject(context->nativeTable,
                                     dia_custom_mods_table_context_key,
                                     nil,
                                     OBJC_ASSOCIATION_ASSIGN);
        }
        [context->nativeTable release];
        context->nativeTable = [table retain];
        if (table != nil) {
            objc_setAssociatedObject(table,
                                     dia_custom_mods_table_context_key,
                                     context,
                                     OBJC_ASSOCIATION_ASSIGN);
        }
    }
    if (context->dataSource != nextDataSource) {
        [context->dataSource release];
        context->dataSource = [nextDataSource retain];
    }
    if (context->delegate != nextDelegate) {
        [context->delegate release];
        context->delegate = [nextDelegate retain];
    }
}

static NSTableView *dia_custom_find_settings_table(NSView *view) {
    if ([view isKindOfClass:[NSTableView class]] &&
        [(NSTableView *)view numberOfRows] >= 5) {
        return (NSTableView *)view;
    }
    for (NSView *child in view.subviews) {
        NSTableView *table = dia_custom_find_settings_table(child);
        if (table != nil) return table;
    }
    return nil;
}

static NSSplitView *dia_custom_settings_split_for_table(NSTableView *table) {
    for (NSView *view = table; view != nil; view = view.superview) {
        if ([view isKindOfClass:[NSSplitView class]] &&
            view.subviews.count >= 2) {
            return (NSSplitView *)view;
        }
    }
    return nil;
}

static NSView *dia_custom_direct_child(NSView *view, NSView *ancestor) {
    NSView *candidate = view;
    while (candidate.superview != nil && candidate.superview != ancestor) {
        candidate = candidate.superview;
    }
    return candidate.superview == ancestor ? candidate : nil;
}

static BOOL dia_custom_is_settings_window(NSWindow *window) {
    NSString *identifier = window.identifier;
    return [identifier isEqualToString:@"preferencesWindow"] ||
        dia_custom_find_settings_table(window.contentView) != nil;
}

static NSTextField *dia_custom_find_toolbar_title(NSView *view) {
    if ([view isKindOfClass:[NSTextField class]] &&
        [(NSTextField *)view stringValue].length > 0) {
        return (NSTextField *)view;
    }
    for (NSView *child in view.subviews) {
        NSTextField *label = dia_custom_find_toolbar_title(child);
        if (label != nil) return label;
    }
    return nil;
}

static void dia_custom_set_mods_toolbar_title(
    DiaCustomModsPaneContext *context,
    NSString *title) {
    if (context == nil || context->settingsWindow == nil) return;
    if (context->toolbarTitle == nil) {
        for (NSToolbarItem *item in context->settingsWindow.toolbar.items) {
            NSTextField *label = dia_custom_find_toolbar_title(item.view);
            if (label != nil) {
                context->toolbarTitle = [label retain];
                break;
            }
        }
    }
    if (context->toolbarTitle != nil) {
        if (context->previousToolbarTitle == nil) {
            context->previousToolbarTitle =
                [context->toolbarTitle.attributedStringValue copy];
        }
        context->toolbarTitle.stringValue = title;
    }
}

static NSInteger dia_custom_native_settings_row_count(
    DiaCustomModsPaneContext *context) {
    if (dia_custom_mods_original_number_of_rows == NULL ||
        context == nil || context->dataSource == nil ||
        context->nativeTable == nil) return NSNotFound;
    return dia_custom_mods_original_number_of_rows(
        context->dataSource,
        @selector(numberOfRowsInTableView:),
        context->nativeTable);
}

static NSColor *dia_custom_native_sidebar_icon_tint(
    DiaCustomModsPaneContext *context) {
    NSInteger nativeRows = dia_custom_native_settings_row_count(context);
    if (nativeRows == NSNotFound || nativeRows <= 0) return nil;
    NSInteger referenceRow = context->nativeTable.selectedRow == 0 &&
        nativeRows > 1 ? 1 : 0;
    NSTableCellView *reference = (NSTableCellView *)[context->nativeTable
        viewAtColumn:0 row:referenceRow makeIfNecessary:NO];
    return reference.imageView.contentTintColor;
}

static void dia_custom_set_mods_sidebar_selected(
    DiaCustomModsPaneContext *context,
    BOOL selected) {
    NSInteger rowIndex = dia_custom_native_settings_row_count(context);
    if (rowIndex == NSNotFound) return;
    NSTableRowView *row = [context->nativeTable
        rowViewAtRow:rowIndex makeIfNecessary:NO];
    row.emphasized = selected;
    NSView *cell = [context->nativeTable
        viewAtColumn:0 row:rowIndex makeIfNecessary:NO];
    for (NSView *child in cell.subviews) {
        if ([child isKindOfClass:[NSTextField class]]) {
            [(NSTextField *)child setTextColor:selected
                ? NSColor.whiteColor : NSColor.labelColor];
        } else if ([child isKindOfClass:[NSImageView class]]) {
            [(NSImageView *)child setContentTintColor:
                (selected ? NSColor.whiteColor :
                    dia_custom_native_sidebar_icon_tint(context))];
        }
    }
}

static void dia_custom_hide_mods_pane(
    DiaCustomModsPaneContext *context) {
    if (context == nil) return;
    if (context->contentView != nil) {
        context->contentView.hidden = YES;
    }
    dia_custom_set_mods_sidebar_selected(context, NO);
    if (context->settingsWindow != nil &&
        context->previousWindowTitle != nil) {
        context->settingsWindow.title = context->previousWindowTitle;
    }
    if (context->toolbarTitle != nil &&
        context->previousToolbarTitle != nil) {
        context->toolbarTitle.attributedStringValue =
            context->previousToolbarTitle;
    }
}

static void dia_custom_show_mods_pane(
    DiaCustomModsPaneContext *context) {
    if (context == nil || context->settingsWindow == nil ||
        context->contentHost == nil) return;
    BOOL wasVisible = context->contentView != nil &&
        !context->contentView.hidden;
    if (!wasVisible) {
        [context->previousWindowTitle release];
        context->previousWindowTitle =
            [context->settingsWindow.title copy];
        [context->previousToolbarTitle release];
        context->previousToolbarTitle = nil;
    }
    if (context->contentView == nil ||
        context->contentView.superview != context->contentHost) {
        [context->contentView removeFromSuperview];
        [context->contentView release];
        WKWebViewConfiguration *configuration =
            [[WKWebViewConfiguration alloc] init];
        context->contentView = [[WKWebView alloc]
            initWithFrame:context->contentHost.bounds
            configuration:configuration];
        [configuration release];
        context->contentView.autoresizingMask =
            NSViewWidthSizable | NSViewHeightSizable;
        context->contentView.accessibilityLabel = @"Dia Mods";
        context->contentView.UIDelegate = context;
        [context->contentHost addSubview:context->contentView
                              positioned:NSWindowAbove
                              relativeTo:nil];
    }
    context->contentView.frame = context->contentHost.bounds;
    context->contentView.hidden = NO;
    NSURL *url = dia_custom_local_api_url(@"/mods");
    if (url != nil) {
        NSURLRequest *request = [NSURLRequest
            requestWithURL:url
               cachePolicy:NSURLRequestReloadIgnoringLocalCacheData
           timeoutInterval:10.0];
        [context->contentView loadRequest:request];
    }
    context->settingsWindow.title = @"Mods";
    dia_custom_set_mods_toolbar_title(context, @"Mods");
    dia_custom_set_mods_sidebar_selected(context, YES);
    dia_custom_log_status(@"mod-manager-pane-presented");
}

static NSInteger dia_custom_mods_number_of_rows(id dataSource, SEL selector,
                                                 NSTableView *table) {
    NSInteger count = dia_custom_mods_original_number_of_rows != NULL
        ? dia_custom_mods_original_number_of_rows(dataSource, selector, table)
        : 0;
    DiaCustomModsPaneContext *context =
        dia_custom_mods_context_for_table(table);
    return context != nil && table == context->nativeTable
        ? count + 1 : count;
}

static NSView *dia_custom_mods_sidebar_cell(NSTableView *table) {
    NSUserInterfaceItemIdentifier identifier = @"DiaCustomModsCell";
    NSTableCellView *cell = [table makeViewWithIdentifier:identifier owner:nil];
    if (cell != nil) return cell;
    NSTableCellView *nativeCell = (NSTableCellView *)[table
        viewAtColumn:0 row:0 makeIfNecessary:NO];
    NSRect nativeFrame = nativeCell != nil
        ? nativeCell.frame : NSMakeRect(0, 0, 180, 28);
    cell = [[[NSTableCellView alloc] initWithFrame:nativeFrame]
        autorelease];
    cell.identifier = identifier;
    cell.accessibilityLabel = @"Mods";
    NSImageView *icon = [[[NSImageView alloc] initWithFrame:NSZeroRect] autorelease];
    if ([NSImage respondsToSelector:
            @selector(imageWithSystemSymbolName:accessibilityDescription:)]) {
        NSImage *image = [NSImage imageWithSystemSymbolName:@"puzzlepiece.extension"
                                  accessibilityDescription:@"Mods"];
        image.template = YES;
        icon.image = image;
    }
    // A nil tint is meaningful here: native sidebar cells let AppKit resolve
    // their template-image color from the table's active/unselected state.
    // Copying the native value avoids double-dimming the SF Symbol.
    icon.contentTintColor = nativeCell.imageView.contentTintColor;
    icon.frame = nativeCell.imageView != nil
        ? nativeCell.imageView.frame : NSMakeRect(5, 6, 16, 16);
    icon.autoresizingMask = NSViewMaxXMargin;
    NSTextField *label = [NSTextField labelWithString:@"Mods"];
    label.font = nativeCell.textField.font ?:
        [NSFont systemFontOfSize:13.0 weight:NSFontWeightMedium];
    label.frame = nativeCell.textField != nil
        ? nativeCell.textField.frame : NSMakeRect(33, 5, 135, 18);
    label.autoresizingMask = NSViewWidthSizable;
    cell.imageView = icon;
    cell.textField = label;
    [cell addSubview:icon];
    [cell addSubview:label];
    return cell;
}

static NSView *dia_custom_mods_view_for_row(id delegate, SEL selector,
                                             NSTableView *table,
                                             NSTableColumn *column,
                                             NSInteger row) {
    DiaCustomModsPaneContext *context =
        dia_custom_mods_context_for_table(table);
    NSInteger nativeRows = context != nil && table == context->nativeTable
        ? dia_custom_native_settings_row_count(context) : NSNotFound;
    if (nativeRows != NSNotFound && row == nativeRows) {
        return dia_custom_mods_sidebar_cell(table);
    }
    return dia_custom_mods_original_view_for_row != NULL
        ? dia_custom_mods_original_view_for_row(
            delegate, selector, table, column, row)
        : nil;
}

static void dia_custom_mods_selection_changed(id delegate, SEL selector,
                                               NSNotification *notification) {
    NSTableView *table = [notification.object isKindOfClass:[NSTableView class]]
        ? notification.object : nil;
    DiaCustomModsPaneContext *context =
        dia_custom_mods_context_for_table(table);
    if (context != nil && context->reloadingTable) {
        if (dia_custom_mods_original_selection_changed != NULL) {
            dia_custom_mods_original_selection_changed(
                delegate, selector, notification);
        }
        return;
    }
    NSInteger modsRow = context != nil && table == context->nativeTable
        ? dia_custom_native_settings_row_count(context) : NSNotFound;
    if (modsRow != NSNotFound && table.selectedRow == modsRow) {
        dia_custom_show_mods_pane(context);
        return;
    }
    if (context != nil && table == context->nativeTable &&
        context->contentView != nil &&
        !context->contentView.hidden) {
        dia_custom_hide_mods_pane(context);
    }
    if (dia_custom_mods_original_selection_changed != NULL) {
        dia_custom_mods_original_selection_changed(
            delegate, selector, notification);
    }
}

static BOOL dia_custom_install_mods_table_hooks(
    DiaCustomModsPaneContext *context,
    NSTableView *table) {
    id dataSource = table.dataSource;
    id delegate = table.delegate;
    Class dataSourceClass = object_getClass(dataSource);
    Class delegateClass = object_getClass(delegate);
    if (dia_custom_mods_table_hooks_installed) {
        if (dataSourceClass != dia_custom_mods_data_source_class ||
            delegateClass != dia_custom_mods_delegate_class) {
            dia_custom_log_status(
                @"mod-manager-disabled-incompatible-recreated-sidebar");
            return NO;
        }
        // Settings windows are destroyed and recreated. The method hooks live
        // on their shared classes, while these receiver objects do not.
        dia_custom_set_mods_table_objects(
            context, table, dataSource, delegate);
        return YES;
    }
    SEL countSelector = @selector(numberOfRowsInTableView:);
    SEL viewSelector = @selector(tableView:viewForTableColumn:row:);
    SEL selectionSelector = @selector(tableViewSelectionDidChange:);
    Method countMethod = class_getInstanceMethod(
        object_getClass(dataSource), countSelector);
    Method viewMethod = class_getInstanceMethod(
        object_getClass(delegate), viewSelector);
    Method selectionMethod = class_getInstanceMethod(
        object_getClass(delegate), selectionSelector);
    if (dataSource == nil || delegate == nil || countMethod == NULL ||
        viewMethod == NULL || selectionMethod == NULL) {
        dia_custom_log_status(@"mod-manager-disabled-incompatible-sidebar");
        return NO;
    }
    dia_custom_mods_original_number_of_rows =
        (DiaCustomNumberOfRowsIMP)method_getImplementation(countMethod);
    dia_custom_mods_original_view_for_row =
        (DiaCustomViewForRowIMP)method_getImplementation(viewMethod);
    dia_custom_mods_original_selection_changed =
        (DiaCustomSelectionChangedIMP)method_getImplementation(selectionMethod);
    const char *countTypes = method_getTypeEncoding(countMethod);
    const char *viewTypes = method_getTypeEncoding(viewMethod);
    const char *selectionTypes = method_getTypeEncoding(selectionMethod);
    if (!class_addMethod(dataSourceClass, countSelector,
            (IMP)dia_custom_mods_number_of_rows, countTypes)) {
        method_setImplementation(countMethod,
            (IMP)dia_custom_mods_number_of_rows);
    }
    if (!class_addMethod(delegateClass, viewSelector,
            (IMP)dia_custom_mods_view_for_row, viewTypes)) {
        method_setImplementation(viewMethod,
            (IMP)dia_custom_mods_view_for_row);
    }
    if (!class_addMethod(delegateClass, selectionSelector,
            (IMP)dia_custom_mods_selection_changed, selectionTypes)) {
        method_setImplementation(selectionMethod,
            (IMP)dia_custom_mods_selection_changed);
    }
    dia_custom_mods_data_source_class = dataSourceClass;
    dia_custom_mods_delegate_class = delegateClass;
    dia_custom_set_mods_table_objects(
        context, table, dataSource, delegate);
    dia_custom_mods_table_hooks_installed = YES;
    return YES;
}

static void dia_custom_install_mod_manager(id target) {
    if (!dia_custom_mod_enabled("mod-manager") || target == nil) return;
    dia_custom_install_mods_window_close_observer();
    for (NSWindow *window in NSApp.windows) {
        if (!dia_custom_is_settings_window(window)) continue;
        NSTableView *table = dia_custom_find_settings_table(window.contentView);
        NSSplitView *split = dia_custom_settings_split_for_table(table);
        NSView *sidebar = dia_custom_direct_child(table, split);
        DiaCustomModsPaneContext *context =
            dia_custom_mods_context_for_window(window, YES);
        BOOL tableChanged = context->nativeTable != table;
        if (table == nil || split == nil || sidebar == nil ||
            !dia_custom_install_mods_table_hooks(context, table)) continue;
        NSView *content = nil;
        for (NSView *candidate in split.subviews) {
            if (candidate != sidebar) {
                content = candidate;
                break;
            }
        }
        if (content == nil) continue;
        context->settingsWindow = window;
        if (context->contentHost != content) {
            [context->contentHost release];
            context->contentHost = [content retain];
        }
        if (tableChanged) {
            context->reloadingTable = YES;
            [table reloadData];
            context->reloadingTable = NO;
        }
        dia_custom_log_status(@"mod-manager-tab-installed");
    }
}

static DiaCustomModsPaneContext *dia_custom_active_mods_context(void) {
    NSWindow *keyWindow = NSApp.keyWindow;
    if (dia_custom_is_settings_window(keyWindow)) {
        DiaCustomModsPaneContext *context =
            dia_custom_mods_context_for_window(keyWindow, NO);
        if (context != nil) return context;
    }
    for (NSWindow *window in NSApp.windows) {
        if (!dia_custom_is_settings_window(window)) continue;
        DiaCustomModsPaneContext *context =
            dia_custom_mods_context_for_window(window, NO);
        if (context != nil) return context;
    }
    return nil;
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

static NSInteger dia_custom_memory_retention_from_title(NSString *title) {
    if (title.length == 0) {
        return NSNotFound;
    }
    NSString *lower = [title lowercaseString];
    if ([lower containsString:@"forever"] ||
        [lower containsString:@"never delete"]) {
        return 0;
    }
    NSScanner *scanner = [NSScanner scannerWithString:title];
    NSInteger days = 0;
    if ([scanner scanInteger:&days] && days > 0) {
        return days;
    }
    return NSNotFound;
}

static void dia_custom_collect_short_text_labels(NSView *view,
                                                 NSMutableArray *labels) {
    if ([view isKindOfClass:[NSTextField class]]) {
        NSString *value = [(NSTextField *)view stringValue];
        if (value.length > 0 && value.length <= 120) {
            [labels addObject:value];
        }
    }
    for (NSView *child in view.subviews) {
        dia_custom_collect_short_text_labels(child, labels);
    }
}

static NSString *dia_custom_profile_id_for_memory_popup(NSPopUpButton *popup) {
    NSString *profileName = nil;
    NSView *candidate = popup.superview;
    for (NSUInteger depth = 0; candidate != nil && depth < 5;
         ++depth, candidate = candidate.superview) {
        NSMutableArray<NSString *> *labels = [NSMutableArray array];
        dia_custom_collect_short_text_labels(candidate, labels);
        for (NSString *label in labels) {
            NSString *lower = label.lowercaseString;
            if (![lower containsString:@"profile settings"] &&
                ![lower containsString:@"save browsing"] &&
                ![lower containsString:@"dia will remember"] &&
                ![lower containsString:@"learn more"] &&
                ![lower containsString:@"memory"]) {
                profileName = label;
                break;
            }
        }
        if (profileName != nil) {
            break;
        }
    }

    const char *rawProfile = getenv("DIA_CUSTOM_PROFILE");
    if (rawProfile == NULL || rawProfile[0] == '\0') {
        return @"Default";
    }
    NSString *base = [NSString stringWithUTF8String:rawProfile];
    NSString *localStatePath = [base stringByAppendingPathComponent:
        @"User Data/Local State"];
    NSData *data = [NSData dataWithContentsOfFile:localStatePath];
    NSDictionary *root = data != nil
        ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil]
        : nil;
    NSDictionary *profile = [root[@"profile"] isKindOfClass:[NSDictionary class]]
        ? root[@"profile"] : nil;
    NSDictionary *cache = [profile[@"info_cache"] isKindOfClass:[NSDictionary class]]
        ? profile[@"info_cache"] : nil;
    if (profileName != nil) {
        for (NSString *profileID in cache) {
            NSDictionary *record = [cache[profileID]
                isKindOfClass:[NSDictionary class]] ? cache[profileID] : nil;
            if ([record[@"name"] isEqualToString:profileName]) {
                return profileID;
            }
        }
    }
    return @"Default";
}

static NSInteger dia_custom_memory_retention_days_for_popup(
    NSPopUpButton *popup) {
    NSString *profileID = dia_custom_profile_id_for_memory_popup(popup);
    NSNumber *profileDays = [dia_custom_local_memory_profile_retention_days[profileID]
        respondsToSelector:@selector(integerValue)]
        ? dia_custom_local_memory_profile_retention_days[profileID] : nil;
    return profileDays != nil
        ? profileDays.integerValue
        : dia_custom_local_memory_retention_days;
}

// Preserve Dia's own items and menu styling.  We only select the item that
// mirrors the localhost setting and redirect its existing action.
static void dia_custom_populate_retention_popup(NSPopUpButton *popup) {
    if (popup == nil) {
        return;
    }
    NSString *wanted = dia_custom_memory_retention_title(
        dia_custom_memory_retention_days_for_popup(popup));
    if ([popup itemWithTitle:wanted] != nil) {
        [popup selectItemWithTitle:wanted];
    }
}

extern BOOL dia_custom_swift_set_native_memory_enabled(
    const void *viewModel,
    BOOL enabled);
extern BOOL dia_custom_swift_enable_advanced_new_tab_surface(
    const void *viewController);

static BOOL dia_custom_is_native_memory_content_view(NSView *view) {
    NSString *className = NSStringFromClass([view class]);
    return [className containsString:@"MemoryPreferencePaneContentView"];
}

static void dia_custom_rewrite_native_memory_copy(NSView *view) {
    if (![view isKindOfClass:[NSTextField class]]) {
        return;
    }
    NSTextField *label = (NSTextField *)view;
    NSAttributedString *value = label.attributedStringValue;
    NSString *text = value.string;
    NSRange serverRange = [text rangeOfString:@"summarized on our servers"
                                      options:NSCaseInsensitiveSearch];
    if (serverRange.location == NSNotFound) {
        return;
    }
    NSMutableAttributedString *localValue = [value mutableCopy];
    [localValue replaceCharactersInRange:serverRange
                              withString:@"summarized using your selected model"];
    label.attributedStringValue = localValue;
}

static void dia_custom_configure_native_memory_descendants(
    NSView *view,
    id target) {
    if ([view isKindOfClass:[NSPopUpButton class]]) {
        NSPopUpButton *popup = (NSPopUpButton *)view;
        popup.target = target;
        popup.action = NSSelectorFromString(@"setLocalMemoryRetention:");
        popup.toolTip =
            @"Choose how long Dia+ keeps local browsing activity";
        dia_custom_populate_retention_popup(popup);
    } else if ([view isKindOfClass:[NSButton class]]) {
        NSButton *button = (NSButton *)view;
        NSString *title = button.title;
        if ([title isEqualToString:@"Enable Memory"] ||
            [title isEqualToString:@"Disable Memory"]) {
            button.target = target;
            button.action = NSSelectorFromString(@"toggleLocalMemory:");
            button.enabled = dia_custom_local_memory_state == 0 ||
                dia_custom_local_memory_state == 1;
        } else if ([title hasPrefix:@"Reset Memory"]) {
            button.target = target;
            button.action = NSSelectorFromString(@"resetLocalMemory:");
            button.enabled = dia_custom_local_memory_state != -2;
        }
    } else {
        dia_custom_rewrite_native_memory_copy(view);
    }
    for (NSView *child in view.subviews) {
        dia_custom_configure_native_memory_descendants(child, target);
    }
}

static id dia_custom_new_tab_controller_for_view(NSView *view) {
    NSResponder *responder = view.nextResponder;
    NSUInteger remaining = 8;
    while (responder != nil && remaining-- > 0) {
        NSString *className = NSStringFromClass([responder class]);
        if ([className containsString:@"NewTabPageViewController"]) {
            return responder;
        }
        responder = responder.nextResponder;
    }
    return nil;
}

static BOOL dia_custom_apply_advanced_new_tab_surface(NSView *view) {
    if (view == nil) {
        return NO;
    }
    BOOL found = NO;
    id controller = dia_custom_new_tab_controller_for_view(view);
    if (controller != nil &&
        [controller respondsToSelector:@selector(view)] &&
        [controller view] == view) {
        found = YES;
        BOOL applied = dia_custom_swift_enable_advanced_new_tab_surface(
            (__bridge const void *)controller);
        dia_custom_log_status(applied
            ? @"advanced-new-tab-state-applied"
            : @"advanced-new-tab-state-rejected");
    }
    for (NSView *child in view.subviews) {
        found = dia_custom_apply_advanced_new_tab_surface(child) || found;
    }
    return found;
}

static void dia_custom_refresh_advanced_new_tab_surface(void) {
    if (!dia_custom_mod_enabled("native-apps")) {
        return;
    }
    for (NSWindow *window in NSApp.windows) {
        dia_custom_apply_advanced_new_tab_surface(window.contentView);
    }
}

static BOOL dia_custom_apply_native_memory_state_in_view(
    NSView *view,
    id target) {
    if (view == nil) {
        return NO;
    }
    BOOL found = NO;
    if (dia_custom_is_native_memory_content_view(view)) {
        found = YES;
        id viewModel = dia_custom_object_ivar(view, "viewModel");
        if (viewModel != nil &&
            (dia_custom_local_memory_state == 0 ||
             dia_custom_local_memory_state == 1)) {
            BOOL applied = dia_custom_swift_set_native_memory_enabled(
                (__bridge const void *)viewModel,
                dia_custom_local_memory_state == 1);
            dia_custom_log_status(applied
                ? @"native-memory-state-applied"
                : @"native-memory-state-rejected");
        }
        dia_custom_configure_native_memory_descendants(view, target);
    }
    for (NSView *child in view.subviews) {
        found = dia_custom_apply_native_memory_state_in_view(
            child, target) || found;
    }
    return found;
}

static BOOL dia_custom_refresh_memory_controls(id target, SEL action) {
    (void)action;
    BOOL found = NO;
    for (NSWindow *window in NSApp.windows) {
        found = dia_custom_apply_native_memory_state_in_view(
            window.contentView, target) || found;
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
        dia_custom_refresh_memory_controls(target, action);
        return;
    }
    NSURL *url = dia_custom_local_api_url(@"/api/memory/enabled");
    if (url == nil) {
        dia_custom_local_memory_state = -2;
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
                dia_custom_set_memory_last_refresh([NSDate date]);
                if (error == nil && status >= 200 && status < 300 &&
                    [value[@"enabled"] respondsToSelector:@selector(boolValue)]) {
                    dia_custom_local_memory_state = [value[@"enabled"] boolValue]
                        ? 1 : 0;
                    if ([value[@"retentionDays"] respondsToSelector:
                        @selector(integerValue)]) {
                        dia_custom_local_memory_retention_days =
                            [value[@"retentionDays"] integerValue];
                    }
                    if ([value[@"profileRetentionDays"]
                        isKindOfClass:[NSDictionary class]]) {
                        dia_custom_set_profile_retention_days(
                            value[@"profileRetentionDays"]);
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
    if (!dia_custom_mod_enabled("native-memory")) {
        return;
    }
    BOOL found = dia_custom_refresh_memory_controls(target, action);
    // Local Memory is bridge-owned. A removed/hidden native settings pane must
    // neither disable it nor cause native-state work or background UI polling.
    if (!found) return;
    // The first visible pane fetches immediately because its refresh date is
    // nil. Subsequent window updates use the five-second ceiling; mutations
    // still force refresh. Dia+ web settings work without this mirror.
    dia_custom_fetch_local_memory_state(target, action, NO);
}

// Apps is a native Dia pane. This cache changes the pane's shipped state value
// and retargets only its existing Advanced Chat and Morning Brief buttons.
// Connector rows and callbacks remain owned by Dia's browser-local clients.
static NSDictionary *dia_custom_local_apps_state;
static NSMutableDictionary *dia_custom_local_apps_states_by_profile;
static NSDate *dia_custom_local_apps_last_refresh;
static BOOL dia_custom_local_apps_request_in_flight = NO;
static BOOL dia_custom_local_apps_refresh_pending = NO;
static NSString *dia_custom_local_apps_request_profile_id;
static BOOL dia_custom_local_apps_compatible = YES;
static NSString *dia_custom_native_apps_selected_profile_id;
static NSString *dia_custom_native_apps_connections_snapshot;
static BOOL dia_custom_native_apps_connections_request_in_flight = NO;
static IMP dia_custom_native_enable_morning_action;
static NSString *dia_custom_pending_morning_brief_profile_id;
static NSView *dia_custom_pending_morning_brief_apps_view;
static NSUInteger dia_custom_pending_morning_brief_generation = 0;

static void dia_custom_clear_pending_morning_brief_confirmation(void) {
    [dia_custom_pending_morning_brief_profile_id release];
    dia_custom_pending_morning_brief_profile_id = nil;
    [dia_custom_pending_morning_brief_apps_view release];
    dia_custom_pending_morning_brief_apps_view = nil;
    dia_custom_pending_morning_brief_generation += 1;
}

static int32_t dia_custom_pending_morning_brief_native_state(void) {
    NSView *appsView = dia_custom_pending_morning_brief_apps_view;
    if (appsView == nil) return -1;
    id viewModel = dia_custom_object_ivar(appsView, "viewModel");
    int32_t state = viewModel != nil
        ? dia_custom_swift_native_apps_morning_brief_state(
            (__bridge const void *)viewModel)
        : -1;
    return state >= 0 ? state
        : dia_custom_swift_native_apps_morning_brief_state(
            (__bridge const void *)appsView);
}

static NSString *dia_custom_current_profile_id(void) {
    const char *rawProfile = getenv("DIA_CUSTOM_PROFILE");
    if (rawProfile == NULL || rawProfile[0] == '\0') return @"Default";
    NSString *base = [NSString stringWithUTF8String:rawProfile];
    NSString *path = [base stringByAppendingPathComponent:@"User Data/Local State"];
    NSData *data = [NSData dataWithContentsOfFile:path];
    NSDictionary *root = data != nil
        ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil]
        : nil;
    NSString *lastUsed = [root[@"profile"][@"last_used"]
        isKindOfClass:[NSString class]] ? root[@"profile"][@"last_used"] : nil;
    return lastUsed.length > 0 ? lastUsed : @"Default";
}

static NSString *dia_custom_native_apps_profile_id(id viewModel) {
    if (viewModel == nil) return nil;
    char *raw = dia_custom_swift_native_apps_selected_profile_id(
        (__bridge const void *)viewModel);
    if (raw == NULL) return nil;
    NSString *profileID = [NSString stringWithUTF8String:raw];
    free(raw);
    return profileID.length > 0 ? profileID : nil;
}

static NSString *dia_custom_apps_profile_id_in_view(NSView *view) {
    if ([NSStringFromClass(view.class) containsString:@"AppsPreferencePaneView"]) {
        NSString *profileID = dia_custom_native_apps_profile_id(
            dia_custom_object_ivar(view, "viewModel"));
        if (profileID.length > 0) return profileID;
    }
    for (NSView *child in view.subviews) {
        NSString *profileID = dia_custom_apps_profile_id_in_view(child);
        if (profileID.length > 0) return profileID;
    }
    return nil;
}

static BOOL dia_custom_set_native_apps_selected_profile(NSString *profileID) {
    if (profileID.length == 0 ||
        [dia_custom_native_apps_selected_profile_id isEqualToString:profileID]) {
        return NO;
    }
    [dia_custom_native_apps_selected_profile_id release];
    dia_custom_native_apps_selected_profile_id = [profileID copy];
    [dia_custom_local_apps_last_refresh release];
    dia_custom_local_apps_last_refresh = nil;
    [dia_custom_native_apps_connections_snapshot release];
    dia_custom_native_apps_connections_snapshot = nil;
    dia_custom_log_status([NSString stringWithFormat:
        @"native-apps-selected-profile-%@", profileID]);
    return YES;
}

static NSString *dia_custom_selected_apps_profile_id(void) {
    for (NSWindow *window in NSApp.windows) {
        NSString *profileID = dia_custom_apps_profile_id_in_view(window.contentView);
        if (profileID.length > 0) {
            dia_custom_set_native_apps_selected_profile(profileID);
            return dia_custom_native_apps_selected_profile_id;
        }
    }
    return dia_custom_native_apps_selected_profile_id ?:
        dia_custom_current_profile_id();
}

static void dia_custom_cache_local_apps_state(NSDictionary *state) {
    NSString *profileID = [state[@"profileID"] isKindOfClass:[NSString class]]
        ? state[@"profileID"] : nil;
    if (profileID.length == 0) return;
    if (dia_custom_local_apps_states_by_profile == nil) {
        dia_custom_local_apps_states_by_profile = [[NSMutableDictionary alloc] init];
    }
    [dia_custom_local_apps_states_by_profile setObject:state forKey:profileID];
    NSDictionary *responseBrief = [state[@"morningBrief"]
        isKindOfClass:[NSDictionary class]] ? state[@"morningBrief"] : nil;
    NSString *enabledProfileID = [responseBrief[@"enabledProfileID"]
        isKindOfClass:[NSString class]] ? responseBrief[@"enabledProfileID"] : nil;
    for (NSString *cachedProfileID in
         [dia_custom_local_apps_states_by_profile allKeys]) {
        NSDictionary *cachedState =
            dia_custom_local_apps_states_by_profile[cachedProfileID];
        NSDictionary *cachedBrief = [cachedState[@"morningBrief"]
            isKindOfClass:[NSDictionary class]] ? cachedState[@"morningBrief"] : nil;
        if (cachedBrief == nil) continue;
        NSMutableDictionary *updatedState = [cachedState mutableCopy];
        NSMutableDictionary *updatedBrief = [cachedBrief mutableCopy];
        updatedBrief[@"enabled"] = @([enabledProfileID
            isEqualToString:cachedProfileID]);
        if (enabledProfileID != nil) {
            updatedBrief[@"enabledProfileID"] = enabledProfileID;
        } else {
            [updatedBrief removeObjectForKey:@"enabledProfileID"];
        }
        updatedState[@"morningBrief"] = updatedBrief;
        [dia_custom_local_apps_states_by_profile setObject:updatedState
                                                    forKey:cachedProfileID];
        [updatedBrief release];
        [updatedState release];
    }
}

static void dia_custom_set_local_apps_state(NSDictionary *state) {
    if (state == nil) return;
    [dia_custom_local_apps_state release];
    dia_custom_local_apps_state = [state copy];
    dia_custom_cache_local_apps_state(dia_custom_local_apps_state);
}

static NSDictionary *dia_custom_local_apps_state_for_profile(
    NSString *profileID) {
    if (profileID.length == 0) return dia_custom_local_apps_state;
    NSDictionary *cached = dia_custom_local_apps_states_by_profile[profileID];
    if (cached != nil) return cached;
    NSString *currentProfile = [dia_custom_local_apps_state[@"profileID"]
        isKindOfClass:[NSString class]]
        ? dia_custom_local_apps_state[@"profileID"] : nil;
    if ([currentProfile isEqualToString:profileID]) return dia_custom_local_apps_state;
    NSDictionary *currentBrief = [dia_custom_local_apps_state[@"morningBrief"]
        isKindOfClass:[NSDictionary class]]
        ? dia_custom_local_apps_state[@"morningBrief"] : nil;
    if (dia_custom_local_apps_state == nil || currentBrief == nil) return nil;
    NSMutableDictionary *derived = [dia_custom_local_apps_state mutableCopy];
    NSMutableDictionary *brief = [currentBrief mutableCopy];
    NSString *enabledProfileID = [brief[@"enabledProfileID"]
        isKindOfClass:[NSString class]] ? brief[@"enabledProfileID"] : nil;
    brief[@"profileID"] = profileID;
    brief[@"enabled"] = @([enabledProfileID isEqualToString:profileID]);
    brief[@"due"] = @NO;
    [brief removeObjectForKey:@"run"];
    derived[@"profileID"] = profileID;
    derived[@"morningBrief"] = brief;
    [brief release];
    NSDictionary *result = [derived autorelease];
    dia_custom_cache_local_apps_state(result);
    return result;
}

static BOOL dia_custom_view_contains_text(NSView *view, NSString *needle) {
    if ([view isKindOfClass:[NSTextField class]] &&
        [[[(NSTextField *)view stringValue] lowercaseString]
            containsString:needle.lowercaseString]) return YES;
    for (NSView *child in view.subviews) {
        if (dia_custom_view_contains_text(child, needle)) return YES;
    }
    return NO;
}

static BOOL dia_custom_button_is_in_morning_brief_row(NSButton *button) {
    for (NSView *candidate = button.superview; candidate != nil;
         candidate = candidate.superview) {
        if (dia_custom_view_contains_text(candidate, @"Morning Brief")) return YES;
        if ([NSStringFromClass(candidate.class) containsString:@"AppsPreferencePaneView"]) break;
    }
    return NO;
}

static void dia_custom_install_native_apps_action_hooks(void);
static void dia_custom_fetch_native_apps_state(id target, BOOL force);

static NSString *dia_custom_button_search_text(NSButton *button) {
    NSArray<NSString *> *labels = @[
        button.title ?: @"",
        button.accessibilityLabel ?: @"",
        button.accessibilityHelp ?: @"",
        button.toolTip ?: @"",
    ];
    return [[labels componentsJoinedByString:@" "] lowercaseString];
}

static BOOL dia_custom_is_morning_action_button(NSButton *button) {
    NSString *label = button.title.length > 0
        ? button.title : button.accessibilityLabel;
    NSString *lower = [label.lowercaseString
        stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    return dia_custom_button_is_in_morning_brief_row(button) &&
        ([lower hasPrefix:@"turn on"] ||
         [lower hasPrefix:@"turn off"] ||
         [lower hasPrefix:@"enable for"] ||
         [lower hasPrefix:@"disable for"]);
}

static NSView *dia_custom_apps_view_for_descendant(NSView *view) {
    for (NSView *candidate = view; candidate != nil;
         candidate = candidate.superview) {
        if ([NSStringFromClass(candidate.class)
                containsString:@"AppsPreferencePaneView"]) return candidate;
    }
    return nil;
}

static void dia_custom_configure_native_apps_descendants(NSView *view, id target) {
    if ([view isKindOfClass:[NSButton class]]) {
        NSButton *button = (NSButton *)view;
        NSString *lower = dia_custom_button_search_text(button);
        if ([lower containsString:@"advanced chat"]) {
            button.target = target;
            button.action = NSSelectorFromString(@"enableLocalAdvancedChat:");
        } else if (dia_custom_is_morning_action_button(button)) {
            button.target = target;
            button.action = NSSelectorFromString(@"toggleLocalMorningBrief:");
        }
    }
    for (NSView *child in view.subviews) {
        dia_custom_configure_native_apps_descendants(child, target);
    }
}

static void dia_custom_sync_native_apps_connections(id viewModel,
                                                     NSString *profileID) {
    if (!dia_custom_mod_enabled("live-connectors") || viewModel == nil ||
        dia_custom_native_apps_connections_request_in_flight) return;
    char *raw = dia_custom_swift_native_apps_connections_json(
        (__bridge const void *)viewModel);
    if (raw == NULL) return;
    NSString *json = [NSString stringWithUTF8String:raw];
    free(raw);
    NSString *snapshot = profileID.length > 0 && json != nil
        ? [NSString stringWithFormat:@"%@\n%@", profileID, json] : nil;
    if (snapshot == nil ||
        [snapshot isEqualToString:dia_custom_native_apps_connections_snapshot]) {
        return;
    }
    NSData *jsonData = [json dataUsingEncoding:NSUTF8StringEncoding];
    NSArray *connectors = jsonData != nil
        ? [NSJSONSerialization JSONObjectWithData:jsonData options:0 error:nil]
        : nil;
    NSDictionary *catalog = dia_custom_model_catalog();
    NSString *token = [catalog[@"selectionToken"] isKindOfClass:[NSString class]]
        ? catalog[@"selectionToken"] : nil;
    NSURL *url = dia_custom_local_api_url(@"/api/apps/native-state");
    if (![connectors isKindOfClass:[NSArray class]] || token == nil || url == nil) return;
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
    request.HTTPMethod = @"POST";
    [request setValue:@"application/json" forHTTPHeaderField:@"content-type"];
    [request setValue:token forHTTPHeaderField:@"x-dia-custom-token"];
    request.HTTPBody = [NSJSONSerialization dataWithJSONObject:@{
        @"profileID": profileID ?: @"Default",
        @"connectors": connectors,
    } options:0 error:nil];
    dia_custom_native_apps_connections_request_in_flight = YES;
    [dia_custom_native_apps_connections_snapshot release];
    dia_custom_native_apps_connections_snapshot = [snapshot copy];
    [[[NSURLSession sharedSession] dataTaskWithRequest:request
        completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
            (void)data;
            NSInteger status = [response isKindOfClass:[NSHTTPURLResponse class]]
                ? [(NSHTTPURLResponse *)response statusCode] : 0;
            dispatch_async(dispatch_get_main_queue(), ^{
                dia_custom_native_apps_connections_request_in_flight = NO;
                if (error == nil && status >= 200 && status < 300) {
                    dia_custom_log_status(@"native-apps-connector-state-synced");
                } else {
                    [dia_custom_native_apps_connections_snapshot release];
                    dia_custom_native_apps_connections_snapshot = nil;
                    dia_custom_log_status(@"native-apps-connector-state-sync-failed");
                }
            });
        }] resume];
}

static BOOL dia_custom_apply_native_apps_state_in_view(NSView *view, id target) {
    if (view == nil || !dia_custom_local_apps_compatible) return NO;
    BOOL found = NO;
    if ([NSStringFromClass(view.class) containsString:@"AppsPreferencePaneView"]) {
        dia_custom_install_native_apps_action_hooks();
        found = YES;
        id viewModel = dia_custom_object_ivar(view, "viewModel");
        NSString *nativeProfileID = dia_custom_native_apps_profile_id(viewModel);
        BOOL profileChanged = dia_custom_set_native_apps_selected_profile(
            nativeProfileID);
        NSString *profileID = nativeProfileID.length > 0
            ? nativeProfileID : dia_custom_selected_apps_profile_id();
        if (profileChanged &&
            dia_custom_pending_morning_brief_profile_id.length > 0 &&
            ![dia_custom_pending_morning_brief_profile_id
                isEqualToString:profileID]) {
            dia_custom_clear_pending_morning_brief_confirmation();
            dia_custom_log_status(
                @"native-apps-morning-confirmation-cancelled-profile-change");
        }
        NSDictionary *profileState = dia_custom_local_apps_state_for_profile(
            profileID);
        if (profileState != nil && profileState != dia_custom_local_apps_state) {
            dia_custom_set_local_apps_state(profileState);
        }
        if (profileChanged) {
            dispatch_async(dispatch_get_main_queue(), ^{
                dia_custom_fetch_native_apps_state(target, YES);
            });
        }
        NSDictionary *advanced = [dia_custom_local_apps_state[@"advancedChat"]
            isKindOfClass:[NSDictionary class]] ? dia_custom_local_apps_state[@"advancedChat"] : nil;
        NSDictionary *brief = [dia_custom_local_apps_state[@"morningBrief"]
            isKindOfClass:[NSDictionary class]] ? dia_custom_local_apps_state[@"morningBrief"] : nil;
        if (advanced != nil && brief != nil) {
            static BOOL didInvokeNativeAppsEnable = NO;
            if ([advanced[@"enabled"] boolValue] && !didInvokeNativeAppsEnable) {
                didInvokeNativeAppsEnable = YES;
                BOOL invoked = dia_custom_swift_invoke_native_apps_enable(
                    (__bridge const void *)view);
                dia_custom_log_status(invoked
                    ? @"native-apps-enable-action-invoked"
                    : @"native-apps-enable-action-unavailable");
            }
            if (viewModel != nil) {
                dia_custom_sync_native_apps_connections(viewModel, profileID);
                BOOL awaitingNativeChoice =
                    dia_custom_pending_morning_brief_profile_id.length > 0 &&
                    [dia_custom_pending_morning_brief_profile_id
                        isEqualToString:profileID];
                if (!awaitingNativeChoice &&
                    !dia_custom_swift_set_native_apps_enabled(
                        (__bridge const void *)viewModel,
                        [brief[@"enabled"] boolValue])) {
                    dia_custom_local_apps_compatible = NO;
                    dia_custom_log_status(@"native-apps-disabled-incompatible-view-model-state");
                    return YES;
                }
            }
            BOOL awaitingNativeChoice =
                dia_custom_pending_morning_brief_profile_id.length > 0 &&
                [dia_custom_pending_morning_brief_profile_id
                    isEqualToString:profileID];
            BOOL applied =
                dia_custom_set_bool_ivar(view, "isRedesignEnabled", YES) &&
                dia_custom_set_bool_ivar(view, "isCliaActivated",
                    [advanced[@"enabled"] boolValue]) &&
                (awaitingNativeChoice ||
                 dia_custom_set_bool_ivar(view, "morningBriefPreference",
                    ![brief[@"enabled"] boolValue])) &&
                dia_custom_set_bool_ivar(view, "isMorningBriefSubscriptionEligible",
                    [brief[@"eligible"] boolValue]);
            if (!applied) {
                dia_custom_local_apps_compatible = NO;
                dia_custom_log_status(@"native-apps-disabled-incompatible-state-shape");
                return YES;
            }
            static BOOL didLogNativeAppsState = NO;
            if (!didLogNativeAppsState) {
                didLogNativeAppsState = YES;
                dia_custom_log_status(@"native-apps-state-applied");
            }
            [view setNeedsLayout:YES];
            [view setNeedsDisplay:YES];
            if ([view respondsToSelector:@selector(updateLayer)]) {
                [(id)view updateLayer];
            }
            [view layoutSubtreeIfNeeded];
        }
        dia_custom_configure_native_apps_descendants(view, target);
    }
    for (NSView *child in view.subviews) {
        found = dia_custom_apply_native_apps_state_in_view(child, target) || found;
    }
    return found;
}

static void dia_custom_refresh_native_apps_controls(id target) {
    if (!dia_custom_mod_enabled("native-apps")) return;
    for (NSWindow *window in NSApp.windows) {
        dia_custom_apply_native_apps_state_in_view(window.contentView, target);
    }
}

static void dia_custom_fetch_native_apps_state(id target, BOOL force) {
    if (!dia_custom_mod_enabled("native-apps") ||
        !dia_custom_local_apps_compatible || target == nil) return;
    NSString *profileID = dia_custom_selected_apps_profile_id();
    if (dia_custom_local_apps_request_in_flight) {
        if (![dia_custom_local_apps_request_profile_id
                isEqualToString:profileID]) {
            dia_custom_local_apps_refresh_pending = YES;
        }
        return;
    }
    if (!force && dia_custom_local_apps_last_refresh != nil &&
        [dia_custom_local_apps_last_refresh timeIntervalSinceNow] > -5.0) {
        return;
    }
    NSURLComponents *components = [NSURLComponents componentsWithURL:
        dia_custom_local_api_url(@"/api/apps/state") resolvingAgainstBaseURL:NO];
    components.queryItems = @[[NSURLQueryItem queryItemWithName:@"profileID"
        value:profileID]];
    if (components.URL == nil) return;
    dia_custom_local_apps_request_in_flight = YES;
    [dia_custom_local_apps_request_profile_id release];
    dia_custom_local_apps_request_profile_id = [profileID copy];
    NSString *requestedProfileID = [profileID copy];
    [[[NSURLSession sharedSession] dataTaskWithURL:components.URL
        completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
            NSInteger status = [response isKindOfClass:[NSHTTPURLResponse class]]
                ? [(NSHTTPURLResponse *)response statusCode] : 0;
            NSDictionary *value = data != nil
                ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil]
                : nil;
            dispatch_async(dispatch_get_main_queue(), ^{
                dia_custom_local_apps_request_in_flight = NO;
                NSString *selectedProfileID = dia_custom_selected_apps_profile_id();
                BOOL selectedRequest = [selectedProfileID
                    isEqualToString:requestedProfileID];
                if (error == nil && status >= 200 && status < 300 &&
                    [value isKindOfClass:[NSDictionary class]]) {
                    dia_custom_cache_local_apps_state(value);
                    if (selectedRequest) {
                        dia_custom_set_local_apps_state(value);
                        [dia_custom_local_apps_last_refresh release];
                        dia_custom_local_apps_last_refresh = [[NSDate date] retain];
                        dia_custom_refresh_native_apps_controls(target);
                        // Startup asks for Apps state and checks the schedule in
                        // the same run-loop turn. The HTTP result is necessarily
                        // later, so retry the due check only after this selected
                        // profile's native state has actually been installed.
                        SEL scheduleSelector =
                            @selector(checkLocalMorningBriefSchedule);
                        if (dia_custom_mod_enabled("morning-brief") &&
                            [target respondsToSelector:scheduleSelector]) {
                            [target performSelector:scheduleSelector];
                        }
                    } else {
                        dia_custom_log_status(@"native-apps-stale-profile-response-ignored");
                    }
                }
                BOOL refreshPending = dia_custom_local_apps_refresh_pending ||
                    !selectedRequest;
                dia_custom_local_apps_refresh_pending = NO;
                [dia_custom_local_apps_request_profile_id release];
                dia_custom_local_apps_request_profile_id = nil;
                if (refreshPending) {
                    dia_custom_fetch_native_apps_state(target, YES);
                }
            });
        }] resume];
    [requestedProfileID release];
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
    NSUInteger itemIndex = 0;
    NSString *lastProvider = nil;
    for (NSDictionary *model in validModels) {
        NSString *provider = [model[@"providerLabel"] isKindOfClass:[NSString class]]
            ? model[@"providerLabel"] : @"Models";
        if (lastProvider != nil && ![provider isEqualToString:lastProvider]) {
            if (itemIndex >= [popup numberOfItems] ||
                ![[popup itemAtIndex:itemIndex] isSeparatorItem]) {
                return YES;
            }
            ++itemIndex;
        }
        if (itemIndex >= [popup numberOfItems]) {
            return YES;
        }
        NSMenuItem *item = [popup itemAtIndex:itemIndex++];
        BOOL available = ![model[@"available"] respondsToSelector:@selector(boolValue)] ||
            [model[@"available"] boolValue];
        if (![[item representedObject] isEqual:model[@"key"]] ||
            [item isEnabled] != available) {
            return YES;
        }
        lastProvider = provider;
    }
    if (itemIndex != [popup numberOfItems]) {
        return YES;
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
        if (@available(macOS 15.0, *)) [popup setUsesItemFromMenu:NO];
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
    NSString *lastProvider = nil;
    for (NSDictionary *model in models) {
        NSString *key = [model[@"key"] isKindOfClass:[NSString class]]
            ? model[@"key"] : nil;
        if (key == nil) {
            continue;
        }
        NSString *provider = [model[@"providerLabel"] isKindOfClass:[NSString class]]
            ? model[@"providerLabel"] : @"Models";
        if (lastProvider != nil && ![provider isEqualToString:lastProvider]) {
            [[popup menu] addItem:[NSMenuItem separatorItem]];
        }
        lastProvider = provider;
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

static void dia_custom_update_model_picker_visibility(id toolbar,
                                                       NSPopUpButton *popup) {
    // Fast/Stop uses a separate response-command group. Dia collapses the
    // standard toolbar in that state; forcing our extra arranged subview
    // visible puts it at the composer's origin, over the placeholder.
    // Swift fields have empty Objective-C type encodings in build 87864.
    // Use typed, read-only reflection rather than guessing storage offsets.
    BOOL responseCommands = dia_custom_swift_toolbar_uses_response_commands(
        (__bridge const void *)toolbar);
    [popup setHidden:responseCommands];
    [popup setAlphaValue:responseCommands ? 0.0 : 1.0];
}

static void dia_custom_install_custom_model_picker(id target, SEL action) {
    if (!dia_custom_mod_enabled("model-picker") || target == nil) {
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
                dia_custom_update_model_picker_visibility(toolbar, installedPopup);
                continue;
            }
            NSPopUpButton *popup = [[NSPopUpButton alloc]
                initWithFrame:NSMakeRect(0, 0, 132, 26)
                   pullsDown:NO];
            [popup setIdentifier:@"DiaCustomModelPicker"];
            [popup setControlSize:NSControlSizeSmall];
            [popup setAutoenablesItems:NO];
            if ([popup respondsToSelector:@selector(setUsesItemFromMenu:)]) {
                if (@available(macOS 15.0, *)) [popup setUsesItemFromMenu:NO];
            }
            [popup setTarget:target];
            [popup setAction:action];
            [popup setToolTip:@"Choose the model for Dia+ chat"];
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
                dia_custom_update_model_picker_visibility(toolbar, popup);
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
        if (dia_custom_mod_enabled("model-picker")) {
            dia_custom_install_custom_model_picker(target, modelAction);
        }
        if (dia_custom_mod_enabled("native-memory")) {
            dia_custom_install_local_memory_controls(target, memoryAction);
        }
        if (dia_custom_mod_enabled("native-apps")) {
            dia_custom_refresh_advanced_new_tab_surface();
        }
    });
}

static void dia_custom_schedule_model_picker_attempts(id target,
                                                       SEL action,
                                                       unsigned attempt) {
    if (!dia_custom_mod_enabled("model-picker") ||
        target == nil || attempt >= 30) {
        return;
    }
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC),
                   dispatch_get_main_queue(), ^{
        dia_custom_install_custom_model_picker(target, action);
        dia_custom_schedule_model_picker_attempts(target, action, attempt + 1);
    });
}

static void dia_custom_install_developer_menu(void);

@interface DiaCustomDeveloperMenuController : NSObject
- (void)applicationReady:(NSNotification *)notification;
- (void)openPromptTools:(id)sender;
- (void)openNativeModelPicker:(id)sender;
- (void)selectCustomModel:(id)sender;
- (void)toggleLocalMemory:(id)sender;
- (void)setLocalMemoryRetention:(id)sender;
- (void)resetLocalMemory:(id)sender;
- (void)enableLocalAdvancedChat:(id)sender;
- (void)toggleLocalMorningBrief:(id)sender;
- (void)setLocalMorningBriefEnabled:(BOOL)enabled
                          profileID:(NSString *)profileID
                             sender:(id)sender;
- (void)resolveNativeMorningBriefConfirmation:(BOOL)definitive;
- (void)nativeMorningBriefSheetDidEnd:(NSNotification *)notification;
- (void)pollNativeMorningBriefConfirmation:(NSDictionary *)context;
- (void)checkLocalMorningBriefSchedule;
- (void)postLocalMorningBriefStatus:(NSString *)status
                          profileID:(NSString *)profileID
                              runID:(NSString *)runID
                              stage:(NSString *)stage
                        diagnostics:(NSArray<NSString *> *)diagnostics;
- (void)openModelSettings:(id)sender;
- (void)showDiaMods:(id)sender;
- (BOOL)openLocalSettingsFragment:(NSString *)fragment;
- (void)openCustomUpdater:(id)sender;
- (void)windowBecameKey:(NSNotification *)notification;
- (void)windowDidUpdate:(NSNotification *)notification;
- (void)openBrowserDeveloperTools:(id)sender;
- (void)openAgentServerDashboard:(id)sender;
- (void)openLogLevels:(id)sender;
@end

static void dia_custom_install_updater_controls(id target);

@implementation DiaCustomDeveloperMenuController
- (void)applicationReady:(NSNotification *)notification {
    dia_custom_install_developer_menu();
    [self windowBecameKey:notification];
}

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
                    alert.messageText = @"Could not change Dia+ model";
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
    [self openLocalSettingsFragment:nil];
}

- (void)openCustomUpdater:(id)sender {
    (void)sender;
    if (dia_custom_mod_enabled("custom-updater")) {
        [self openLocalSettingsFragment:@"custom-updater"];
    }
}

- (void)showDiaMods:(id)sender {
    (void)sender;
    dia_custom_install_mod_manager(self);
    dia_custom_show_mods_pane(dia_custom_active_mods_context());
}

- (BOOL)openLocalSettingsFragment:(NSString *)fragment {
    const char *rawURL = getenv("DIA_CUSTOM_SETTINGS_URL");
    NSString *value = rawURL != NULL
        ? [NSString stringWithUTF8String:rawURL]
        : @"http://127.0.0.1:8765/settings";
    NSURLComponents *components = [NSURLComponents componentsWithString:value];
    if (fragment.length > 0) {
        components.fragment = fragment;
    }
    NSURL *url = components.URL;
    NSURL *applicationURL = NSBundle.mainBundle.bundleURL;
    if (url == nil || applicationURL == nil) {
        NSBeep();
        return NO;
    }
    NSWorkspaceOpenConfiguration *configuration =
        [NSWorkspaceOpenConfiguration configuration];
    configuration.activates = YES;
    [[NSWorkspace sharedWorkspace]
        openURLs:@[url]
        withApplicationAtURL:applicationURL
        configuration:configuration
        completionHandler:^(__unused NSRunningApplication *application,
                            NSError *error) {
            if (error != nil) {
                dispatch_async(dispatch_get_main_queue(), ^{ NSBeep(); });
            }
        }];
    return YES;
}

- (void)windowBecameKey:(NSNotification *)notification {
    // Apply available views in the notification turn; later window updates
    // reconcile views that Dia constructs asynchronously.
    static BOOL refreshing = NO;
    if (refreshing) return;
    refreshing = YES;
    @try {
        dia_custom_install_updater_controls(self);
        if (dia_custom_mod_enabled("model-picker")) {
            dia_custom_install_custom_model_picker(self,
                @selector(selectCustomModel:));
        }
        if (dia_custom_mod_enabled("native-memory")) {
            dia_custom_install_local_memory_controls(self,
                @selector(toggleLocalMemory:));
        }
        if (dia_custom_mod_enabled("native-apps")) {
            dia_custom_refresh_advanced_new_tab_surface();
            dia_custom_fetch_native_apps_state(self, YES);
        }
        if (dia_custom_mod_enabled("morning-brief")) {
            [self checkLocalMorningBriefSchedule];
        }
        if (dia_custom_mod_enabled("mod-manager")) {
            dia_custom_install_mod_manager(self);
        }
    } @finally {
        refreshing = NO;
    }
}

- (void)windowDidUpdate:(NSNotification *)notification {
    dia_custom_install_updater_controls(self);
    dia_custom_request_interface_refresh(self,
        @selector(selectCustomModel:),
        @selector(toggleLocalMemory:));
    if (dia_custom_mod_enabled("native-apps")) {
        dia_custom_fetch_native_apps_state(self, NO);
    }
    if (dia_custom_mod_enabled("mod-manager")) {
        dia_custom_install_mod_manager(self);
    }
}

- (void)enableLocalAdvancedChat:(id)sender {
    // Advanced Chat is an actual local entitlement, not a cosmetic label. The
    // state subject update rebuilds Dia's native enabled Apps layout.
    dia_custom_fetch_native_apps_state(self, YES);
}

- (void)toggleLocalMorningBrief:(id)sender {
    dia_custom_log_status(@"native-apps-morning-toggle-requested");
    NSString *profileID = dia_custom_selected_apps_profile_id();
    NSDictionary *profileState = dia_custom_local_apps_state_for_profile(profileID);
    NSDictionary *brief = [profileState[@"morningBrief"]
        isKindOfClass:[NSDictionary class]] ? profileState[@"morningBrief"] : nil;
    BOOL enabled = [brief[@"enabled"] boolValue];
    NSString *enabledProfileID = [brief[@"enabledProfileID"]
        isKindOfClass:[NSString class]] ? brief[@"enabledProfileID"] : nil;
    if (!enabled && enabledProfileID.length > 0 &&
        ![enabledProfileID isEqualToString:profileID]) {
        NSView *appsView = [sender isKindOfClass:[NSView class]]
            ? dia_custom_apps_view_for_descendant(sender) : nil;
        if (appsView == nil || dia_custom_native_enable_morning_action == NULL) {
            dia_custom_log_status(@"native-apps-morning-confirmation-unavailable");
            NSBeep();
            return;
        }
        dia_custom_clear_pending_morning_brief_confirmation();
        dia_custom_pending_morning_brief_profile_id = [profileID copy];
        dia_custom_pending_morning_brief_apps_view = [appsView retain];
        NSUInteger generation = dia_custom_pending_morning_brief_generation;
        SEL nativeSelector = sel_registerName("onEnableMorningBriefTapped");
        ((void (*)(id, SEL))dia_custom_native_enable_morning_action)(
            appsView, nativeSelector);
        dia_custom_log_status(@"native-apps-morning-confirmation-presented");
        NSDictionary *context = @{
            @"generation": @(generation),
            @"attempt": @0,
        };
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC),
                       dispatch_get_main_queue(), ^{
            [self pollNativeMorningBriefConfirmation:context];
        });
        return;
    }
    [self setLocalMorningBriefEnabled:!enabled
                            profileID:profileID
                               sender:sender];
}

- (void)setLocalMorningBriefEnabled:(BOOL)enabled
                          profileID:(NSString *)profileID
                             sender:(id)sender {
    NSDictionary *catalog = dia_custom_model_catalog();
    NSString *token = [catalog[@"selectionToken"] isKindOfClass:[NSString class]]
        ? catalog[@"selectionToken"] : nil;
    NSURL *url = dia_custom_local_api_url(@"/api/apps/morning-brief");
    if (token == nil || url == nil) {
        dia_custom_log_status(token == nil
            ? @"native-apps-morning-toggle-missing-token"
            : @"native-apps-morning-toggle-missing-url");
        NSBeep();
        return;
    }
    if ([sender respondsToSelector:@selector(setEnabled:)]) [sender setEnabled:NO];
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
    request.HTTPMethod = @"PUT";
    [request setValue:@"application/json" forHTTPHeaderField:@"content-type"];
    [request setValue:token forHTTPHeaderField:@"x-dia-custom-token"];
    request.HTTPBody = [NSJSONSerialization dataWithJSONObject:@{
        @"enabled": [NSNumber numberWithBool:enabled],
        @"profileID": profileID,
    } options:0 error:nil];
    DiaCustomDeveloperMenuController *controller = self;
    NSString *requestedProfileID = [profileID copy];
    [[[NSURLSession sharedSession] dataTaskWithRequest:request
        completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
            NSInteger status = [response isKindOfClass:[NSHTTPURLResponse class]]
                ? [(NSHTTPURLResponse *)response statusCode] : 0;
            NSDictionary *value = data != nil
                ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil]
                : nil;
            dispatch_async(dispatch_get_main_queue(), ^{
                if (error == nil && status >= 200 && status < 300 &&
                    [value isKindOfClass:[NSDictionary class]]) {
                    dia_custom_log_status(@"native-apps-morning-toggle-succeeded");
                    dia_custom_cache_local_apps_state(value);
                    if ([dia_custom_selected_apps_profile_id()
                            isEqualToString:requestedProfileID]) {
                        dia_custom_set_local_apps_state(value);
                        dia_custom_refresh_native_apps_controls(controller);
                        if (enabled) [controller checkLocalMorningBriefSchedule];
                    } else {
                        dia_custom_fetch_native_apps_state(controller, YES);
                    }
                } else {
                    NSString *reason = [value[@"error"] isKindOfClass:[NSString class]]
                        ? value[@"error"] : @"unknown";
                    dia_custom_log_status([NSString stringWithFormat:
                        @"native-apps-morning-toggle-failed-%ld-%@",
                        (long)status, reason]);
                    if ([sender respondsToSelector:@selector(setEnabled:)]) [sender setEnabled:YES];
                    NSBeep();
                }
            });
        }] resume];
    [requestedProfileID release];
}

- (void)resolveNativeMorningBriefConfirmation:(BOOL)definitive {
    if (dia_custom_pending_morning_brief_profile_id.length == 0) return;
    int32_t nativeState = dia_custom_pending_morning_brief_native_state();
    // A disabled native preference is also the pre-confirmation state. Only a
    // positive native choice may resolve early; dismissal makes Cancel final.
    if (!definitive && nativeState != 1) return;
    BOOL accepted = nativeState == 1;
    NSString *profileID = [dia_custom_pending_morning_brief_profile_id copy];
    dia_custom_clear_pending_morning_brief_confirmation();
    if (accepted) {
        [self setLocalMorningBriefEnabled:YES profileID:profileID sender:nil];
        dia_custom_log_status(@"native-apps-morning-confirmation-accepted");
    } else {
        dia_custom_log_status(@"native-apps-morning-confirmation-cancelled");
        dia_custom_fetch_native_apps_state(self, YES);
    }
    [profileID release];
}

- (void)nativeMorningBriefSheetDidEnd:(NSNotification *)notification {
    (void)notification;
    if (dia_custom_pending_morning_brief_profile_id.length == 0) return;
    NSUInteger generation = dia_custom_pending_morning_brief_generation;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 150 * NSEC_PER_MSEC),
                   dispatch_get_main_queue(), ^{
        if (generation == dia_custom_pending_morning_brief_generation) {
            [self resolveNativeMorningBriefConfirmation:YES];
        }
    });
}

- (void)pollNativeMorningBriefConfirmation:(NSDictionary *)context {
    NSUInteger generation = [context[@"generation"] unsignedIntegerValue];
    NSUInteger attempt = [context[@"attempt"] unsignedIntegerValue];
    if (generation != dia_custom_pending_morning_brief_generation ||
        dia_custom_pending_morning_brief_profile_id.length == 0) return;
    if (dia_custom_pending_morning_brief_native_state() == 1) {
        [self resolveNativeMorningBriefConfirmation:NO];
        return;
    }
    if (attempt >= 1200) {
        [self resolveNativeMorningBriefConfirmation:YES];
        return;
    }
    NSDictionary *next = @{
        @"generation": @(generation),
        @"attempt": @(attempt + 1),
    };
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC),
                   dispatch_get_main_queue(), ^{
        [self pollNativeMorningBriefConfirmation:next];
    });
}

- (void)checkLocalMorningBriefSchedule {
    if (!dia_custom_mod_enabled("morning-brief") ||
        getenv("DIA_CUSTOM_PREFLIGHT") != NULL) return;
    if (dia_custom_local_apps_state == nil) {
        dia_custom_fetch_native_apps_state(self, YES);
        return;
    }
    NSDictionary *brief = [dia_custom_local_apps_state[@"morningBrief"]
        isKindOfClass:[NSDictionary class]] ? dia_custom_local_apps_state[@"morningBrief"] : nil;
    if (![brief[@"due"] boolValue]) return;
    // Dia's shipped MorningBriefScheduleClient observes the native `.daily`
    // preference invoked by the Apps pane callback. Give it a grace period,
    // then invoke the same WindowPresenter action it uses as a catch-up path.
    // The bridge rechecks `due` after the delay, so a native start always wins.
    static NSString *lastScheduledKey;
    NSString *day = [brief[@"localDay"] isKindOfClass:[NSString class]]
        ? brief[@"localDay"] : nil;
    NSString *profileID = [brief[@"profileID"] isKindOfClass:[NSString class]]
        ? brief[@"profileID"] : dia_custom_selected_apps_profile_id();
    if (day.length == 0 || profileID.length == 0) return;
    NSString *key = [NSString stringWithFormat:@"%@:%@", profileID, day];
    if ([lastScheduledKey isEqualToString:key]) return;
    [lastScheduledKey release];
    lastScheduledKey = [key copy];
    dia_custom_log_status(@"morning-brief-native-scheduler-due");

    NSString *scheduledProfileID = [profileID copy];
    NSString *scheduledDay = [day copy];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 15 * NSEC_PER_SEC),
                   dispatch_get_main_queue(), ^{
        NSURLComponents *components = [NSURLComponents componentsWithURL:
            dia_custom_local_api_url(@"/api/apps/state")
            resolvingAgainstBaseURL:NO];
        components.queryItems = @[[NSURLQueryItem queryItemWithName:@"profileID"
            value:scheduledProfileID]];
        NSURL *url = components.URL;
        if (url == nil) {
            [scheduledProfileID release];
            [scheduledDay release];
            return;
        }
        [[[NSURLSession sharedSession] dataTaskWithURL:url
            completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
                NSInteger statusCode = [response isKindOfClass:[NSHTTPURLResponse class]]
                    ? [(NSHTTPURLResponse *)response statusCode] : 0;
                NSDictionary *state = data != nil
                    ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil]
                    : nil;
                NSDictionary *freshBrief = [state[@"morningBrief"]
                    isKindOfClass:[NSDictionary class]] ? state[@"morningBrief"] : nil;
                BOOL stillDue = error == nil && statusCode >= 200 && statusCode < 300 &&
                    [freshBrief[@"due"] boolValue] &&
                    [freshBrief[@"localDay"] isEqualToString:scheduledDay];
                dispatch_async(dispatch_get_main_queue(), ^{
                    if (!stillDue) {
                        dia_custom_log_status(@"morning-brief-native-scheduler-started");
                    } else {
                        NSString *runID = [NSString stringWithFormat:
                            @"native-%@-%@", scheduledProfileID, scheduledDay];
                        [self postLocalMorningBriefStatus:@"running"
                                               profileID:scheduledProfileID
                                                   runID:runID
                                                   stage:@"native-action-dispatched"
                                             diagnostics:@[]];
                        BOOL invoked = [self invokeWindowPresenterAction:
                            "openOrGenerateCliaReport"];
                        dia_custom_log_status(invoked
                            ? @"morning-brief-native-fallback-invoked"
                            : @"morning-brief-native-fallback-unavailable");
                        if (!invoked) {
                            [self postLocalMorningBriefStatus:@"failed"
                                                   profileID:scheduledProfileID
                                                       runID:runID
                                                       stage:@"native-controller-incompatible"
                                                 diagnostics:@[
                                @"Dia's native openOrGenerateCliaReport action is unavailable for this build."
                            ]];
                        }
                    }
                    [scheduledProfileID release];
                    [scheduledDay release];
                });
            }] resume];
    });
}

- (void)postLocalMorningBriefStatus:(NSString *)status
                          profileID:(NSString *)profileID
                              runID:(NSString *)runID
                              stage:(NSString *)stage
                        diagnostics:(NSArray<NSString *> *)diagnostics {
    NSDictionary *catalog = dia_custom_model_catalog();
    NSString *token = [catalog[@"selectionToken"] isKindOfClass:[NSString class]]
        ? catalog[@"selectionToken"] : nil;
    NSURL *url = dia_custom_local_api_url(@"/api/apps/morning-brief/status");
    if (token.length == 0 || url == nil) return;
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url];
    request.HTTPMethod = @"POST";
    [request setValue:@"application/json" forHTTPHeaderField:@"content-type"];
    [request setValue:token forHTTPHeaderField:@"x-dia-custom-token"];
    NSMutableDictionary *body = [NSMutableDictionary dictionaryWithDictionary:@{
        @"status": status ?: @"failed",
        @"profileID": profileID ?: @"Default",
        @"diagnostics": diagnostics ?: @[],
    }];
    if (runID.length > 0) body[@"runID"] = runID;
    if (stage.length > 0) body[@"stage"] = stage;
    request.HTTPBody = [NSJSONSerialization dataWithJSONObject:body options:0 error:nil];
    [[[NSURLSession sharedSession] dataTaskWithRequest:request
        completionHandler:^(__unused NSData *data,
                            __unused NSURLResponse *response,
                            __unused NSError *error) {}] resume];
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
    if (!requestedState) {
        NSAlert *confirmation = [[NSAlert alloc] init];
        confirmation.alertStyle = NSAlertStyleWarning;
        confirmation.messageText = @"Disable Memory?";
        confirmation.informativeText =
            @"Dia+ will stop saving and using new browsing and chat activity. Existing local memory is retained until you reset it.";
        [confirmation addButtonWithTitle:@"Disable Memory"];
        [confirmation addButtonWithTitle:@"Cancel"];
        if ([confirmation runModal] != NSAlertFirstButtonReturn) {
            return;
        }
    }
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
                dia_custom_set_memory_last_refresh([NSDate date]);
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
    NSInteger requestedDays = dia_custom_memory_retention_from_title(
        popup.selectedItem.title);
    if (requestedDays == NSNotFound) {
        dia_custom_populate_retention_popup(popup);
        return;
    }
    NSString *profileID = dia_custom_profile_id_for_memory_popup(popup);
    NSInteger previousDays = dia_custom_memory_retention_days_for_popup(popup);
    if (requestedDays == previousDays) {
        return;
    }
    if (requestedDays > 0 &&
        (previousDays == 0 || requestedDays < previousDays)) {
        NSAlert *confirmation = [[NSAlert alloc] init];
        confirmation.alertStyle = NSAlertStyleWarning;
        confirmation.messageText = @"Shorten local memory retention?";
        confirmation.informativeText = [NSString stringWithFormat:
            @"Dia+ will permanently remove local memory older than %@. This does not contact Dia.",
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
        @"profileID": profileID,
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
                    [localMemory isKindOfClass:[NSDictionary class]]) {
                    if ([localMemory[@"retentionDays"] respondsToSelector:
                        @selector(integerValue)]) {
                        dia_custom_local_memory_retention_days =
                            [localMemory[@"retentionDays"] integerValue];
                    }
                    if ([localMemory[@"profileRetentionDays"]
                        isKindOfClass:[NSDictionary class]]) {
                        dia_custom_set_profile_retention_days(
                            localMemory[@"profileRetentionDays"]);
                    }
                    if ([stats[@"total"] respondsToSelector:
                        @selector(integerValue)]) {
                        dia_custom_local_memory_entry_count =
                            [stats[@"total"] integerValue];
                    }
                } else {
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
                dia_custom_set_memory_last_refresh([NSDate date]);
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
        @"This permanently deletes Dia+ browsing, chat, and derived Memories on this Mac. Imported connector records are kept. Nothing is sent to Dia.";
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
        @"entryTypes": @[@"memory", @"navigation", @"conversation"],
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
                dia_custom_set_memory_last_refresh(nil);
                dia_custom_fetch_local_memory_state(strongSelf,
                    @selector(toggleLocalMemory:), YES);
            });
        }] resume];
}

- (void)openPromptTools:(id)sender {
    // Dia 1.46's private PromptToolsController now requires a Swift task-local
    // dependency token that the production app does not expose. Constructing
    // it with a synthetic token traps the process, so present the local routing
    // editor that actually owns Dia Custom's provider behavior.
    [self openLocalSettingsFragment:@"advanced-json"];
}

- (void)openBrowserDeveloperTools:(id)sender {
    NSWindow *window = NSApp.keyWindow ?: NSApp.mainWindow;
    if ([window.title isEqualToString:@"New Tab"]) {
        NSAlert *alert = [[NSAlert alloc] init];
        alert.messageText = @"Developer Tools need a webpage";
        alert.informativeText = @"Open a normal webpage first, then choose View → Developer → Browser Developer Tools. Dia disables its native inspector on the New Tab page.";
        [alert addButtonWithTitle:@"OK"];
        [alert runModal];
        return;
    }
    if (![NSApp sendAction:NSSelectorFromString(@"toggleDevTools:")
                        to:nil
                      from:sender]) {
        NSAlert *alert = [[NSAlert alloc] init];
        alert.messageText = @"Developer Tools need a webpage";
        alert.informativeText = @"Open a normal webpage first, then choose View → Developer → Browser Developer Tools. Dia disables its native inspector on the New Tab page.";
        [alert addButtonWithTitle:@"OK"];
        [alert runModal];
    }
}

- (BOOL)invokeWindowPresenterAction:(const char *)fieldName {
    id menuOrchestrator = dia_custom_object_ivar(
        [NSApp delegate], "mainMenuOrchestrator");
    id menuOwner = menuOrchestrator ?: [NSApp delegate];
    if (menuOwner != nil && dia_custom_swift_invoke_menu_action(
            (const void *)menuOwner, fieldName)) {
        return YES;
    }
    // WindowController+CliaReport installs the manual Cmd-Shift-M command on
    // Dia's normal responder chain even when MainMenuOrchestrator has not yet
    // registered a concrete menu item. This is the same native action the
    // user's shortcut invokes and keeps its queueing/report UI intact.
    NSString *actionName = [NSString stringWithUTF8String:fieldName];
    SEL responderAction = actionName.length > 0
        ? NSSelectorFromString(actionName) : NULL;
    if (responderAction != NULL &&
        [NSApp sendAction:responderAction to:nil from:nil]) {
        return YES;
    }
    for (NSWindow *window in NSApp.windows) {
        id windowController = window.windowController;
        if (responderAction != NULL &&
            [windowController respondsToSelector:responderAction] &&
            [NSApp sendAction:responderAction
                           to:windowController
                         from:nil]) {
            return YES;
        }
    }
    id applicationController = dia_custom_object_ivar([NSApp delegate], "controller");
    if (applicationController == nil) {
        return NO;
    }
    if (strcmp(fieldName, "openOrGenerateCliaReport") == 0) {
        const void *implementation = dia_custom_main_image_address(DIA_CUSTOM_MORNING_BRIEF_OFFSET);
        NSString *build = [NSBundle.mainBundle objectForInfoDictionaryKey:@"CFBundleVersion"];
        if ([build isEqualToString:@DIA_CUSTOM_NATIVE_ACTION_BUILD] && implementation != NULL &&
            memcmp(implementation, dia_custom_morning_brief_signature,
                sizeof(dia_custom_morning_brief_signature)) == 0 &&
            dia_custom_swift_invoke_morning_brief(applicationController,
                dia_custom_platform_window(), implementation)) {
            dia_custom_log_status(@"morning-brief-native-window-controller-invoked");
            return YES;
        }
    }
    return dia_custom_swift_invoke_window_presenter_action(
        (const void *)applicationController,
        fieldName);
}

- (void)openAgentServerDashboard:(id)sender {
    [self openLocalSettingsFragment:@"tool-coverage"];
}

- (void)openLogLevels:(id)sender {
    const char *rawProfile = getenv("DIA_CUSTOM_PROFILE");
    NSString *profile = rawProfile != NULL
        ? [NSString stringWithUTF8String:rawProfile] : nil;
    NSString *diagnostics = profile.length > 0
        ? [profile stringByAppendingPathComponent:@"Diagnostics"] : nil;
    NSError *error = nil;
    BOOL ready = diagnostics.length > 0 && [[NSFileManager defaultManager]
        createDirectoryAtPath:diagnostics
        withIntermediateDirectories:YES
        attributes:@{NSFilePosixPermissions: @0700}
        error:&error];
    if (!ready || ![[NSWorkspace sharedWorkspace]
        openURL:[NSURL fileURLWithPath:diagnostics isDirectory:YES]]) {
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
static BOOL dia_custom_native_apps_actions_installed = NO;

static void dia_custom_intercept_manual_update(id object, SEL command, ...) {
    (void)object;
    (void)command;
    dispatch_async(dispatch_get_main_queue(), ^{
        [dia_custom_developer_menu_controller openCustomUpdater:nil];
    });
}

static void dia_custom_intercept_background_update(id object, SEL command, ...) {
    (void)object;
    (void)command;
    // Scheduled checks belong to the custom bridge. Sparkle must never stage
    // or swap the vendor bundle over this customized, signed application.
}

static BOOL dia_custom_is_update_action(SEL action) {
    NSString *name = action != NULL ? NSStringFromSelector(action) : @"";
    return [@[@"checkForUpdates", @"checkForUpdates:", @"onUpdaterCheckNowTapped",
        @"installUpdate:", @"installAndQuit", @"installAndQuit:"] containsObject:name];
}

static void dia_custom_retarget_update_menu(NSMenu *menu, id target) {
    for (NSMenuItem *item in menu.itemArray) {
        if (dia_custom_is_update_action(item.action) ||
            [item.title hasPrefix:@"Check for Updates"]) {
            item.target = target;
            item.action = @selector(openCustomUpdater:);
            item.enabled = YES;
        }
        if (item.submenu != nil) dia_custom_retarget_update_menu(item.submenu, target);
    }
}

static void dia_custom_retarget_update_buttons(NSView *view, id target, BOOL inUpdateView) {
    NSString *className = NSStringFromClass(view.class);
    inUpdateView = inUpdateView || [className containsString:@"UpdateBanner"] ||
        [className containsString:@"SoftwareUpdate"];
    if ([view isKindOfClass:[NSButton class]]) {
        NSButton *button = (NSButton *)view;
        NSString *title = button.title.lowercaseString;
        BOOL installButton = inUpdateView &&
            ([title containsString:@"update"] || [title containsString:@"restart"] ||
             [title containsString:@"relaunch"] || [title containsString:@"install"]) &&
            ![title containsString:@"later"] && ![title containsString:@"notes"];
        if (dia_custom_is_update_action(button.action) || installButton) {
            button.target = target;
            button.action = @selector(openCustomUpdater:);
            button.enabled = YES;
        }
    }
    for (NSView *child in view.subviews) {
        dia_custom_retarget_update_buttons(child, target, inUpdateView);
    }
}

static void dia_custom_install_updater_controls(id target) {
    if (!dia_custom_mod_enabled("custom-updater")) return;
    static CFTimeInterval lastRefresh;
    CFTimeInterval now = [NSDate timeIntervalSinceReferenceDate];
    if (lastRefresh > 0 && now - lastRefresh < 0.5) return;
    lastRefresh = now;
    dia_custom_retarget_update_menu(NSApp.mainMenu, target);
    // Only inspect the native update views on window events. No controls are
    // inserted into web pages or into unrelated update/settings dialogs.
    for (NSWindow *window in NSApp.windows) {
        dia_custom_retarget_update_buttons(window.contentView, target, NO);
    }
    static NSMutableSet *installed;
    if (installed == nil) installed = [[NSMutableSet alloc] init];
    NSDictionary *methods = @{
        @"SPUUpdater": @[@"checkForUpdates", @"checkForUpdatesInBackground", @"checkForUpdateInformation"],
        @"SUUpdater": @[@"checkForUpdates:", @"checkForUpdatesInBackground", @"checkForUpdateInformation"],
        @"SPUStandardUpdaterController": @[@"checkForUpdates:"],
    };
    for (NSString *className in methods) {
        Class cls = NSClassFromString(className);
        if (cls == Nil) continue;
        for (NSString *action in methods[className]) {
            NSString *key = [className stringByAppendingString:action];
            if ([installed containsObject:key]) continue;
            SEL selector = NSSelectorFromString(action);
            Method method = class_getInstanceMethod(cls, selector);
            if (method == NULL) continue;
            char resultType[8] = {0};
            method_getReturnType(method, resultType, sizeof(resultType));
            if (strcmp(resultType, "v") != 0 || method_getNumberOfArguments(method) > 3) continue;
            BOOL manual = [action isEqualToString:@"checkForUpdates"] ||
                [action isEqualToString:@"checkForUpdates:"];
            IMP replacement = manual ? (IMP)dia_custom_intercept_manual_update
                : (IMP)dia_custom_intercept_background_update;
            if (!class_addMethod(cls, selector, replacement, method_getTypeEncoding(method))) {
                method_setImplementation(method, replacement);
            }
            [installed addObject:key];
        }
    }
}

static void dia_custom_install_native_apps_action_hooks(void) {
    if (!dia_custom_mod_enabled("native-apps") ||
        dia_custom_native_apps_actions_installed) return;
    Class appsView = NSClassFromString(@"Preferences.AppsPreferencePaneView");
    if (appsView == Nil) {
        dia_custom_log_status(@"native-apps-disabled-missing-view-class");
        return;
    }
    const char *actions[] = {
        "onCliaTurnOnTapped",
        "onEnableMorningBriefTapped",
        "onDisableMorningBriefTapped",
    };
    for (size_t index = 0; index < sizeof(actions) / sizeof(actions[0]); ++index) {
        SEL selector = sel_registerName(actions[index]);
        Method method = class_getInstanceMethod(appsView, selector);
        if (method == NULL) {
            dia_custom_local_apps_compatible = NO;
            dia_custom_log_status(@"native-apps-disabled-missing-action");
            return;
        }
        if (index == 1) {
            dia_custom_native_enable_morning_action = method_getImplementation(method);
        }
    }
    dia_custom_native_apps_actions_installed = YES;
    dia_custom_log_status(@"native-apps-actions-redirected");
}

static void dia_custom_install_developer_menu(void) {
    BOOL modelPickerEnabled = dia_custom_mod_enabled("model-picker");
    BOOL developerToolsEnabled = dia_custom_mod_enabled("developer-tools");
    if (!modelPickerEnabled && !developerToolsEnabled) {
        return;
    }

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
    if (modelPickerEnabled || developerToolsEnabled) {
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
    }

    if (modelPickerEnabled &&
        [developerMenu itemWithTitle:@"AI Model"] == nil) {
        [developerMenu addItem:[NSMenuItem separatorItem]];
        dia_custom_model_menu = [[NSMenu alloc] initWithTitle:@"AI Model"];
        NSMenuItem *modelMenuItem = [[NSMenuItem alloc]
            initWithTitle:@"AI Model" action:nil keyEquivalent:@""];
        [modelMenuItem setSubmenu:dia_custom_model_menu];
        [developerMenu addItem:modelMenuItem];
        dia_custom_rebuild_model_menu(dia_custom_developer_menu_controller,
            @selector(selectCustomModel:));

        NSMenuItem *modelSettings = [[NSMenuItem alloc]
            initWithTitle:@"Dia Mod Settings…"
                   action:@selector(openModelSettings:)
            keyEquivalent:@""];
        [modelSettings setTarget:dia_custom_developer_menu_controller];
        [developerMenu addItem:modelSettings];

        NSMenuItem *modelPicker = [[NSMenuItem alloc]
            initWithTitle:@"Native Model Picker"
                   action:@selector(openNativeModelPicker:)
            keyEquivalent:@""];
        [modelPicker setTarget:dia_custom_developer_menu_controller];
        [developerMenu addItem:modelPicker];
    }

    if (developerToolsEnabled &&
        [developerMenu itemWithTitle:@"Prompt & Model Routing…"] == nil) {
        NSMenuItem *promptTools = [[NSMenuItem alloc]
            initWithTitle:@"Prompt & Model Routing…"
                   action:@selector(openPromptTools:)
            keyEquivalent:@""];
        [promptTools setTarget:dia_custom_developer_menu_controller];
        [developerMenu addItem:promptTools];

        NSMenuItem *browserTools = [[NSMenuItem alloc]
            initWithTitle:@"Browser Developer Tools"
                   action:@selector(openBrowserDeveloperTools:)
            keyEquivalent:@""];
        [browserTools setTarget:dia_custom_developer_menu_controller];
        [developerMenu addItem:browserTools];

        NSMenuItem *agentServerDashboard = [[NSMenuItem alloc]
            initWithTitle:@"Agent & Tool Dashboard…"
                   action:@selector(openAgentServerDashboard:)
            keyEquivalent:@""];
        [agentServerDashboard setTarget:dia_custom_developer_menu_controller];
        [developerMenu addItem:agentServerDashboard];

        NSMenuItem *logLevels = [[NSMenuItem alloc]
            initWithTitle:@"Open Diagnostics Folder"
                   action:@selector(openLogLevels:)
            keyEquivalent:@""];
        [logLevels setTarget:dia_custom_developer_menu_controller];
        [developerMenu addItem:logLevels];
    }

    static BOOL loggedInstallation = NO;
    if (!loggedInstallation) {
        loggedInstallation = YES;
        dia_custom_log_status(@"developer-menu-installed");
    }
}

static void dia_custom_retry_developer_menu(unsigned attempt) {
    dia_custom_install_developer_menu();
    if (dia_custom_find_menu_item(NSApp.mainMenu, @[@"View"]) != nil) return;
    if (attempt >= 100) {
        dia_custom_log_status(@"developer-menu-awaiting-window");
        return;
    }
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC),
                   dispatch_get_main_queue(), ^{
        dia_custom_retry_developer_menu(attempt + 1);
    });
}

static void dia_custom_install_ui_runtime(void) {
    if (dia_custom_developer_menu_controller != nil) return;
    dia_custom_developer_menu_controller =
        [[DiaCustomDeveloperMenuController alloc] init];
    // Register before AppKit launches so the first window is observed.
    [[NSNotificationCenter defaultCenter]
        addObserver:dia_custom_developer_menu_controller
           selector:@selector(applicationReady:)
               name:NSApplicationWillFinishLaunchingNotification
             object:nil];
    [[NSNotificationCenter defaultCenter]
        addObserver:dia_custom_developer_menu_controller
           selector:@selector(applicationReady:)
               name:NSApplicationDidFinishLaunchingNotification
             object:nil];
    [[NSNotificationCenter defaultCenter]
        addObserver:dia_custom_developer_menu_controller
           selector:@selector(applicationReady:)
               name:NSWindowDidBecomeKeyNotification
             object:nil];
    [[NSNotificationCenter defaultCenter]
        addObserver:dia_custom_developer_menu_controller
           selector:@selector(windowDidUpdate:)
               name:NSWindowDidUpdateNotification
             object:nil];
    [[NSNotificationCenter defaultCenter]
        addObserver:dia_custom_developer_menu_controller
           selector:@selector(nativeMorningBriefSheetDidEnd:)
               name:NSWindowDidEndSheetNotification
             object:nil];
    dia_custom_log_status(@"ui-runtime-observers-installed");
    dispatch_async(dispatch_get_main_queue(), ^{
        dia_custom_install_native_apps_action_hooks();
        [dia_custom_developer_menu_controller windowBecameKey:nil];
        dia_custom_retry_developer_menu(0);
        dia_custom_schedule_model_picker_attempts(
            dia_custom_developer_menu_controller,
            @selector(selectCustomModel:), 0);
    });
}

__attribute__((constructor))
static void dia_custom_install_runtime_overrides(void) {
    const char *program = getprogname();
    if (program == NULL || strcmp(program, "Dia") != 0) {
        return;
    }

    dia_custom_prepare_self_contained_runtime();
    // The menu exists a few seconds before Dia's anonymous browser context is
    // ready. Enabling these commands during that gap exposes Dia's generic
    // "Something went wrong" alert, so wait until normal startup has settled.
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 8 * NSEC_PER_SEC),
                   dispatch_get_main_queue(), ^{
        dia_custom_schedule_window_menu_repair(0);
    });

    if (dia_custom_mod_enabled("network-isolation")) {
        dia_custom_schedule_network_log();
    }
    if (dia_custom_mod_enabled("account-bypass")) {
        dia_custom_close_account_window();
    }
    if (dia_custom_mod_enabled("dia-import")) {
        dia_custom_install_dia_import_presentation_override();
        dispatch_async(dispatch_get_main_queue(), ^{
            dia_custom_install_dia_import_source_override(0);
            dia_custom_poll_dia_import_request();
        });
    }
    if (dia_custom_mod_enabled("model-picker") ||
        dia_custom_mod_enabled("developer-tools") ||
        dia_custom_mod_enabled("mod-manager") ||
        dia_custom_mod_enabled("native-memory") ||
        dia_custom_mod_enabled("native-apps") ||
        dia_custom_mod_enabled("morning-brief") ||
        dia_custom_mod_enabled("custom-updater")) {
        dia_custom_install_ui_runtime();
    }
}
