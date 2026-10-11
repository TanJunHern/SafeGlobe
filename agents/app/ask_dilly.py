"""Ask Dilly: an ADK agent with read-only tools over DueDilly data. It has no tool that changes anything.

The tools call a small read-only API on the DueDilly app. Reading a link the user pastes is done by a separate
agent that holds the Gemini URL context tool, because a built-in tool cannot be combined with other tools.
"""
import re

import httpx
from google.adk.agents import LlmAgent
from google.adk.runners import InMemoryRunner
from google.adk.tools import AgentTool, url_context
from google.genai import types

from . import settings
from .models import AskRequest, AskResponse

APP_NAME = "duedilly_ask_dilly"


def _get(path: str, params: dict | None = None) -> dict:
  base = settings.app_url()
  if not base:
    return {"error": "DueDilly data is not reachable from the agents service (DUEDILLY_INTERNAL_URL is not set)."}
  try:
    res = httpx.get(f"{base}/internal/ask-tools{path}", params=params, headers={"x-internal-token": settings.internal_token()}, timeout=10)
    if res.status_code != 200:
      return {"error": f"DueDilly answered {res.status_code}."}
    return res.json()
  except httpx.HTTPError as err:
    return {"error": f"DueDilly could not be reached: {err}"}


def search_counterparties(query: str) -> dict:
  """Finds counterparties (organisations, people, vessels) in DueDilly by name, registration number or IMO.

  Args:
    query: A name or part of one, a registration number or an IMO number. Empty lists everything.
  """
  return _get("/counterparties", {"q": query})


def get_case(entity_id: str) -> dict:
  """Gets one counterparty's case: profile, risk, confidence, route, owner, and decision if there is one.

  Args:
    entity_id: The counterparty id returned by search_counterparties.
  """
  return _get(f"/cases/{entity_id}")


def list_alerts(limit: int = 10) -> dict:
  """Lists the latest alerts (Ripples), newest first.

  Args:
    limit: How many alerts to return, 1 to 50.
  """
  return _get("/alerts", {"limit": max(1, min(50, limit))})


def get_risk_breakdown(entity_id: str) -> dict:
  """Explains how a counterparty's risk score was reached: each finding, its points, rule, policy clause and source.

  Args:
    entity_id: The counterparty id returned by search_counterparties.
  """
  return _get(f"/breakdown/{entity_id}")


INSTRUCTION = (
  "You are Dilly, the DueDilly compliance assistant. Answer questions about the counterparties, cases, alerts and risk scores in DueDilly.\n"
  "- Use the tools to look things up. Never answer about DueDilly data from memory.\n"
  "- You can only read. If asked to change, approve, reject or delete something, say a person must do that in DueDilly.\n"
  "- The risk score comes from DueDilly's points table. Quote it from get_risk_breakdown; never estimate one yourself.\n"
  "- When you mention a counterparty, give its name and its id in square brackets, like [aurora], so the app can link it.\n"
  "- When the user pastes a link, use read_link to read it, and say what the page says.\n"
  "- All counterparties in this demo are fictional. Be brief and plain. If you do not know, say so."
)


def build_agent() -> LlmAgent:
  reader = LlmAgent(
    name="read_link", model=settings.model(),
    description="Reads the web page at a URL the user pasted and reports what it says.",
    instruction="Read the page at the URL you are given and summarise what it says in a few plain sentences. Quote key facts exactly. If the page cannot be read, say so.",
    tools=[url_context],
  )
  return LlmAgent(
    name="ask_dilly", model=settings.model(), instruction=lambda ctx: INSTRUCTION,
    tools=[search_counterparties, get_case, list_alerts, get_risk_breakdown, AgentTool(agent=reader)],
  )


async def ask(request: AskRequest) -> AskResponse:
  runner = InMemoryRunner(agent=build_agent(), app_name=APP_NAME)
  session = await runner.session_service.create_session(app_name=APP_NAME, user_id="duedilly")
  message = types.Content(role="user", parts=[types.Part(text=request.question)])
  answer, tools_used = "", []
  async for event in runner.run_async(user_id="duedilly", session_id=session.id, new_message=message):
    for part in (event.content.parts if event.content and event.content.parts else []):
      call = getattr(part, "function_call", None)
      if call is not None and call.name and call.name not in tools_used:
        tools_used.append(call.name)
    if event.author == "ask_dilly" and event.is_final_response() and event.content and event.content.parts:
      answer = "".join(p.text or "" for p in event.content.parts).strip() or answer
  entity_ids = list(dict.fromkeys(re.findall(r"\[([A-Za-z0-9_-]{2,64})\]", answer)))
  return AskResponse(answer=answer or "I could not find an answer to that.", entity_ids=entity_ids, tools_used=tools_used, model_id=settings.model())
