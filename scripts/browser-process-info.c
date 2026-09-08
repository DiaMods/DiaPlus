#include <errno.h>
#include <libproc.h>
#include <signal.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/param.h>
#include <sys/proc.h>
#include <sys/sysctl.h>
#include <unistd.h>

// ps/pgrep render argv as one string. KERN_PROCARGS2 retains its boundaries.
struct process_info {
  struct proc_bsdinfo bsd;
  char executable[PROC_PIDPATHINFO_MAXSIZE];
  char *storage;
  char **argv;
  int argc;
};

static void release_info(struct process_info *info) {
  free(info->argv);
  free(info->storage);
}

static bool gone(pid_t pid) {
  if (kill(pid, 0) == -1 && errno == ESRCH) return true;
  // proc_pidinfo/proc_pidpath may already be unavailable for an unreaped
  // zombie, while kill(pid, 0) still succeeds. Zombies cannot write profiles.
  struct kinfo_proc info;
  size_t size = sizeof(info);
  int mib[] = { CTL_KERN, KERN_PROC, KERN_PROC_PID, pid };
  if (sysctl(mib, 4, &info, &size, NULL, 0)) return false;
  return size == 0 || (size == sizeof(info) && info.kp_proc.p_stat == SZOMB);
}

// 1 = read, 0 = exited/foreign UID, -1 = cannot safely inspect.
static int read_info(pid_t pid, struct process_info *info) {
  memset(info, 0, sizeof(*info));
  int got = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info->bsd, sizeof(info->bsd));
  if (got != sizeof(info->bsd)) return gone(pid) ? 0 : -1;
  if (info->bsd.pbi_status == SZOMB || info->bsd.pbi_uid != getuid()) return 0;
  bool executable_available = proc_pidpath(pid, info->executable, sizeof(info->executable)) > 0;
  int argmax = 0;
  size_t argmax_size = sizeof(argmax);
  int max_mib[] = { CTL_KERN, KERN_ARGMAX };
  if (sysctl(max_mib, 2, &argmax, &argmax_size, NULL, 0) || argmax <= 0) return -1;
  info->storage = malloc((size_t)argmax);
  if (!info->storage) return -1;
  size_t size = (size_t)argmax;
  int mib[] = { CTL_KERN, KERN_PROCARGS2, pid };
  if (sysctl(mib, 3, info->storage, &size, NULL, 0)) return gone(pid) ? 0 : -1;
  if (size < sizeof(int)) return -1;
  memcpy(&info->argc, info->storage, sizeof(int));
  if (info->argc < 1 || (size_t)info->argc > size) return -1;
  info->argv = calloc((size_t)info->argc, sizeof(char *));
  if (!info->argv) return -1;
  char *end = info->storage + size;
  char *cursor = info->storage + sizeof(int);
  // Skip the executable path and alignment bytes before argv[0].
  char *nul = memchr(cursor, 0, (size_t)(end - cursor));
  if (!nul) return -1;
  // proc_pidpath returns ENOENT for an unlinked/replaced executable even while
  // it runs. KERN_PROCARGS2 also retains the kernel's executable path.
  if (!executable_available) {
    size_t executable_size = (size_t)(nul - cursor);
    if (!executable_size || executable_size >= sizeof(info->executable)) return -1;
    memcpy(info->executable, cursor, executable_size + 1);
  }
  cursor = nul + 1;
  while (cursor < end && !*cursor) cursor++;
  for (int i = 0; i < info->argc; i++) {
    if (cursor >= end) return -1;
    info->argv[i] = cursor;
    nul = memchr(cursor, 0, (size_t)(end - cursor));
    if (!nul) return -1;
    cursor = nul + 1;
  }
  // Reject PID reuse while collecting executable and argv.
  struct proc_bsdinfo after;
  got = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &after, sizeof(after));
  if (got != sizeof(after)) return gone(pid) ? 0 : -1;
  if (after.pbi_start_tvsec != info->bsd.pbi_start_tvsec ||
      after.pbi_start_tvusec != info->bsd.pbi_start_tvusec) return -1;
  return 1;
}

