"""Train the crowd (bus occupancy %) model.

    python training/train_crowd.py                              # synthetic demo data
    python training/train_crowd.py --csv data/crowd_logs.csv    # real logged data (see below)

Real data comes from the server:  cd ../server && npm run export:training
That writes ml-service/data/crowd_logs.csv with columns
    route_id, stop_seq, hour, weekday, is_festival, is_raining, occupancy_pct

The synthetic generator encodes plausible Mysuru patterns (commute peaks, Chamundi Hills and Zoo
on weekends, Dasara). It is NOT measured data: a model trained on it only shows the pipeline works.
Replace it with real logs before claiming accuracy.
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
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.model_selection import train_test_split

ROOT = Path(__file__).resolve().parent.parent
FEATURES = ["route_id", "stop_seq", "hour", "weekday", "is_festival", "is_raining"]
TARGET = "occupancy_pct"
MIN_REAL_ROWS = 300


def synthetic(n: int, seed: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    df = pd.DataFrame(
        {
            "route_id": rng.integers(1, 5, n),       # 1 Chamundi, 2 Zoo/Karanji, 3 Kuvempunagar, 4 Vijayanagar
            "stop_seq": rng.integers(1, 9, n),
            "hour": rng.integers(5, 23, n),
            "weekday": rng.integers(0, 7, n),        # Monday = 0
            "is_festival": rng.choice([0, 1], n, p=[0.93, 0.07]),
            "is_raining": rng.choice([0, 1], n, p=[0.85, 0.15]),
        }
    )
    h, wd, r = df["hour"].to_numpy(), df["weekday"].to_numpy(), df["route_id"].to_numpy()
    weekend = (wd >= 5).astype(float)

    morning = np.exp(-(((h - 8.5) / 1.3) ** 2)) * 30
    evening = np.exp(-(((h - 17.5) / 1.5) ** 2)) * 32
    commute_route = np.isin(r, [3, 4])
    commute = (morning + evening) * np.where(commute_route, 1.2, 0.8) * np.where(weekend == 1, 0.45, 1.0)

    midday = ((h >= 10) & (h <= 16)).astype(float)
    tourist = np.where(r == 1, 18, np.where(r == 2, 14, 0)) * weekend * (0.6 + 0.4 * midday)

    centre = 6 * np.sin(np.pi * (df["stop_seq"].to_numpy() - 1) / 6)
    festival = df["is_festival"].to_numpy() * np.where(np.isin(r, [1, 2]), 25, 15)
    rain = df["is_raining"].to_numpy() * 8
    night = np.where(h >= 21, -18, 0) + np.where(h < 7, -10, 0)

    y = 28 + commute + tourist + centre + festival + rain + night + rng.normal(0, 5, n)
    df[TARGET] = np.clip(y, 2, 100)
    return df


def load_real(path: Path, force: bool) -> pd.DataFrame:
    df = pd.read_csv(path)
    missing = [c for c in FEATURES + [TARGET] if c not in df.columns]
    if missing:
        sys.exit(f"{path} is missing columns: {missing}")
    df = df[FEATURES + [TARGET]].dropna()
    df[TARGET] = df[TARGET].clip(0, 100)
    if len(df) < MIN_REAL_ROWS and not force:
        sys.exit(
            f"Only {len(df)} usable rows in {path}. Collect at least {MIN_REAL_ROWS} "
            f"(or pass --force to train anyway)."
        )
    return df


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", type=Path, help="train on real logged data instead of synthetic")
    ap.add_argument("--rows", type=int, default=30000, help="synthetic rows")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    if args.csv:
        df, source = load_real(args.csv, args.force), "real"
    else:
        df, source = synthetic(args.rows), "synthetic"

    X_train, X_test, y_train, y_test = train_test_split(df[FEATURES], df[TARGET], test_size=0.2, random_state=7)
    model = HistGradientBoostingRegressor(max_iter=300, learning_rate=0.08, max_depth=6, random_state=42)
    model.fit(X_train, y_train)

    pred = np.clip(model.predict(X_test), 0, 100)
    mae, r2 = mean_absolute_error(y_test, pred), r2_score(y_test, pred)
    baseline = mean_absolute_error(y_test, np.full(len(y_test), y_train.mean()))
    print(f"[{source}] rows={len(df)}  MAE={mae:.2f} pts  R2={r2:.3f}  (predict-the-mean MAE={baseline:.2f})")

    out = ROOT / "models"
    out.mkdir(exist_ok=True)
    joblib.dump(model, out / "crowd_model.joblib")
    (out / "crowd_model.meta.json").write_text(
        json.dumps(
            {
                "data": source,
                "rows": int(len(df)),
                "mae_pct_points": round(float(mae), 2),
                "r2": round(float(r2), 3),
                "features": FEATURES,
                "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            },
            indent=2,
        )
    )
    print(f"saved {out / 'crowd_model.joblib'}")


if __name__ == "__main__":
    main()
