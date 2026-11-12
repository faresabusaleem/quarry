"""In-process rate limiting for the public demo.

Two layers protect the free LLM quota: a sliding window per client IP, and a global daily
cap that holds no matter how many IPs a caller rotates through. A concurrency cap keeps a
burst from queueing more agent runs than the provider's per-minute quota can serve.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass


@dataclass
class Decision:
    allowed: bool
    reason: str = ""
    retry_after_s: int = 0
    remaining_hour: int = 0
    remaining_day: int = 0


class RateLimiter:
    def __init__(self, per_ip_hour: int, global_day: int, max_concurrent: int = 2):
        self.per_ip_hour = per_ip_hour
        self.global_day = global_day
        self.hits: dict[str, deque[float]] = defaultdict(deque)
        self.day: deque[float] = deque()
        self.lock = threading.Lock()
        self.slots = threading.BoundedSemaphore(max_concurrent)

    def check(self, ip: str, now: float | None = None) -> Decision:
        now = time.time() if now is None else now
        with self.lock:
            q = self.hits[ip]
            while q and now - q[0] >= 3600:
                q.popleft()
            while self.day and now - self.day[0] >= 86_400:
                self.day.popleft()
            if len(self.day) >= self.global_day:
                wait = int(86_400 - (now - self.day[0])) + 1
                return Decision(False, "daily_limit", wait, self.per_ip_hour - len(q), 0)
            if len(q) >= self.per_ip_hour:
                wait = int(3600 - (now - q[0])) + 1
                return Decision(False, "hourly_limit", wait, 0, self.global_day - len(self.day))
            q.append(now)
            self.day.append(now)
            return Decision(
                True,
                remaining_hour=self.per_ip_hour - len(q),
                remaining_day=self.global_day - len(self.day),
            )

    def status(self, ip: str) -> dict[str, int]:
        now = time.time()
        with self.lock:
            q = [t for t in self.hits.get(ip, ()) if now - t < 3600]
            day = [t for t in self.day if now - t < 86_400]
        return {
            "remaining_hour": max(0, self.per_ip_hour - len(q)),
            "remaining_day": max(0, self.global_day - len(day)),
            "per_ip_hour": self.per_ip_hour,
            "global_day": self.global_day,
        }
