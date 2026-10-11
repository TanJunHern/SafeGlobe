"""Environment of the agents service. Everything has an offline answer: with no backend the service says so and the app falls back."""
import os


def backend() -> str:
  """vertex | aistudio | disabled. The Google GenAI SDK reads the same variables."""
  if os.environ.get("GOOGLE_GENAI_USE_VERTEXAI", "").lower() in ("1", "true"):
    return "vertex" if os.environ.get("GOOGLE_CLOUD_PROJECT") and os.environ.get("GOOGLE_CLOUD_LOCATION") else "disabled"
  key = os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY") or ""
  return "aistudio" if len(key) > 20 and not key.upper().startswith("YOUR_") else "disabled"


def model() -> str:
  """Chosen from the models the project can use; there is no built-in default (CLAUDE.md rule 6)."""
  return os.environ.get("AGENTS_MODEL", "").strip()


def thinking_level() -> str:
  """Optional: MINIMAL, LOW, MEDIUM or HIGH. Empty leaves the model's own default."""
  level = os.environ.get("AGENTS_THINKING_LEVEL", "").strip().upper()
  return level if level in ("MINIMAL", "LOW", "MEDIUM", "HIGH") else ""


def ready() -> bool:
  return backend() != "disabled" and bool(model())


def internal_token() -> str:
  return os.environ.get("AGENTS_INTERNAL_TOKEN", "")


def app_url() -> str:
  """Where Ask Dilly's read-only tools reach the DueDilly app."""
  return os.environ.get("DUEDILLY_INTERNAL_URL", "").rstrip("/")


PROMPT_VERSION = "pond-guard-2026-10-12b"
