"""FastAPI wrapper. Start with:  uvicorn app.main:app --reload --port 8000

Endpoints (the Node server in ../server calls these):
  GET  /health
  POST /predict/crowd          one item
  POST /predict/crowd/batch    { "items": [...] }  -> { "predictions": [...] }
  POST /predict/eta            { "items": [...] }  -> { "model_data": "...", "predictions": [...] }
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException

from . import predict
from .schemas import CrowdBatch, CrowdItem, EtaBatch


@asynccontextmanager
async def lifespan(_app: FastAPI):
    predict.registry.load()
    yield


app = FastAPI(title="Mysuru Bus ML service", version="1.0.0", lifespan=lifespan)


def _guard(fn, *args):
    try:
        return fn(*args)
    except predict.ModelNotReady as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


@app.get("/health")
def health():
    return {"ok": True, **predict.registry.status()}


@app.post("/predict/crowd")
def crowd_one(item: CrowdItem):
    return _guard(predict.predict_crowd, [item.model_dump()])[0]


@app.post("/predict/crowd/batch")
def crowd_batch(body: CrowdBatch):
    return {"predictions": _guard(predict.predict_crowd, [i.model_dump() for i in body.items])}


@app.post("/predict/eta")
def eta(body: EtaBatch):
    return _guard(predict.predict_eta, [i.model_dump() for i in body.items])
