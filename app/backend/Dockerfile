# ZATCA Phase 2 backend — one image, two roles:
#   API    : uvicorn app.main:app
#   Worker : arq app.workers.arq_worker.WorkerSettings   (override `command`)
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Native build deps for lxml (libxml2/libxslt). cryptography, saxonche, bcrypt
# and friends ship manylinux wheels, so no extra system libs needed for them.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential libxml2-dev libxslt1-dev \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY app ./app
COPY alembic ./alembic
COPY alembic.ini ./

RUN pip install -e .

EXPOSE 8001

# Default role is the API. The worker service in docker-compose overrides this.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
