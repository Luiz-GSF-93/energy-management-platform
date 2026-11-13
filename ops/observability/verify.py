"""Actual isolated Collector -> Prometheus -> Grafana test. No production data/credentials."""
import base64
import json
import os
from pathlib import Path
import subprocess
import time
from urllib.request import Request, urlopen
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = ["docker", "compose", "-p", "energyos-telemetry-test", "-f", str(ROOT / "ops/observability/compose.yaml")]

def request(url, payload=None, auth=False):
    headers = {"Content-Type": "application/json"}
    if auth:
        credential = "energyosowner:" + os.environ["GRAFANA_ADMIN_PASSWORD"]
        headers["Authorization"] = "Basic " + base64.b64encode(credential.encode()).decode()
    with urlopen(Request(url, data=None if payload is None else json.dumps(payload).encode(), headers=headers), timeout=4) as response:
        return json.load(response)

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

def query(expr):
    return request("http://127.0.0.1:19090/api/v1/query?" + urlencode({"query": expr}))["data"]["result"]

def run_fixture(unavailable=False):
    args = ["node", "ops/observability/synthetic.cjs"] + (["--unavailable"] if unavailable else [])
    subprocess.run(args, cwd=ROOT, check=True, timeout=15)

def main():
    if not os.environ.get("GRAFANA_ADMIN_PASSWORD"):
        raise RuntimeError("Provide isolated-test Grafana credential")
    subprocess.run(COMPOSE + ["up", "-d", "--wait", "--wait-timeout", "120"], check=True)
    wait(lambda: request("http://127.0.0.1:14318/v1/metrics", {"resourceMetrics": []}) == {}, "Collector not ready")
    run_fixture()
    wait(lambda: bool(query("energyos_eva_stage_duration_seconds_count{stage=\"XML_PARSE\"} >= 10000")), "Histogram not received")
    wait(lambda: request("http://127.0.0.1:13000/api/health").get("database") == "ok", "Grafana not ready")
    wait(lambda: request("http://127.0.0.1:13000/api/dashboards/uid/energyos-eva-isolated", auth=True).get("dashboard", {}).get("uid") == "energyos-eva-isolated", "Dashboard not provisioned")
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
    request("http://127.0.0.1:14318/v1/metrics", fixture)
    wait(lambda: bool(query('energyos_runtime_rss_bytes{process_role="API"}')), "Privacy fixture not observed")
    series = request("http://127.0.0.1:19090/api/v1/series?" + urlencode({"match[]": '{job="energyos-isolated"}'}))
    metadata = request("http://127.0.0.1:19090/api/v1/metadata")
    if "PRIVATE_CANARY" in json.dumps([series, metadata]):
        raise RuntimeError("Privacy canary reached telemetry output")
    subprocess.run(COMPOSE + ["stop", "collector"], check=True)
    run_fixture(unavailable=True)
    subprocess.run(COMPOSE + ["start", "collector"], check=True)
    wait(lambda: request("http://127.0.0.1:14318/v1/metrics", {"resourceMetrics": []}) == {}, "Collector did not recover")
    run_fixture()
    wait(lambda: bool(query('up{job="energyos-isolated"} == 1')), "Scraper did not recover")
    print(json.dumps({"isolated": True, "histogram": "received", "dashboard": "provisioned", "privacyCanaries": "absent", "collectorOutage": "business_not_blocked", "recovery": "demonstrated", "productionExport": "disabled"}))

if __name__ == "__main__":
    main()
