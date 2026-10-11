"""DueDilly agents service: FastAPI in front of the ADK agents (Pond-Guard, Ask Dilly).

Only the DueDilly app calls this service. On Cloud Run it is deployed without public access (IAM), and every
request also carries the shared token. With no model backend configured it answers 503 and the app falls back.
"""
import hmac
import json

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import StreamingResponse
from google.adk import __version__ as ADK_VERSION

from . import settings
from .models import AskRequest, AskResponse, Health, ScreenRequest

app = FastAPI(title="DueDilly agents", version="1.0.0")


def caller_is_duedilly(x_internal_token: str = Header(default="")) -> None:
  expected = settings.internal_token()
  if not expected or not hmac.compare_digest(x_internal_token, expected):
    raise HTTPException(status_code=401, detail="Only the DueDilly app may call the agents service.")


def backend_ready() -> None:
  if not settings.ready():
    raise HTTPException(status_code=503, detail="The agents have no Gemini backend or model configured. The app uses its offline fallback.")


@app.get("/healthz", response_model=Health)
@app.get("/health", response_model=Health)
def health() -> Health:
  # No secrets. /health is the path to use on Cloud Run, which reserves some paths ending in "z".
  return Health(adk_version=ADK_VERSION, backend=settings.backend(), model=settings.model() or None)


@app.post("/pond-guard/screen", dependencies=[Depends(caller_is_duedilly), Depends(backend_ready)])
async def pond_guard_screen(request: ScreenRequest) -> StreamingResponse:
  from .pond_guard import screen

  async def lines():
    async for event in screen(request):
      yield json.dumps(event, ensure_ascii=False) + "\n"

  # One JSON object per line, so the drawer can show each agent as it finishes
  return StreamingResponse(lines(), media_type="application/x-ndjson")


@app.post("/ask", response_model=AskResponse, dependencies=[Depends(caller_is_duedilly), Depends(backend_ready)])
async def ask_dilly(request: AskRequest) -> AskResponse:
  from .ask_dilly import ask

  return await ask(request)
