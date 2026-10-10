// Narrow one-shot launchd submission with independent macOS responsibility.
// Like LLDB's macOS spawn support, resolve the OS SPI dynamically and fail
// closed if it is unavailable. No root privileges or credentials are used.
#include <dlfcn.h>
#include <errno.h>
#include <limits.h>
#include <spawn.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

extern char **environ;
int main(int argc, char **argv) {
    if (argc == 2 && strcmp(argv[1], "check") == 0) {
        pid_t (*responsible)(pid_t) = dlsym(RTLD_DEFAULT, "responsibility_get_pid_responsible_for_pid");
        pid_t owner = responsible ? responsible(getpid()) : -1;
        if (!responsible || owner != getppid()) {
            fprintf(stderr, "Installer responsibility is not independent (self=%d parent=%d responsible=%d).\n", getpid(), getppid(), owner);
            return 1;
        }
        return 0;
    }
    if (argc != 2 || argv[1][0] != '/' || strlen(argv[1]) >= PATH_MAX) return 2;
    int (*disclaim)(posix_spawnattr_t *, bool) = dlsym(RTLD_DEFAULT, "responsibility_spawnattrs_setdisclaim");
    if (!disclaim) { fputs("Independent installer spawn is unsupported.\n", stderr); return 1; }
    posix_spawnattr_t attr;
    int error = posix_spawnattr_init(&attr);
    if (error) return 1;
    error = disclaim(&attr, true);
    char domain[64];
    snprintf(domain, sizeof(domain), "gui/%u", getuid());
    char *args[] = {"/bin/launchctl", "bootstrap", domain, argv[1], NULL};
    pid_t child;
    if (!error) error = posix_spawn(&child, args[0], NULL, &attr, args, environ);
    posix_spawnattr_destroy(&attr);
    if (error) { fputs("Independent installer submission failed.\n", stderr); return 1; }
    int status;
    while (waitpid(child, &status, 0) < 0) { if (errno != EINTR) return 1; }
    return WIFEXITED(status) ? WEXITSTATUS(status) : 1;
}
