"""Model loading and prediction.

No web-framework imports here on purpose: this file can be imported and tested on its own
(see tests/test_predict.py). app/main.py is a thin FastAPI wrapper around it.
"""
import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / "models"

# Column order the models were trained with. Training scripts use the same lists.
CROWD_FEATURES = ["route_id", "stop_seq", "hour", "weekday", "is_festival", "is_raining"]
ETA_FEATURES = ["route_id", "hour", "weekday", "segment_m"]

# The ETA model predicts average speed; these bounds stop a bad prediction from giving absurd times.
MIN_SPEED_MPS = 1.5   # ~5 km/h
MAX_SPEED_MPS = 14.0  # ~50 km/h


class ModelNotReady(RuntimeError):
    """Raised when a model file has not been trained yet."""


def level_of(pct: float) -> str:
    # Same thresholds as server/src/services/crowdService.js
    return "low" if pct < 50 else "medium" if pct < 80 else "high"


def describe(meta: dict) -> str:
    """Short, honest label for what the model was trained on. The UI and chatbot show it."""
    if not meta:
        return "unknown"
    if meta.get("data") == "synthetic":
        return "synthetic demo data (not real Mysuru traffic)"
    return f"{meta.get('rows')} real logged rows"


class Registry:
    def __init__(self) -> None:
        self.crowd = None
        self.eta = None
        self.crowd_meta: dict = {}
        self.eta_meta: dict = {}

    def load(self) -> None:
        self.crowd, self.crowd_meta = self._load("crowd_model")
        self.eta, self.eta_meta = self._load("eta_model")

    @staticmethod
    def _load(name: str):
        model_path = MODELS / f"{name}.joblib"
        meta_path = MODELS / f"{name}.meta.json"
        if not model_path.exists():
            return None, {}
        meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
        return joblib.load(model_path), meta

    def status(self) -> dict:
        return {
            "crowd_model": self.crowd is not None,
            "eta_model": self.eta is not None,
            "crowd_data": describe(self.crowd_meta) if self.crowd is not None else None,
            "eta_data": describe(self.eta_meta) if self.eta is not None else None,
        }


registry = Registry()


def predict_crowd(items: list[dict]) -> list[dict]:
    if registry.crowd is None:
        raise ModelNotReady("Crowd model not trained yet. Run: python training/train_crowd.py")
    df = pd.DataFrame(items)[CROWD_FEATURES]
    pct = np.clip(registry.crowd.predict(df), 0, 100)
    label = describe(registry.crowd_meta)
    return [
        {"occupancy_pct": round(float(p), 1), "level": level_of(float(p)), "model_data": label}
        for p in pct
    ]


def predict_eta(items: list[dict]) -> dict:
    if registry.eta is None:
        raise ModelNotReady("ETA model not trained yet. Run: python training/train_eta.py")
    df = pd.DataFrame(items)[ETA_FEATURES]
    speed = np.clip(registry.eta.predict(df), MIN_SPEED_MPS, MAX_SPEED_MPS)
    seg = df["segment_m"].to_numpy(dtype=float)
    return {
        "model_data": describe(registry.eta_meta),
        "predictions": [
            {"travel_sec": round(float(s / v), 1), "speed_kmh": round(float(v * 3.6), 1)}
            for s, v in zip(seg, speed)
        ],
    }
