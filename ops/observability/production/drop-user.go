// Fixed-path volume initialization; the telemetry servers never run as root.
package main

import (
 "os"
 "syscall"
)

func fail() { os.Stderr.WriteString("TELEMETRY_INIT_FAILED\n"); os.Exit(1) }
func main() {
 if len(os.Args) != 2 { fail() }
 var uid int
 var dir, program string
 var args []string
 switch os.Args[1] {
 case "prometheus":
  uid, dir, program = 65534, "/data/prometheus", "/bin/prometheus"
  args = []string{program, "--config.file=/etc/prometheus/prometheus.yml", "--storage.tsdb.path="+dir, "--storage.tsdb.retention.time=72h", "--storage.tsdb.retention.size=512MB", "--storage.tsdb.wal-compression", "--query.timeout=5s", "--query.max-concurrency=2", "--query.max-samples=100000"}
 case "grafana":
  if len(os.Getenv("GF_SECURITY_ADMIN_PASSWORD")) < 32 { fail() }
  uid, dir, program = 472, "/data/grafana", "/run.sh"
  args = []string{program}
 default: fail()
 }
 parent, err := os.Lstat("/data")
 if err != nil || !parent.IsDir() || parent.Mode()&os.ModeSymlink != 0 { fail() }
 if err := os.Mkdir(dir, 0750); err != nil && !os.IsExist(err) { fail() }
 target, err := os.Lstat(dir)
 if err != nil || !target.IsDir() || target.Mode()&os.ModeSymlink != 0 { fail() }
 if os.Geteuid() == 0 {
  if os.Chmod("/data", 0755) != nil || os.Chown(dir, uid, uid) != nil || syscall.Setgroups([]int{}) != nil || syscall.Setgid(uid) != nil || syscall.Setuid(uid) != nil { fail() }
 }
 if os.Geteuid() != uid || os.Geteuid() == 0 { fail() }
 // PR_SET_NO_NEW_PRIVS survives exec; the listener cannot regain privileges.
 _, _, errno := syscall.RawSyscall(syscall.SYS_PRCTL, 38, 1, 0)
 if errno != 0 { fail() }
 if syscall.Exec(program, args, os.Environ()) != nil { fail() }
}
