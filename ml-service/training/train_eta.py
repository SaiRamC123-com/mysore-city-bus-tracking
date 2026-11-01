"""Train the ETA model: how fast a bus covers a segment between two consecutive stops.

    python training/train_eta.py                                # synthetic demo data
    python training/train_eta.py --csv data/eta_segments.csv    # real logged trips

Real data comes from the server:  cd ../server && npm run export:training
That writes ml-service/data/eta_segments.csv with columns
    route_id, hour, weekday, segment_m, travel_sec
(travel_sec is DEPARTED previous stop -> ARRIVED next stop, so it excludes standing time.)

The model learns average speed (m/s), and the API returns travel_sec = segment_m / speed. Predicting
speed instead of seconds keeps the answer sensible for segment lengths it has not seen exactly.
As with the crowd model, the synthetic generator is only a stand-in until real trips are logged.
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error
from sklearn.model_selection import train_test_split

ROOT = Path(__file__).resolve().parent.parent
FEATURES = ["route_id", "hour", "weekday", "segment_m"]
MIN_REAL_ROWS = 300
MIN_SPEED_MPS, MAX_SPEED_MPS = 1.5, 14.0  # keep in sync with app/predict.py


def synthetic(n: int, seed: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    df = pd.DataFrame(
        {
            "route_id": rng.integers(1, 5, n),
            "hour": rng.integers(5, 23, n),
            "weekday": rng.integers(0, 7, n),
            "segment_m": rng.integers(200, 2500, n).astype(float),
        }
    )
    h, wd, r, seg = (df[c].to_numpy() for c in ["hour", "weekday", "route_id", "segment_m"])
    weekend = wd >= 5

    free_kmh = 23.0
    peak = np.isin(h, [8, 9, 10, 17, 18, 19])
    factor = np.ones(n)
    factor *= np.where(peak & ~weekend, 0.68, 1.0)
    factor *= np.where((h >= 11) & (h <= 15), 0.9, 1.0)
    factor *= np.where((h >= 21) | (h < 7), 1.15, 1.0)
    factor *= np.where(weekend & np.isin(r, [1, 2]) & (h >= 10) & (h <= 17), 0.85, 1.0)  # tourist traffic
    factor *= np.where(r == 1, 0.85, 1.0)  # Chamundi hill road

    # Short hops never reach cruising speed because of braking and pulling away.
    eff_mps = (free_kmh / 3.6) * factor * seg / (seg + 250.0)
    travel = (seg / eff_mps) * rng.lognormal(0, 0.12, n)
    df["travel_sec"] = travel
    return df


def load_real(path: Path, force: bool) -> pd.DataFrame:
    df = pd.read_csv(path)
    need = FEATURES + ["travel_sec"]
    missing = [c for c in need if c not in df.columns]
    if missing:
        sys.exit(f"{path} is missing columns: {missing}")
    df = df[need].dropna()
    speed = df["segment_m"] / df["travel_sec"]
    df = df[(df["segment_m"] > 30) & (df["travel_sec"] > 5) & speed.between(0.5, 20)]
    if len(df) < MIN_REAL_ROWS and not force:
        sys.exit(
            f"Only {len(df)} usable segments in {path}. Collect at least {MIN_REAL_ROWS} "
            f"(or pass --force to train anyway)."
        )
    return df


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", type=Path)
    ap.add_argument("--rows", type=int, default=30000)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    if args.csv:
        df, source = load_real(args.csv, args.force), "real"
    else:
        df, source = synthetic(args.rows), "synthetic"

    df = df.copy()
    df["speed_mps"] = (df["segment_m"] / df["travel_sec"]).clip(MIN_SPEED_MPS, MAX_SPEED_MPS)

    train, test = train_test_split(df, test_size=0.2, random_state=7)
    model = HistGradientBoostingRegressor(max_iter=250, learning_rate=0.08, max_depth=6, random_state=42)
    model.fit(train[FEATURES], train["speed_mps"])

    speed = np.clip(model.predict(test[FEATURES]), MIN_SPEED_MPS, MAX_SPEED_MPS)
    pred_sec = test["segment_m"] / speed
    mae = mean_absolute_error(test["travel_sec"], pred_sec)

    # Baseline the server uses without ML: a flat 17 km/h
    naive_sec = test["segment_m"] / (17 / 3.6)
    naive_mae = mean_absolute_error(test["travel_sec"], naive_sec)
    print(f"[{source}] rows={len(df)}  segment-time MAE={mae:.1f}s  (flat 17 km/h baseline MAE={naive_mae:.1f}s)")

    out = ROOT / "models"
    out.mkdir(exist_ok=True)
    joblib.dump(model, out / "eta_model.joblib")
    (out / "eta_model.meta.json").write_text(
        json.dumps(
            {
                "data": source,
                "rows": int(len(df)),
                "mae_seconds": round(float(mae), 1),
                "baseline_mae_seconds": round(float(naive_mae), 1),
                "features": FEATURES,
                "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            },
            indent=2,
        )
    )
    print(f"saved {out / 'eta_model.joblib'}")


if __name__ == "__main__":
    main()
