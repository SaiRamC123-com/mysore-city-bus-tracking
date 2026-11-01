"""Request bodies. Field names match what server/src/services (crowdService, etaService) send."""
from pydantic import BaseModel, Field


class CrowdItem(BaseModel):
    route_id: int = Field(ge=0, le=99, description="ML route id (mlId in routes.seed.json)")
    stop_seq: int = Field(ge=1, le=60, description="1-based position of the stop on the route")
    hour: int = Field(ge=0, le=23, description="Hour of day, IST")
    weekday: int = Field(ge=0, le=6, description="Monday = 0 ... Sunday = 6")
    is_festival: int = Field(default=0, ge=0, le=1)
    is_raining: int = Field(default=0, ge=0, le=1)


class CrowdBatch(BaseModel):
    items: list[CrowdItem] = Field(min_length=1, max_length=200)


class EtaItem(BaseModel):
    route_id: int = Field(ge=0, le=99)
    hour: int = Field(ge=0, le=23)
    weekday: int = Field(ge=0, le=6)
    segment_m: float = Field(ge=10, le=20000, description="Road distance between two consecutive stops")


class EtaBatch(BaseModel):
    items: list[EtaItem] = Field(min_length=1, max_length=200)
