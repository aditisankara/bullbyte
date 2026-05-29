"""Progress-event contract for the FastAPI -> NestJS webhook relay (story 5.3).

This MUST stay byte-for-byte identical on the wire to the NestJS SSE contract in
`api/src/jobs/dto/progress-event.dto.ts`: kebab-case event names, camelCase JSON
fields, ISO8601 timestamp. NestJS relays the payload to the SSE stream untouched,
so any drift here breaks the frontend feed.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# Canonical kebab-case event names — keep in lockstep with SSE_EVENTS in NestJS.
SseEventName = Literal[
    "analysis-started",
    "transcript-fetched",
    "claims-extracted",
    "claim-verified",
    "analysis-complete",
    "analysis-failed",
]


class ProgressEvent(BaseModel):
    """One agent-step progress event.

    Attributes are snake_case (Pythonic) but serialise to the camelCase wire
    shape via aliases. Always dump with `by_alias=True` when sending.
    """

    model_config = ConfigDict(populate_by_name=True)

    event: SseEventName
    job_id: str = Field(alias="jobId")
    step_index: int = Field(alias="stepIndex", ge=0)
    total_steps: int = Field(alias="totalSteps", ge=0)
    message: str
    timestamp: str  # ISO8601
