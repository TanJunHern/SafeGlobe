"""Request and response models for the agents service (Pydantic).

The agents return findings, never a risk number or a route: those are computed by the DueDilly app
from its points table (AI build spec section 4.1).
"""
from typing import Literal, Optional

from pydantic import BaseModel, Field

MatchBasis = Literal["second_identifier", "strong_name", "weak_name", "not_name"]


class EvidenceItem(BaseModel):
  """One piece of evidence the app hands to an agent. An agent may only cite items it was given."""

  ref: str
  source_name: str
  text: str
  second_identifier_match: bool = False


class Category(BaseModel):
  id: str
  label: str


class PolicyClause(BaseModel):
  """One clause of the company's policy, as text. An agent may only cite a clause it was given."""

  id: str
  title: str = ""
  text: str


class AgentBrief(BaseModel):
  """What one sub-agent may look at and which rows of the points table it may report."""

  evidence: list[EvidenceItem] = Field(default_factory=list)
  categories: list[Category] = Field(default_factory=list)
  # The policy clauses this agent maps its findings against. Empty when the policy has none for its subject.
  policy: list["PolicyClause"] = Field(default_factory=list)


class Subject(BaseModel):
  entity_id: str
  name: str
  kind: Literal["org", "vessel", "person"]
  country: str = ""
  registration: str = ""


class ScreenRequest(BaseModel):
  subject: Subject
  # Keyed by agent: sanctions, pep, ownership, country_contract, vessel_behaviour, adverse_media
  briefs: dict[str, AgentBrief]


class AgentFinding(BaseModel):
  """A finding as the model returns it. The app adds the source link, trust and read time from the cited evidence."""

  category: str = Field(description="The id of one allowed category.")
  subject: str = Field(description="Who or what the fact is about.")
  summary: str = Field(description="One plain sentence stating the fact.")
  evidence_quote: str = Field(description="Exact words copied from the cited evidence, at most 300 characters.")
  evidence_ref: str = Field(description="The ref of the evidence item, or the page URL for adverse media.")
  match_basis: MatchBasis = Field(description="How the subject was matched: second_identifier, strong_name, weak_name, or not_name when it is not a name match.")
  policy_clause: str = Field(default="", description="The id of the policy clause this fact falls under (for example §5.4), from the clauses given. Empty when none fits.")
  policy_quote: str = Field(default="", description="Exact words copied from that clause, at most 300 characters. Empty when policy_clause is empty.")
  suggested_action: str = Field(default="", description="One plain sentence: what a compliance reviewer should do next about this fact. Never a score, a risk level or a route.")


class AgentOutput(BaseModel):
  findings: list[AgentFinding] = Field(default_factory=list)
  note: str = Field(default="", description="One sentence on what was checked, for the reviewer.")


class DillyFinding(BaseModel):
  """A finding that passed the app's checks, with the points the user's table gave it."""

  id: str
  agent: str
  rule: str
  summary: str
  points: int = 0
  policy_clause: str = ""
  suggested_action: str = ""


class DillyCheck(BaseModel):
  agent: str
  ran: bool
  note: str = ""


class DillyRequest(BaseModel):
  """What Dilly, the Pond-Guard orchestrator, is given: the checked findings and the result computed by the app."""

  subject: Subject
  findings: list[DillyFinding] = Field(default_factory=list)
  not_counted: int = 0
  checks: list[DillyCheck] = Field(default_factory=list)
  clauses: list[PolicyClause] = Field(default_factory=list)
  # Computed by the app from the user's points table. Given to Dilly to explain, never to change.
  risk: int
  risk_cap: int = 100
  level: str
  confidence: int
  route: str


class DillyStep(BaseModel):
  action: str = Field(description="One plain sentence: a next step for the compliance reviewer.")
  finding_ids: list[str] = Field(default_factory=list, description="The ids of the findings this step rests on.")
  policy_clauses: list[str] = Field(default_factory=list, description="The ids of the policy clauses this step rests on.")


