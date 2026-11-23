"""Simulator live feed: memancarkan kejadian seperti bot_hunter.py ke bridge, memakai data scan terakhir.

Dipakai untuk mencoba mode LIVE kantor 3D tanpa menunggu bot berjalan.
  python server/live_demo.py                 # ke http://localhost:8787, token dari server/.live_token
  python server/live_demo.py --speed 3       # 3x lebih cepat
Format kejadian sama persis dengan live_feed.emit() di repo bot.
"""
import argparse
import json
import os
import random
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument("--url", default="http://localhost:8787/api/live/push")
ap.add_argument("--speed", type=float, default=1.0)
ap.add_argument("--workers", type=int, default=5)
ap.add_argument("--history", default="https://aranter.web.id/data/history.json")
args = ap.parse_args()
token = os.environ.get("LIVE_TOKEN") or open(os.path.join(HERE, ".live_token"), encoding="utf-8").read().strip()


def push(*events):
    body = json.dumps({"events": [{"ts": time.time(), **e} for e in events]}).encode("utf-8")
    req = urllib.request.Request(args.url, data=body, method="POST",
                                 headers={"Content-Type": "application/json", "X-Live-Token": token})
    print(urllib.request.urlopen(req, timeout=5).read().decode(), [e["t"] for e in events])


def wait(sec):
    time.sleep(sec / args.speed)


print("mengambil data scan terakhir…")
with urllib.request.urlopen(args.history + "?v=" + str(int(time.time())), timeout=60) as r:
    hist = json.loads(r.read().decode("utf-8"))
day = sorted(hist["daily_scans"])[-1]
stocks = hist["daily_scans"][day]["stocks"]
print(f"{len(stocks)} saham dari scan {day}")

push({"t": "session", "status": "OPEN", "name": "Sesi I (DEMO)", "session": "SESI_1"})
wait(2)
push({"t": "cycle_start", "total": len(stocks), "realtime": True, "screener": len(stocks),
      "symbols": [s["symbol"] for s in stocks]})
t0 = time.time()
for i, s in enumerate(stocks, 1):
    wait(random.uniform(0.5, 1.1))
    ev = [{"t": "stock", "worker": (i - 1) % args.workers + 1, "idx": i, "total": len(stocks),
           "dur": round(random.uniform(3, 8), 1), "stock": s}]
    if (s.get("count_green") or 0) >= 3 and random.random() < 0.6:
        ev.append({"t": "alert", "symbol": s["symbol"], "signals": 2})
    push(*ev)
push({"t": "cycle_done", "count": len(stocks), "secs": round(time.time() - t0, 1)})
wait(3)
push({"t": "saved", "last_updated": time.strftime("%Y-%m-%d %H:%M:%S WIB")})
print("selesai. Kantor tetap LIVE ±8 menit sejak kejadian terakhir, lalu kembali ke replay.")
