"""Request and response models for the agents service (Pydantic).

The agents return findings, never a risk number or a route: those are computed by the DueDilly app
from its points table (GEMINI.md section 4.1).
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


class AgentBrief(BaseModel):
  """What one sub-agent may look at and which rows of the points table it may report."""

  evidence: list[EvidenceItem] = Field(default_factory=list)
  categories: list[Category] = Field(default_factory=list)


class Subject(BaseModel):
  entity_id: str
  name: str
  kind: Literal["org", "vessel", "person"]
  country: str = ""
  registration: str = ""


class ScreenRequest(BaseModel):
  subject: Subject
  # Keyed by agent: sanctions, pep, ownership, vessel_behaviour, adverse_media
  briefs: dict[str, AgentBrief]


class AgentFinding(BaseModel):
  """A finding as the model returns it. The app adds the source link, trust and read time from the cited evidence."""

  category: str = Field(description="The id of one allowed category.")
  subject: str = Field(description="Who or what the fact is about.")
  summary: str = Field(description="One plain sentence stating the fact.")
  evidence_quote: str = Field(description="Exact words copied from the cited evidence, at most 300 characters.")
  evidence_ref: str = Field(description="The ref of the evidence item, or the page URL for adverse media.")
  match_basis: MatchBasis = Field(description="How the subject was matched: second_identifier, strong_name, weak_name, or not_name when it is not a name match.")


class AgentOutput(BaseModel):
  findings: list[AgentFinding] = Field(default_factory=list)
  note: str = Field(default="", description="One sentence on what was checked, for the reviewer.")


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
