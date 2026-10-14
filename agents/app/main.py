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
from .models import AskRequest, AskResponse, CountryRiskRequest, CountryRiskResponse, DillyRequest, DillyResponse, ExtractRequest, ExtractResponse, Health, ProposeFixRequest, ProposeFixResponse, ScreenRequest

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


@app.post("/crawler/extract", response_model=ExtractResponse, dependencies=[Depends(caller_is_duedilly), Depends(backend_ready)])
async def crawler_extract(request: ExtractRequest) -> ExtractResponse:
  from .crawler import extract

  try:
    return await extract(request)
  except Exception as err:  # the app then uses its offline extractor
    raise HTTPException(status_code=502, detail=f"The crawler agent could not read the page: {str(err)[:200]}")


@app.post("/crawler/propose-fix", response_model=ProposeFixResponse, dependencies=[Depends(caller_is_duedilly), Depends(backend_ready)])
async def crawler_propose_fix(request: ProposeFixRequest) -> ProposeFixResponse:
  from .crawler import propose_fix

  try:
    return await propose_fix(request)
  except Exception as err:
    raise HTTPException(status_code=502, detail=f"The crawler agent could not suggest a fix: {str(err)[:200]}")


@app.post("/country-risk/extract", response_model=CountryRiskResponse, dependencies=[Depends(caller_is_duedilly), Depends(backend_ready)])
async def country_risk_extract(request: CountryRiskRequest) -> CountryRiskResponse:
  from .country_risk import extract

  try:
    return await extract(request)
  except Exception as err:  # the app then keeps its last good data
    raise HTTPException(status_code=502, detail=f"The country risk agent could not read the page: {str(err)[:200]}")


@app.post("/pond-guard/dilly", response_model=DillyResponse, dependencies=[Depends(caller_is_duedilly), Depends(backend_ready)])
async def pond_guard_dilly(request: DillyRequest) -> DillyResponse:
  from .pond_guard import orchestrate

  try:
    return await orchestrate(request)
  except Exception as err:  # the findings, the score and the route stand without Dilly's text
    raise HTTPException(status_code=502, detail=f"Dilly could not sum up the screening: {str(err)[:200]}")
