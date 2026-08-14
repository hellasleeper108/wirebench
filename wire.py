"""Shared wire-desk logic for the local server and Vercel functions."""

from __future__ import annotations

import json
import os
import re
import tempfile
import threading
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from html import unescape
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent


def _data_dir() -> Path:
    for path in (ROOT / "data", Path.cwd() / "data"):
        if (path / "desks.json").exists():
            return path
    return ROOT / "data"


DATA = _data_dir()
TTL = int(os.environ.get("WIREBENCH_TTL", "300"))
UA = "WireBench/1.3 (+research; Amiga-inspired wire desk)"
PORT = int(os.environ.get("WIREBENCH_PORT", "1990"))
HOST = os.environ.get("WIREBENCH_HOST", "127.0.0.1")

FEEDS = {
    "bbc_world": "http://feeds.bbci.co.uk/news/world/rss.xml",
    "bbc_us": "https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml",
    "bbc_sci": "http://feeds.bbci.co.uk/news/science_and_environment/rss.xml",
    "guardian_world": "https://www.theguardian.com/world/rss",
    "guardian_us": "https://www.theguardian.com/us-news/rss",
    "guardian_sci": "https://www.theguardian.com/science/rss",
    "npr": "https://feeds.npr.org/1001/rss.xml",
    "aljazeera": "https://www.aljazeera.com/xml/rss/all.xml",
    "nasa": "https://www.nasa.gov/rss/dyn/breaking_news.rss",
    "tribune": "https://www.texastribune.org/rss/",
    "hpm": "https://www.houstonpublicmedia.org/feed/",
    "defense": "https://www.defense.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=945&max=20",
}

FEED_LABEL = {
    "bbc_world": "BBC World",
    "bbc_us": "BBC US",
    "bbc_sci": "BBC Sci",
    "guardian_world": "Guardian",
    "guardian_us": "Guardian US",
    "guardian_sci": "Guardian Sci",
    "npr": "NPR",
    "aljazeera": "Al Jazeera",
    "nasa": "NASA",
    "tribune": "Texas Tribune",
    "hpm": "Houston PM",
    "defense": "Defense.gov",
}

_lock = threading.Lock()
_meta: dict[str, dict] = {}
_mem: dict[str, tuple[float, object]] = {}


def _now() -> float:
    return time.time()


def _cache_dir() -> Path:
    env = os.environ.get("WIREBENCH_CACHE")
    candidates = []
    if env:
        candidates.append(Path(env))
    candidates.append(Path(tempfile.gettempdir()) / "wirebench-cache")
    candidates.append(DATA / "cache")
    for path in candidates:
        try:
            path.mkdir(parents=True, exist_ok=True)
            probe = path / ".w"
            probe.write_text("ok")
            probe.unlink(missing_ok=True)
            return path
        except OSError:
            continue
    return Path(tempfile.gettempdir())


CACHE = _cache_dir()


def _read_json(path: Path):
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def _write_json(path: Path, payload) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload), encoding="utf-8")
    tmp.replace(path)


def strip_html(text: str) -> str:
    text = re.sub(r"(?is)<script[^>]*>.*?</script>", " ", text or "")
    text = re.sub(r"(?is)<style[^>]*>.*?</style>", " ", text)
    text = re.sub(r"(?is)<[^>]+>", " ", text)
    text = unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def parse_rss(raw: bytes) -> list[dict]:
    items = []
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return items
    for item in root.findall(".//item"):
        title = (item.findtext("title") or "").strip()
        if not title:
            continue
        desc = strip_html(item.findtext("description") or item.findtext("{http://purl.org/rss/1.0/modules/content/}encoded") or "")
        items.append(
            {
                "title": title,
                "link": (item.findtext("link") or "").strip(),
                "summary": desc[:320],
                "date": (item.findtext("pubDate") or item.findtext("{http://purl.org/dc/elements/1.1/}date") or "").strip(),
            }
        )
    if items:
        return items
    ns = {"a": "http://www.w3.org/2005/Atom"}
    for item in root.findall(".//{http://www.w3.org/2005/Atom}entry") or root.findall(".//entry"):
        title = (item.findtext("{http://www.w3.org/2005/Atom}title") or item.findtext("title") or "").strip()
        if not title:
            continue
        link_el = item.find("{http://www.w3.org/2005/Atom}link") or item.find("link")
        href = ""
        if link_el is not None:
            href = link_el.get("href") or (link_el.text or "")
        summary = strip_html(
            item.findtext("{http://www.w3.org/2005/Atom}summary")
            or item.findtext("{http://www.w3.org/2005/Atom}content")
            or ""
        )
        items.append(
            {
                "title": title,
                "link": href.strip(),
                "summary": summary[:320],
                "date": (
                    item.findtext("{http://www.w3.org/2005/Atom}updated")
                    or item.findtext("{http://www.w3.org/2005/Atom}published")
                    or ""
                ).strip(),
            }
        )
    return items


def fetch_bytes(url: str, timeout: int = 16) -> bytes:
    req = Request(url, headers={"User-Agent": UA, "Accept": "application/rss+xml, application/xml, text/xml, */*"})
    with urlopen(req, timeout=timeout) as resp:
        return resp.read()


