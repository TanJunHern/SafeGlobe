"""Pond-Guard: an ADK coordinator that runs the screening sub-agents in parallel.

Sanctions, PEP, ownership and vessel agents read only the evidence the app sends (its lists and records).
The adverse media agent is the only one that searches the web, through Grounding with Google Search, and it
lives in its own agent because a built-in tool cannot be combined with other tools.
"""
import asyncio
import json
from typing import AsyncIterator

from google.adk.agents import LlmAgent, ParallelAgent, SequentialAgent
from google.adk.runners import InMemoryRunner
from google.adk.tools import google_search
from google.genai import types

from . import settings
from .models import AgentBrief, AgentOutput, ScreenRequest

APP_NAME = "duedilly_pond_guard"
RUN_TIMEOUT_SECONDS = 120

LIST_AGENTS = {
  "sanctions": "You are the sanctions screening agent. Decide whether the subject, or a party that owns or controls it, matches an entry in the evidence. "
               "Report sanctions_confirmed only when the evidence item says second_identifier_match is true; a name alone is at most sanctions_possible.",
  "pep": "You are the PEP screening agent. Report a director, shareholder or beneficial owner who is a politically exposed person, or a family member or close associate of one.",
  "ownership": "You are the ownership agent. Report unclear ownership: nominees, bearer shares, offshore holding structures, or a beneficial owner that is not known.",
  "vessel_behaviour": "You are the vessel behaviour agent. Report AIS dark periods, ship-to-ship transfers and flag changes that meet the category definitions.",
}

RULES = (
  "Rules you must follow:\n"
  "- Use only the evidence items given to you. Do not use outside knowledge.\n"
  "- Every finding cites one evidence item by its ref and quotes its exact words (at most 300 characters).\n"
  "- category must be one of the allowed category ids. If nothing fits, return no finding.\n"
  "- Report each category at most once.\n"
  "- Never give a risk score, a risk level or a recommendation. You only report facts.\n"
  "- If the evidence shows nothing, return an empty findings list and say what you checked in note."
)


def _brief_text(subject: dict, brief: AgentBrief) -> str:
  return json.dumps({
    "subject": subject,
    "allowed_categories": [c.model_dump() for c in brief.categories],
    "evidence": [e.model_dump() for e in brief.evidence],
  }, ensure_ascii=False)


def _list_agent(name: str, role: str, subject: dict, brief: AgentBrief) -> LlmAgent:
  text = f"{role}\n\n{RULES}\n\nYour brief (JSON):\n{_brief_text(subject, brief)}"
  return LlmAgent(
    name=name, model=settings.model(),
    # A callable keeps ADK from treating the braces in the JSON brief as state placeholders
    instruction=lambda ctx, text=text: text,
    output_schema=AgentOutput, output_key=f"{name}_out",
    include_contents="none", disallow_transfer_to_parent=True, disallow_transfer_to_peers=True,
  )


def _adverse_media_agent(subject: dict, brief: AgentBrief) -> SequentialAgent:
  categories = json.dumps([c.model_dump() for c in brief.categories], ensure_ascii=False)
  search_text = (
    "You are the adverse media agent. Search the web for negative news about the subject below from the last 24 months: "
    "fraud, bribery, corruption, sanctions evasion, money laundering, court cases, regulatory action. "
    "Search the exact name in quotes, with its country or registration when that helps. "
    "List each relevant article with its publisher, date, URL and the sentence that states the fact. "
    "If you find nothing relevant about this exact subject, say so plainly. Do not guess and do not report namesakes.\n\n"
    f"Subject (JSON): {json.dumps(subject, ensure_ascii=False)}"
  )
  searcher = LlmAgent(
    name="adverse_media_search", model=settings.model(), instruction=lambda ctx: search_text,
    tools=[google_search], output_key="adverse_media_raw", include_contents="none",
    disallow_transfer_to_parent=True, disallow_transfer_to_peers=True,
  )

  def format_text(ctx) -> str:
    raw = ctx.state.get("adverse_media_raw", "")
    return (
      "Turn the search notes below into findings.\n"
      f"{RULES}\n"
      "- evidence_ref is the URL of the article. match_basis is strong_name when the article names the subject exactly, weak_name otherwise.\n"
      "- If the notes say nothing relevant was found, return no findings.\n\n"
      f"Allowed categories (JSON): {categories}\n\nSearch notes:\n{raw}"
    )

  formatter = LlmAgent(
    name="adverse_media", model=settings.model(), instruction=format_text,
    output_schema=AgentOutput, output_key="adverse_media_out", include_contents="none",
    disallow_transfer_to_parent=True, disallow_transfer_to_peers=True,
  )
  return SequentialAgent(name="adverse_media_pipeline", sub_agents=[searcher, formatter])


