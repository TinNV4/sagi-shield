# Sagi Shield API -> Cloud Run.  Build from backend/:  docker build -t sagi-shield-api .
FROM python:3.13-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY core ./core
COPY app ./app
# --no-access-log: uvicorn's log has IPs and query strings (family_id is a secret); app/guard.py logs instead.
# One worker: LiveTracker state for /ws/live lives in process memory, keyed by the socket.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1 --no-access-log"]
