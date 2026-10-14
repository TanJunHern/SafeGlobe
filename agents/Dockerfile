# DueDilly agents service: FastAPI + Google ADK (Pond-Guard, Ask Dilly). Deployed as duedilly-agents-<env> on Cloud Run.
# Build from the repository root:  docker build -f agents/Dockerfile -t duedilly-agents agents
FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8080
WORKDIR /srv

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

RUN useradd --create-home --uid 10001 agent
USER agent

EXPOSE 8080
# Cloud Run sets PORT itself
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