def build_coordinator(request: ScreenRequest) -> tuple[ParallelAgent, list[str]]:
  """The coordinator and the names of the agents it runs, in the order the drawer shows them."""
  subject = request.subject.model_dump()
  sub_agents, names = [], []
  for name, role in LIST_AGENTS.items():
    brief = request.briefs.get(name)
    if brief is None:
      continue
    sub_agents.append(_list_agent(name, role, subject, brief))
    names.append(name)
  if "adverse_media" in request.briefs:
    sub_agents.append(_adverse_media_agent(subject, request.briefs["adverse_media"]))
    names.append("adverse_media")
  return ParallelAgent(name="pond_guard", sub_agents=sub_agents), names


def parse_output(value) -> AgentOutput:
  """An agent's saved output: a dict, a model or JSON text, depending on the ADK path taken."""
  if isinstance(value, AgentOutput):
    return value
  if isinstance(value, str):
    value = json.loads(value)
  return AgentOutput.model_validate(value)


def _grounded_urls(event) -> list[dict]:
  meta = getattr(event, "grounding_metadata", None)
  out = []
  for chunk in (getattr(meta, "grounding_chunks", None) or []):
    web = getattr(chunk, "web", None)
    if web is not None and getattr(web, "uri", None):
      out.append({"url": web.uri, "title": getattr(web, "title", "") or "", "domain": getattr(web, "domain", "") or ""})
  return out


async def screen(request: ScreenRequest) -> AsyncIterator[dict]:
  """Runs the coordinator and yields progress events for the drawer: agent_started, agent_done, done or error."""
  coordinator, names = build_coordinator(request)
  for name in names:
    yield {"type": "agent_started", "agent": name}
  runner = InMemoryRunner(agent=coordinator, app_name=APP_NAME)
  session = await runner.session_service.create_session(app_name=APP_NAME, user_id="duedilly")
  message = types.Content(role="user", parts=[types.Part(text=f"Screen {request.subject.name}.")])
  grounded: list[dict] = []
  done: set[str] = set()
  try:
    async with asyncio.timeout(RUN_TIMEOUT_SECONDS):
      async for event in runner.run_async(user_id="duedilly", session_id=session.id, new_message=message):
        if event.author == "adverse_media_search":
          grounded.extend(_grounded_urls(event))
        if getattr(event, "error_message", None):
          agent = "adverse_media" if event.author == "adverse_media_search" else event.author
          if agent in names and agent not in done:
            done.add(agent)
            yield {"type": "agent_done", "agent": agent, "ok": False, "error": str(event.error_message)[:300], "findings": []}
          continue
        delta = getattr(event.actions, "state_delta", None) or {}
        for name in names:
          key = f"{name}_out"
          if key in delta and name not in done:
            done.add(name)
            try:
              output = parse_output(delta[key])
              payload = {"type": "agent_done", "agent": name, "ok": True, "note": output.note,
                         "findings": [f.model_dump() for f in output.findings], "model_id": event.model_version or settings.model()}
              if name == "adverse_media":
                payload["grounded_sources"] = grounded
              yield payload
            except Exception as err:  # the model returned something that is not the schema
              yield {"type": "agent_done", "agent": name, "ok": False, "error": f"Output did not match the findings schema: {err}"[:300], "findings": []}
  except TimeoutError:
    pass
  except Exception as err:
    yield {"type": "error", "message": str(err)[:300]}
  for name in names:
    if name not in done:
      yield {"type": "agent_done", "agent": name, "ok": False, "error": "No answer in time", "findings": []}
  yield {"type": "done", "prompt_version": settings.PROMPT_VERSION, "model_id": settings.model()}
