FROM python:3.13-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    WIREBENCH_HOST=0.0.0.0 \
    WIREBENCH_PORT=1990 \
    WIREBENCH_TTL=300

COPY wire.py server.py requirements.txt ./
COPY api/ api/
COPY data/ data/
COPY public/ public/

RUN useradd --system --uid 999 --no-create-home desk \
    && mkdir -p /tmp/wirebench-cache \
    && chown -R desk:desk /app /tmp/wirebench-cache

USER desk

EXPOSE 1990

HEALTHCHECK --interval=30s --timeout=8s --start-period=20s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:1990/api/status', timeout=5)"

CMD ["python3", "server.py"]
