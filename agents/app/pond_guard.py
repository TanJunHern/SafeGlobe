"""Pond-Guard: an ADK coordinator that runs the screening sub-agents in parallel.

Sanctions, PEP, ownership and vessel agents read only the evidence the app sends (its lists and records).
The adverse media agent is the only one that searches the web, through Grounding with Google Search, and it
lives in its own agent because a built-in tool cannot be combined with other tools.
"""
import asyncio
import json
import logging
from typing import AsyncIterator

from google.adk.agents import LlmAgent, ParallelAgent, SequentialAgent
from google.adk.models import Gemini
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
  "- Go through the allowed categories one at a time and report every category the evidence supports. Do not stop at the first.\n"
  "- Report each category at most once. Two findings may cite the same evidence item.\n"
  "- Never give a risk score, a risk level or a recommendation. You only report facts.\n"
  "- If the evidence shows nothing, return an empty findings list and say what you checked in note."
)


def llm() -> Gemini:
  """The chosen model, retried a few times when Vertex AI answers "too many requests" (the agents run in parallel)."""
  return Gemini(model=settings.model(), retry_options=types.HttpRetryOptions(attempts=4, initial_delay=2, max_delay=20, http_status_codes=[429, 500, 503]))


def content_config() -> types.GenerateContentConfig | None:
  level = settings.thinking_level()
  return types.GenerateContentConfig(thinking_config=types.ThinkingConfig(thinking_level=level)) if level else None


def _brief_text(subject: dict, brief: AgentBrief) -> str:
  return json.dumps({
    "subject": subject,
    "allowed_categories": [c.model_dump() for c in brief.categories],
    "evidence": [e.model_dump() for e in brief.evidence],
  }, ensure_ascii=False)


def _list_agent(name: str, role: str, subject: dict, brief: AgentBrief) -> LlmAgent:
  text = f"{role}\n\n{RULES}\n\nYour brief (JSON):\n{_brief_text(subject, brief)}"
  return LlmAgent(
    name=name, model=llm(), generate_content_config=content_config(),
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
    "If you find nothing relevant about this exact subject, say so plainly. Do not guess and do not report namesakes: "
    "an article counts only when it names this subject, and for a vessel only when the IMO number is the same.\n\n"
    f"Subject (JSON): {json.dumps(subject, ensure_ascii=False)}"
  )
  searcher = LlmAgent(
    name="adverse_media_search", model=llm(), generate_content_config=content_config(), instruction=lambda ctx: search_text,
    tools=[google_search], output_key="adverse_media_raw", include_contents="none", after_model_callback=_keep_grounding,
    disallow_transfer_to_parent=True, disallow_transfer_to_peers=True,
  )

  def format_text(ctx) -> str:
    raw = ctx.state.get("adverse_media_raw", "")
    sources = ctx.state.get(SOURCES_KEY, [])
    listed = "\n".join(f'{s["ref"]}: {s["title"] or s["domain"]}' + "".join(f'\n   states: {t}' for t in s["segments"]) for s in sources) or "(none)"
    return (
      "Turn the search notes below into findings.\n"
      f"{RULES}\n"
      "- evidence_ref is the ref (G1, G2, ...) of the page that states the fact. Use only the pages listed. evidence_quote is copied exactly from the search notes.\n"
      "- match_basis is strong_name when the article names the subject exactly, weak_name otherwise.\n"
      "- If the notes say nothing relevant was found, or no listed page states the fact, return no findings.\n\n"
      f"Allowed categories (JSON): {categories}\n\nPages Google Search returned:\n{listed}\n\nSearch notes:\n{raw}"
    )

  formatter = LlmAgent(
    name="adverse_media", model=llm(), generate_content_config=content_config(), instruction=format_text,
    output_schema=AgentOutput, output_key="adverse_media_out", include_contents="none",
    disallow_transfer_to_parent=True, disallow_transfer_to_peers=True,
  )
  return SequentialAgent(name="adverse_media_pipeline", sub_agents=[searcher, formatter])


def build_coordinator(request: ScreenRequest, only: list[str] | None = None) -> tuple[ParallelAgent, list[str]]:
  """The coordinator and the names of the agents it runs, in the order the drawer shows them."""
  subject = request.subject.model_dump()
  sub_agents, names = [], []
  for name, role in LIST_AGENTS.items():
    brief = request.briefs.get(name)
    if brief is None or (only is not None and name not in only):
      continue
    sub_agents.append(_list_agent(name, role, subject, brief))
    names.append(name)
  if "adverse_media" in request.briefs and (only is None or "adverse_media" in only):
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