class DillyOutput(BaseModel):
  """Dilly's suggestion. There is no field for a score or a route: those come from the app."""

  summary: str = Field(description="Two or three plain sentences on what the agents found.")
  next_steps: list[DillyStep] = Field(default_factory=list, description="Next steps in the order to do them, at most six.")
  note_reason: Literal["none", "agents_disagree", "check_not_run"] = Field(default="none", description="Why a note is needed, or none.")
  note: str = Field(default="", description="One line for the reviewer, only when the agents disagree or a check could not run. Otherwise empty.")


class DillyResponse(DillyOutput):
  model_id: str = ""
  prompt_version: str = ""


class ExtractRequest(BaseModel):
  """One page a crawler agent reads for one website source. The app fetched the page; the agent only reads its text."""

  source_label: str = Field(min_length=1, max_length=200)
  url: str = ""
  instructions: str = Field(default="", max_length=2000, description="Extra extraction instructions for this source, approved by a compliance officer.")
  text: str = Field(min_length=1, max_length=30000)


class ExtractedRecord(BaseModel):
  """An organisation, person or vessel the page names. The app drops any record whose quote is not on the page."""

  name: str = Field(description="The name exactly as the page writes it.")
  kind: Literal["organisation", "person", "vessel"]
  country: str = Field(default="", description="ISO 3166-1 alpha-3 country code when the page states the country, otherwise empty.")
  identifier: str = Field(default="", description="Registration number, IMO number or other identifier when the page states one, otherwise empty.")
  summary: str = Field(description="One plain sentence on what the page says about it.")
  quote: str = Field(description="Exact words copied from the page that name it, at most 300 characters.")


class ExtractOutput(BaseModel):
  records: list[ExtractedRecord] = Field(default_factory=list)
  note: str = Field(default="", description="One sentence on what the page is, for the reviewer.")


class ExtractResponse(ExtractOutput):
  model_id: str = ""


class ProposeFixRequest(ExtractRequest):
  problem: str = Field(min_length=1, max_length=600)


class ProposeFixOutput(BaseModel):
  instructions: str = Field(description="New extraction instructions for this source, at most 1200 characters.")
  reason: str = Field(description="One sentence on what was wrong and what the new instructions change.")


class ProposeFixResponse(ProposeFixOutput):
  model_id: str = ""


class CountryRiskCategory(BaseModel):
  id: str
  label: str
  description: str = ""


class CountryRiskRequest(BaseModel):
  """One page the country risk agent reads for one view of the Globe. The app fetched the page; the agent only reads its text."""

  view_id: str = Field(min_length=1, max_length=60)
  source_name: str = Field(min_length=1, max_length=200)
  url: str = ""
  instructions: str = Field(default="", max_length=2000)
  categories: list[CountryRiskCategory] = Field(min_length=1)
  text: str = Field(min_length=1, max_length=120000)


class CountryRiskCountry(BaseModel):
  name: str = Field(description="The country, by its usual English name.")
  category: str = Field(description="The id of one of the allowed categories.")
  evidence_quote: str = Field(description="Exact words copied from the page that put the country in that category, at most 300 characters.")


class CountryRiskOutput(BaseModel):
  countries: list[CountryRiskCountry] = Field(default_factory=list)
  note: str = Field(default="", description="One sentence on what the page is, for the reviewer.")


class CountryRiskResponse(CountryRiskOutput):
  model_id: str = ""


class AskRequest(BaseModel):
  question: str = Field(min_length=1, max_length=2000)
  user_role: str = "employee"


class AskResponse(BaseModel):
  answer: str
  entity_ids: list[str] = Field(default_factory=list)
  tools_used: list[str] = Field(default_factory=list)
  model_id: str = ""


class Health(BaseModel):
  service: str = "duedilly-agents"
  adk_version: str
  backend: Literal["vertex", "aistudio", "disabled"]
  model: Optional[str] = None