def cached_feed(name: str, force: bool = False):
    path = CACHE / f"{name}.json"
    with _lock:
        hit = _mem.get(name)
        if hit and not force and _now() - hit[0] < TTL:
            info = {"source": name, "cached": True, "age_s": int(_now() - hit[0]), "ok": True}
            _meta[name] = info
            return hit[1], info
        if path.exists() and not force:
            age = _now() - path.stat().st_mtime
            if age < TTL:
                try:
                    data = _read_json(path)
                    _mem[name] = (_now() - age, data)
                    info = {"source": name, "cached": True, "age_s": int(age), "ok": True}
                    _meta[name] = info
                    return data, info
                except (OSError, json.JSONDecodeError):
                    pass
        try:
            raw = fetch_bytes(FEEDS[name])
            data = {"items": parse_rss(raw)}
            _mem[name] = (_now(), data)
            try:
                _write_json(path, data)
            except OSError:
                pass
            info = {"source": name, "cached": False, "age_s": 0, "ok": True, "fetched_at": int(_now())}
            _meta[name] = info
            return data, info
        except (URLError, HTTPError, TimeoutError, OSError) as exc:
            if path.exists():
                try:
                    stale = _read_json(path)
                    age = int(_now() - path.stat().st_mtime)
                    _mem[name] = (_now() - age, stale)
                    info = {
                        "source": name,
                        "cached": True,
                        "stale": True,
                        "age_s": age,
                        "ok": False,
                        "error": str(exc),
                    }
                    _meta[name] = info
                    return stale, info
                except (OSError, json.JSONDecodeError):
                    pass
            info = {"source": name, "ok": False, "error": str(exc)}
            _meta[name] = info
            return None, info


def load_desks():
    return _read_json(DATA / "desks.json")


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")[:80]


def assign_desk(title: str, summary: str, desks: list[dict]) -> str:
    blob = f"{title} {summary}".lower()
    best, score = "world", 0
    for desk in desks:
        n = sum(1 for kw in desk.get("keywords") or [] if kw.lower() in blob)
        if n > score:
            best, score = desk["id"], n
    return best


def _all_items():
    desks = load_desks().get("desks") or []
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(cached_feed, FEEDS.keys()))
    rows = []
    feeds_meta = {}
    for name in FEEDS:
        blob, meta = cached_feed(name)
        feeds_meta[name] = meta
        for item in (blob or {}).get("items") or []:
            desk = assign_desk(item.get("title") or "", item.get("summary") or "", desks)
            rows.append(
                {
                    "id": f"{name}-{_slug(item.get('title') or '')}",
                    "name": item.get("title") or "",
                    "source": name,
                    "src_label": FEED_LABEL.get(name, name),
                    "desk": desk,
                    "date": item.get("date") or "",
                    "summary": item.get("summary") or "",
                    "url": item.get("link") or "",
                    "status": "new",
                }
            )
    rows.sort(key=lambda r: r.get("date") or "", reverse=True)
    return rows, feeds_meta


def build_wire():
    rows, feeds_meta = _all_items()
    return {
        "generated_at": int(_now()),
        "ttl_s": TTL,
        "feeds": feeds_meta,
        "stats": {k: (feeds_meta.get(k) or {}).get("ok") for k in FEEDS},
        "count": len(rows),
        "rows": rows[:80],
    }


def build_desks():
    base = load_desks()
    rows, _ = _all_items()
    by_desk: dict[str, list] = {}
    for row in rows:
        by_desk.setdefault(row["desk"], []).append(row)
    out = []
    for desk in base.get("desks") or []:
        now = (by_desk.get(desk["id"]) or [None])[0]
        copy = dict(desk)
        copy["now"] = now
        copy["n"] = len(by_desk.get(desk["id"]) or [])
        out.append(copy)
    return {
        "updated": base.get("updated"),
        "ranking_source": base.get("ranking_source"),
        "desks": out,
    }


def build_status():
    return {
        "name": "WIREBENCH",
        "version": "1.3",
        "host": HOST,
        "port": PORT,
        "ttl_s": TTL,
        "feeds": FEEDS,
        "feed_state": {k: _meta.get(k, {"source": k, "ok": None}) for k in FEEDS},
        "runtime": "vercel" if os.environ.get("VERCEL") else "local",
        "now": int(_now()),
    }


def search_all(q: str, limit: int = 40):
    qn = (q or "").strip().lower()
    if not qn:
        return {"query": q, "hits": []}
    hits = []
    for d in load_desks().get("desks") or []:
        blob = " ".join([d.get("name", ""), d.get("id", ""), d.get("summary", "")]).lower()
        if qn in blob:
            hits.append({"kind": "desk", "id": d["id"], "name": d["name"], "detail": d.get("summary") or ""})
    for row in build_wire().get("rows") or []:
        blob = " ".join([row.get("name", ""), row.get("summary", ""), row.get("src_label", ""), row.get("desk", "")]).lower()
        if qn in blob:
            hits.append({"kind": "story", "id": row["id"], "name": row["name"], "detail": f"{row['src_label']} · {row['desk']}"})
        if len(hits) >= limit:
            break
    return {"query": q, "hits": hits[:limit]}


def refresh_all():
    for name in FEEDS:
        cached_feed(name, force=True)
    return {"ok": True, "status": build_status(), "wire": build_wire()}


def send_json(req: BaseHTTPRequestHandler, payload, code: int = 200, cache: int = 300) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req.send_response(code)
    req.send_header("Content-Type", "application/json; charset=utf-8")
    if cache > 0:
        req.send_header("Cache-Control", f"public, s-maxage={cache}, stale-while-revalidate=600")
    else:
        req.send_header("Cache-Control", "no-store")
    req.send_header("Content-Length", str(len(body)))
    req.end_headers()
    req.wfile.write(body)


def qs(req: BaseHTTPRequestHandler) -> dict[str, list[str]]:
    return parse_qs(urlparse(req.path).query)
