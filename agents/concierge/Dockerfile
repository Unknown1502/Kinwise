# Bedrock AgentCore Runtime container (ARM64, listens on 8080: POST /invocations, GET /ping).
FROM --platform=linux/arm64 ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PORT=8080 \
    CONCIERGE_MODE=bedrock \
    PYTHONUNBUFFERED=1

COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project

COPY src ./src
RUN uv sync --frozen --no-dev

RUN useradd --create-home --uid 1000 kinwise
USER kinwise

EXPOSE 8080
CMD ["uv", "run", "--no-sync", "kinwise-concierge"]
