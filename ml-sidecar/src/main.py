from fastapi import FastAPI

app = FastAPI(title="BullByte ML Sidecar", version="0.1.0")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "ml-sidecar"}
