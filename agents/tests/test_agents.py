"""Offline tests for the agents service: models, agent wiring and access rules. No model is called.

Run:  cd agents && <python with the ADK installed> -m unittest discover -s tests
"""
import os
import unittest

os.environ.pop("GOOGLE_GENAI_USE_VERTEXAI", None)
os.environ["GOOGLE_API_KEY"] = ""
os.environ["GEMINI_API_KEY"] = ""
os.environ["AGENTS_MODEL"] = "test-model"
os.environ["AGENTS_INTERNAL_TOKEN"] = "test-token"

from fastapi.testclient import TestClient  # noqa: E402

from app import settings  # noqa: E402
from app.ask_dilly import build_agent  # noqa: E402
from app.main import app  # noqa: E402
from app.models import AgentOutput, ScreenRequest  # noqa: E402
from app.pond_guard import build_coordinator, parse_output  # noqa: E402

REQUEST = {
  "subject": {"entity_id": "aurora", "name": "Aurora Venture", "kind": "vessel", "country": "Cameroon", "registration": "9304124"},
  "briefs": {
    "sanctions": {"evidence": [], "categories": [{"id": "sanctions_possible", "label": "Possible sanctions match"}]},
    "vessel_behaviour": {"evidence": [{"ref": "E1", "source_name": "AIS position feed", "text": "AIS dark for 31 h"}], "categories": [{"id": "vessel_ais_dark", "label": "AIS dark"}]},
    "adverse_media": {"evidence": [], "categories": [{"id": "adverse_media_severe", "label": "Severe adverse media"}]},
  },
}


class AgentsServiceTest(unittest.TestCase):
  def test_backend_is_disabled_without_configuration(self):
    self.assertEqual(settings.backend(), "disabled")
    self.assertFalse(settings.ready())

  def test_health_names_no_secret(self):
    body = TestClient(app).get("/health").json()
    self.assertEqual(body["backend"], "disabled")
    self.assertEqual(body["adk_version"], "2.11.0")
    self.assertNotIn("test-token", str(body))

  def test_only_the_app_may_call(self):
    client = TestClient(app)
    self.assertEqual(client.post("/pond-guard/screen", json=REQUEST).status_code, 401)
    self.assertEqual(client.post("/ask", json={"question": "hi"}, headers={"x-internal-token": "wrong"}).status_code, 401)

  def test_no_backend_answers_503_so_the_app_falls_back(self):
    client = TestClient(app)
    res = client.post("/pond-guard/screen", json=REQUEST, headers={"x-internal-token": "test-token"})
    self.assertEqual(res.status_code, 503)

  def test_coordinator_runs_the_briefed_agents_in_parallel(self):
    coordinator, names = build_coordinator(ScreenRequest.model_validate(REQUEST))
    self.assertEqual(type(coordinator).__name__, "ParallelAgent")
    self.assertEqual(names, ["sanctions", "vessel_behaviour", "adverse_media"])
    by_name = {a.name: a for a in coordinator.sub_agents}
    # Only the adverse media searcher has Google Search, and it has no other tool
    searcher = by_name["adverse_media_pipeline"].sub_agents[0]
    self.assertEqual([type(t).__name__ for t in searcher.tools], ["GoogleSearchTool"])
    self.assertEqual(by_name["sanctions"].tools, [])
    self.assertIs(by_name["sanctions"].output_schema, AgentOutput)

  def test_agent_output_parsing(self):
    out = parse_output('{"findings":[{"category":"vessel_ais_dark","subject":"Aurora Venture","summary":"Dark for 31 hours.","evidence_quote":"AIS dark for 31 h","evidence_ref":"E1","match_basis":"not_name"}],"note":"Checked AIS."}')
    self.assertEqual(out.findings[0].evidence_ref, "E1")
    self.assertEqual(parse_output({"findings": []}).findings, [])
    with self.assertRaises(Exception):
      parse_output({"findings": [{"category": "x", "match_basis": "guess"}]})

  def test_ask_dilly_has_read_only_tools(self):
    agent = build_agent()
    names = [getattr(t, "name", getattr(t, "__name__", "")) for t in agent.tools]
    self.assertEqual(names, ["search_counterparties", "get_case", "list_alerts", "get_risk_breakdown", "read_link"])
    for word in ("update", "delete", "create", "approve", "reject", "set_"):
      self.assertFalse(any(word in n for n in names))


if __name__ == "__main__":
  unittest.main()
