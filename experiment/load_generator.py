"""Open-loop Poisson load generator that sends traffic through the API gateway.

Request mix (per arrival): 55 % create order, 25 % get order, 12 % list products,
8 % list accounts. Every two minutes products are restocked and accounts topped up so
that the system does not drift into permanent out-of-stock / declined states.

Arrivals are scheduled independently of response times (open loop), so a slow service does
not reduce the offered load - the same way real users keep arriving during an incident.

Usage:
    python load_generator.py --gateway http://localhost:8080 --rps 5 --duration-min 10
"""
from __future__ import annotations

import argparse
import collections
import logging
import random
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

import requests

PRODUCTS = [f"P-{i}" for i in range(100, 106)]
CUSTOMERS = [f"C-{i:03d}" for i in range(1, 21)]
# Customers seeded with a small balance by payment-service (every 7th) are not topped up,
# so a share of their payments keeps being declined: normal business noise.
TOPUP_CUSTOMERS = [c for i, c in enumerate(CUSTOMERS, start=1) if i % 7 != 0]

MIX = (
    ("create_order", 0.55),
    ("get_order", 0.25),
    ("list_products", 0.12),
    ("list_accounts", 0.08),
)

log = logging.getLogger("load_generator")


@dataclass
class Stats:
    sent: int = 0
    by_status: collections.Counter = field(default_factory=collections.Counter)
    errors: int = 0
    lock: threading.Lock = field(default_factory=threading.Lock)

    def record(self, status: int | None) -> None:
        with self.lock:
            self.sent += 1
            if status is None:
                self.errors += 1
            else:
                self.by_status[status // 100 * 100] += 1

    def snapshot(self) -> dict:
        with self.lock:
            return {
                "sent": self.sent,
                "transport_errors": self.errors,
                "status_classes": {f"{k // 100}xx": v for k, v in sorted(self.by_status.items())},
            }


class LoadGenerator:
    """Generates traffic until :meth:`stop` is called."""

    def __init__(self, gateway: str, rps: float = 5.0, seed: int = 42,
                 maintenance_interval_s: float = 120.0, request_timeout_s: float = 15.0,
                 max_workers: int = 64):
        if rps <= 0:
            raise ValueError("rps must be positive")
        self.gateway = gateway.rstrip("/")
        self.rps = rps
        self.random = random.Random(seed)
        self.maintenance_interval_s = maintenance_interval_s
        self.request_timeout_s = request_timeout_s
        self.stats = Stats()
        self._order_ids: collections.deque[str] = collections.deque(maxlen=500)
        self._ids_lock = threading.Lock()
        self._stop = threading.Event()
        self._pool = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="load")
        self._local = threading.local()
        self._threads: list[threading.Thread] = []

    # -- lifecycle ---------------------------------------------------------------------
    def start(self) -> None:
        self._stop.clear()
        for target, name in ((self._arrivals, "arrivals"), (self._maintenance, "maintenance")):
            t = threading.Thread(target=target, name=name, daemon=True)
            t.start()
            self._threads.append(t)
        log.info("load generator started: %.2f req/s against %s", self.rps, self.gateway)

    def stop(self) -> None:
        self._stop.set()
        for t in self._threads:
            t.join(timeout=5)
        self._pool.shutdown(wait=True, cancel_futures=True)
        log.info("load generator stopped: %s", self.stats.snapshot())

    # -- loops -------------------------------------------------------------------------
    def _arrivals(self) -> None:
        next_at = time.monotonic()
        while not self._stop.is_set():
            next_at += self.random.expovariate(self.rps)
            delay = next_at - time.monotonic()
            if delay > 0 and self._stop.wait(delay):
                return
            action = self._choose_action()
            self._pool.submit(self._safe, action)

    def _maintenance(self) -> None:
        while not self._stop.wait(self.maintenance_interval_s):
            for product in PRODUCTS:
                self._request("POST", f"/api/products/{product}/restock", json={"quantity": 150})
            for customer in TOPUP_CUSTOMERS:
                self._request("POST", f"/api/accounts/{customer}/topup", json={"amount": 5000})

    # -- actions -----------------------------------------------------------------------
    def _choose_action(self) -> str:
        r = self.random.random()
        acc = 0.0
        for name, p in MIX:
            acc += p
            if r < acc:
                return name
        return MIX[-1][0]

    def _safe(self, action: str) -> None:
        try:
            getattr(self, action)()
        except Exception:  # noqa: BLE001 - a load generator must never die on one request
            log.exception("action %s failed unexpectedly", action)

    def create_order(self) -> None:
        with self._ids_lock:
            customer = self.random.choice(CUSTOMERS)
            product = self.random.choice(PRODUCTS)
            quantity = self.random.randint(1, 3)
        response = self._request("POST", "/api/orders",
                                 json={"customerId": customer, "productId": product, "quantity": quantity})
        if response is not None and response.status_code == 202:
            try:
                order_id = response.json()["id"]
            except (ValueError, KeyError):
                return
            with self._ids_lock:
                self._order_ids.append(order_id)

    def get_order(self) -> None:
        with self._ids_lock:
            if not self._order_ids:
                order_id = None
            else:
                order_id = self.random.choice(self._order_ids)
        if order_id is None:
            self.list_products()
            return
        self._request("GET", f"/api/orders/{order_id}")

    def list_products(self) -> None:
        self._request("GET", "/api/products")

    def list_accounts(self) -> None:
        self._request("GET", "/api/accounts")

    # -- http --------------------------------------------------------------------------
    def _session(self) -> requests.Session:
        session = getattr(self._local, "session", None)
        if session is None:
            session = requests.Session()
            self._local.session = session
        return session

    def _request(self, method: str, path: str, **kwargs) -> requests.Response | None:
        try:
            response = self._session().request(method, self.gateway + path,
                                               timeout=self.request_timeout_s, **kwargs)
        except requests.RequestException:
            self.stats.record(None)
            return None
        self.stats.record(response.status_code)
        return response


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--gateway", default="http://localhost:8080")
    parser.add_argument("--rps", type=float, default=5.0)
    parser.add_argument("--duration-min", type=float, default=10.0)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    generator = LoadGenerator(args.gateway, rps=args.rps, seed=args.seed)
    generator.start()
    try:
        time.sleep(args.duration_min * 60)
    except KeyboardInterrupt:
        pass
    finally:
        generator.stop()


if __name__ == "__main__":
    main()
