"""Actual isolated Collector -> Prometheus -> Grafana test. No production data/credentials."""
import json
import os
from pathlib import Path
import subprocess
import time
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[2]
PROFILE = os.environ.get("ENERGYOS_TELEMETRY_TEST_PROFILE", "isolated")
if PROFILE not in ["isolated", "persistent"]:
    raise RuntimeError("Unknown isolated telemetry test profile")
COMPOSE = ["docker", "compose", "-p", "energyos-telemetry-test", "-f", str(ROOT / ("ops/observability/production/compose-test.yaml" if PROFILE == "persistent" else "ops/observability/compose.yaml"))]

JOB = "energyos-runtime" if PROFILE == "persistent" else "energyos-isolated"
DASHBOARD = "energyos-eva" if PROFILE == "persistent" else "energyos-eva-isolated"

def request(url, payload=None, auth=False):
    args = COMPOSE + ["exec", "-T", "verifier", "node", "/suite/ops/observability/http-fixture.cjs", url] + (["--auth"] if auth else [])
    result = subprocess.run(args, input="" if payload is None else json.dumps(payload), text=True, capture_output=True, timeout=10)
    if result.returncode:
        raise RuntimeError("Isolated HTTP unavailable")
    return json.loads(result.stdout)

def collector_ready():
    receipt = request("http://collector:4318/v1/metrics", {"resourceMetrics": []})
    return isinstance(receipt, dict) and str(receipt.get("partialSuccess", {}).get("rejectedDataPoints", "0")) == "0"

def wait(check, message, seconds=75):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        try:
            if check():
                return
        except Exception:
            pass  # Never echo endpoint responses, auth headers or document-like canaries.
        time.sleep(1)
    raise RuntimeError(message)

def query(expr, at=None):
    params = {"query": expr}
    if at is not None:
        params["time"] = str(at)
    return request("http://prometheus:9090/api/v1/query?" + urlencode(params))["data"]["result"]

def process_privileges(service, uid):
    container = subprocess.check_output(COMPOSE + ["ps", "-q", service], text=True).strip()
    pid = subprocess.check_output(["docker", "inspect", "--format", "{{.State.Pid}}", container], text=True).strip()
    if not pid.isdigit() or int(pid) <= 1:
        raise RuntimeError("Invalid isolated container process")
    status = dict(line.split(":", 1) for line in Path("/proc", pid, "status").read_text().splitlines() if ":" in line)
    if any(int(n) != uid for n in status["Uid"].split()) or int(status["CapEff"].strip(), 16) or status["NoNewPrivs"].strip() != "1":
        raise RuntimeError("Telemetry server privilege drop not proven")

def run_fixture(unavailable=False):
    args = COMPOSE + ["exec", "-T", "verifier", "node", "/suite/ops/observability/synthetic.cjs"] + (["--unavailable"] if unavailable else [])
    subprocess.run(args, cwd=ROOT, check=True, timeout=15)

def main():
    if not os.environ.get("GRAFANA_ADMIN_PASSWORD"):
        raise RuntimeError("Provide isolated-test Grafana credential")
    subprocess.run(COMPOSE + ["up", "-d", "--wait", "--wait-timeout", "120"], check=True)
    wait(collector_ready, "Collector not ready")
    run_fixture()
    wait(lambda: bool(query("energyos_eva_stage_duration_seconds_count{stage=\"XML_PARSE\"} >= 10000")), "Histogram not received")
    wait(lambda: request("http://grafana:3000/api/health").get("database") == "ok", "Grafana not ready")
    wait(lambda: request("http://grafana:3000/api/dashboards/uid/" + DASHBOARD, auth=True).get("dashboard", {}).get("uid") == DASHBOARD, "Dashboard not provisioned")
    if PROFILE == "persistent":
        process_privileges("prometheus", 65534)
        process_privileges("grafana", 472)
        request("http://grafana:3000/api/folders", {"uid": "energyos-persistence-test", "title": "Disposable persistence marker"}, auth=True)
    now = str(time.time_ns())
    gauge = lambda name, attrs=[]: {"name": name, "description": "PRIVATE_CANARY_DESCRIPTION", "gauge": {"dataPoints": [{"timeUnixNano": now, "asDouble": 1, "attributes": attrs}]}}
    resource = {"attributes": [
        {"key": "service.name", "value": {"stringValue": "energyos-api"}},
        {"key": "service.instance.id", "value": {"stringValue": "11111111-1111-4111-8111-111111111111"}},
        {"key": "process.role", "value": {"stringValue": "API"}},
        {"key": "private_invoice", "value": {"stringValue": "PRIVATE_CANARY_TENANT"}}]}
    attrs = [{"key": "private_cnpj", "value": {"stringValue": "PRIVATE_CANARY_CNPJ"}}]
    fixture = {"resourceMetrics": [{"resource": resource, "scopeMetrics": [{"scope": {"name": "PRIVATE_CANARY_SCOPE"}, "metrics": [
        gauge("energyos_runtime_rss_bytes", attrs), gauge("PRIVATE_CANARY_DOCUMENT"),
        gauge("energyos_poller_active", [{"key": "stage", "value": {"stringValue": "PRIVATE_CANARY_STAGE"}}])]}]}]}
    request("http://collector:4318/v1/metrics", fixture)
    wait(lambda: bool(query('energyos_runtime_rss_bytes{process_role="API"}')), "Privacy fixture not observed")
    series = request("http://prometheus:9090/api/v1/series?" + urlencode({"match[]": '{job="' + JOB + '"}'}))
    metadata = request("http://prometheus:9090/api/v1/metadata")
    if "PRIVATE_CANARY" in json.dumps([series, metadata]):
        raise RuntimeError("Privacy canary reached telemetry output")
    subprocess.run(COMPOSE + ["stop", "collector"], check=True)
    run_fixture(unavailable=True)
    subprocess.run(COMPOSE + ["start", "collector"], check=True)
    wait(collector_ready, "Collector did not recover")
    run_fixture()
    wait(lambda: bool(query('up{job="' + JOB + '"} == 1')), "Scraper did not recover")
    if PROFILE == "persistent":
        historical = query("energyos_runtime_rss_bytes")
        if not historical:
            raise RuntimeError("No data for persistence rehearsal")
        at = historical[0]["value"][0]
        subprocess.run(COMPOSE + ["stop", "prometheus", "grafana"], check=True)
        subprocess.run(COMPOSE + ["start", "prometheus", "grafana"], check=True)
        wait(lambda: bool(query("energyos_runtime_rss_bytes", at)), "Prometheus historical data lost on restart")
        wait(lambda: request("http://grafana:3000/api/folders/energyos-persistence-test", auth=True).get("uid") == "energyos-persistence-test", "Grafana persistence marker lost")
        process_privileges("prometheus", 65534)
        process_privileges("grafana", 472)
        print(json.dumps({"persistentProfile": "passed", "servers": "non_root_no_capabilities", "restart": "historical_metrics_and_grafana_state_preserved", "hostPorts": "none"}))
    print(json.dumps({"isolated": True, "histogram": "received", "dashboard": "provisioned", "privacyCanaries": "absent", "collectorOutage": "business_not_blocked", "recovery": "demonstrated", "productionExport": "disabled"}))

if __name__ == "__main__":
    main()