static int read_info_bounded(pid_t pid, struct process_info *info) {
  for (int attempt = 0; ; attempt++) {
    int result = read_info(pid, info);
    if (result >= 0 || attempt == 4) return result;
    // exec/exit briefly exposes incomplete metadata. Retry that PID only;
    // persistent errors still abort rather than returning a partial list.
    release_info(info);
    usleep(10000);
  }
}

static void json_string(const char *value) {
  putchar('"');
  for (const unsigned char *s = (const unsigned char *)value; *s; s++) {
    if (*s == '"' || *s == '\\') { putchar('\\'); putchar(*s); }
    else if (*s < 0x20) printf("\\u%04x", *s);
    else putchar(*s);
  }
  putchar('"');
}

static bool uses_profile(const struct process_info *info, const char *profile) {
  const char *flag = "--user-data-dir=";
  const char *value = NULL;
  for (int i = 1; i < info->argc; i++) {
    if (!strcmp(info->argv[i], "--")) break;
    if (!strncmp(info->argv[i], flag, strlen(flag))) value = info->argv[i] + strlen(flag);
    else if (!strcmp(info->argv[i], "--user-data-dir") && i + 1 < info->argc) value = info->argv[++i];
  }
  return value && !strcmp(value, profile);
}

int main(int argc, char **argv) {
  if (argc == 7 && !strcmp(argv[1], "signal")) {
    char *pid_end;
    long requested_pid = strtol(argv[2], &pid_end, 10);
    if (*pid_end || requested_pid <= 1 || requested_pid > INT_MAX) return 2;
    pid_t pid = (pid_t)requested_pid;
    struct process_info info;
    int result = read_info_bounded(pid, &info);
    if (result == 0) { release_info(&info); return 0; }
    if (result < 0) { release_info(&info); fprintf(stderr, "Cannot inspect process %d before shutdown.\n", pid); return 1; }
    char seconds[32], microseconds[32];
    snprintf(seconds, sizeof(seconds), "%llu", info.bsd.pbi_start_tvsec);
    snprintf(microseconds, sizeof(microseconds), "%llu", info.bsd.pbi_start_tvusec);
    bool matches = !strcmp(seconds, argv[3]) && !strcmp(microseconds, argv[4]) &&
      !strcmp(info.executable, argv[5]) && uses_profile(&info, argv[6]);
    release_info(&info);
    if (!matches) return 0; // PID identity changed; never signal its successor.
    if (kill(pid, SIGTERM) && errno != ESRCH) { perror("Cannot stop browser"); return 1; }
    return 0;
  }
  if (argc != 2 || strcmp(argv[1], "list")) return 2;
  int capacity = proc_listpids(PROC_UID_ONLY, getuid(), NULL, 0);
  if (capacity <= 0) { fprintf(stderr, "Cannot enumerate user processes.\n"); return 1; }
  // Leave room for processes created between the size query and enumeration.
  capacity += 4096 * sizeof(pid_t);
  pid_t *pids = malloc((size_t)capacity);
  if (!pids) return 1;
  int bytes = proc_listpids(PROC_UID_ONLY, getuid(), pids, capacity);
  if (bytes <= 0 || bytes >= capacity) { free(pids); fprintf(stderr, "Incomplete process enumeration.\n"); return 1; }
  putchar('[');
  bool first = true;
  for (int i = 0; i < bytes / (int)sizeof(pid_t); i++) {
    pid_t pid = pids[i];
    if (pid <= 1 || pid == getpid()) continue;
    struct process_info info;
    int result = read_info_bounded(pid, &info);
    if (result < 0) {
      fprintf(stderr, "Cannot inspect user process %d; refusing an incomplete browser check.\n", pid);
      release_info(&info); free(pids); return 1;
    }
    if (result == 0) { release_info(&info); continue; }
    if (!first) putchar(',');
    first = false;
    printf("{\"pid\":%d,\"startSeconds\":\"%llu\",\"startMicroseconds\":\"%llu\",\"executable\":",
      pid, info.bsd.pbi_start_tvsec, info.bsd.pbi_start_tvusec);
    json_string(info.executable);
    fputs(",\"argv\":[", stdout);
    for (int arg = 0; arg < info.argc; arg++) {
      if (arg) putchar(',');
      json_string(info.argv[arg]);
    }
    fputs("]}", stdout);
    release_info(&info);
  }
  free(pids);
  fputs("]\n", stdout);
  return 0;
}