SOURCES_KEY = "adverse_media_sources"


def grounded_sources(meta, known: list[dict] | None = None) -> list[dict]:
  """The pages Google Search returned, each with a ref (G1, G2, ...) and the statements Google tied to it.

  The links are Google's own redirect links, which the model never sees, so a finding cites a page by its ref.
  """
  out = [dict(s, segments=list(s.get("segments", []))) for s in (known or [])]
  by_url = {s["url"]: s for s in out}
  index = {}
  for i, chunk in enumerate(getattr(meta, "grounding_chunks", None) or []):
    web = getattr(chunk, "web", None)
    if web is None or not getattr(web, "uri", None):
      continue
    if web.uri not in by_url:
      by_url[web.uri] = {"ref": f"G{len(out) + 1}", "url": web.uri, "title": getattr(web, "title", "") or "", "domain": getattr(web, "domain", "") or "", "segments": []}
      out.append(by_url[web.uri])
    index[i] = by_url[web.uri]
  for support in (getattr(meta, "grounding_supports", None) or []):
    text = (getattr(getattr(support, "segment", None), "text", "") or "").strip()
    for i in (getattr(support, "grounding_chunk_indices", None) or []):
      if text and i in index and text not in index[i]["segments"]:
        index[i]["segments"].append(text[:600])
  return out


def _keep_grounding(callback_context, llm_response):
  """Saves the search results next to the search notes, so the formatter and the app can check each link."""
  if getattr(llm_response, "grounding_metadata", None) is not None:
    callback_context.state[SOURCES_KEY] = grounded_sources(llm_response.grounding_metadata, callback_context.state.get(SOURCES_KEY))
  return None


async def _run_once(request: ScreenRequest, pending: list[str], done: set[str]) -> AsyncIterator[dict]:
  """Runs the agents in `pending` once. Yields agent_done for each that answers, then {"type": "_failure"} if the run broke."""
  coordinator, names = build_coordinator(request, only=pending)
  runner = InMemoryRunner(agent=coordinator, app_name=APP_NAME)
  session = await runner.session_service.create_session(app_name=APP_NAME, user_id="duedilly")
  message = types.Content(role="user", parts=[types.Part(text=f"Screen {request.subject.name}.")])
  grounded: list[dict] = []
  notes = ""
  try:
    async with asyncio.timeout(RUN_TIMEOUT_SECONDS):
      async for event in runner.run_async(user_id="duedilly", session_id=session.id, new_message=message):
        if getattr(event, "error_message", None):
          agent = "adverse_media" if event.author == "adverse_media_search" else event.author
          if agent in names and agent not in done:
            done.add(agent)
            yield {"type": "agent_done", "agent": agent, "ok": False, "error": str(event.error_message)[:300], "findings": []}
          continue
        delta = getattr(event.actions, "state_delta", None) or {}
        grounded = delta.get(SOURCES_KEY, grounded)
        notes = delta.get("adverse_media_raw", notes)
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
                payload["search_notes"] = str(notes)[:8000]
              yield payload
            except Exception as err:  # the model returned something that is not the schema
              yield {"type": "agent_done", "agent": name, "ok": False, "error": f"Output did not match the findings schema: {err}"[:300], "findings": []}
  except TimeoutError:
    yield {"type": "_failure", "message": "No answer in time"}
  except Exception as err:
    logging.getLogger("duedilly.agents").exception("Pond-Guard run broke")
    yield {"type": "_failure", "message": (str(err) or type(err).__name__)[:300]}


async def screen(request: ScreenRequest) -> AsyncIterator[dict]:
  """Runs the coordinator and yields progress events for the drawer: agent_started, agent_done, done or error.

  One agent breaking (a dropped connection during a web search, say) stops the parallel run. The agents that had
  not answered yet are then run once more on their own, so one failure does not cost the others their answer.
  """
  _, names = build_coordinator(request)
  for name in names:
    yield {"type": "agent_started", "agent": name}
  done: set[str] = set()
  failure = ""
  for _attempt in range(3):
    pending = [n for n in names if n not in done]
    if not pending:
      break
    async for event in _run_once(request, pending, done):
      if event["type"] == "_failure":
        failure = event["message"]
      else:
        yield event
  if failure and not done:
    yield {"type": "error", "message": failure}
  for name in names:
    if name not in done:
      yield {"type": "agent_done", "agent": name, "ok": False, "error": failure or "No answer in time", "findings": []}
  yield {"type": "done", "prompt_version": settings.PROMPT_VERSION, "model_id": settings.model()}
