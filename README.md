# WIREBENCH 1.3

Amiga Workbench–inspired wire desk. Ten standing beats and a live tape of public RSS. Not a firehose, not an APT ladder.

## What it shows

**WIRE:Desk-10** is editorial — which desks a wire would staff, in this order:

1. WORLD · 2. NATION · 3. TEXAS · 4. WAR · 5. MONEY
6. ENERGY · 7. SCIENCE · 8. COURTS · 9. SPACE · 10. PRESS

The NOW line on each card is the latest matching public RSS item. That is assignment, not a claim that the story is the most important on earth.

**IN:Wire** merges:

| Source | Auth |
| --- | --- |
| BBC World / US / Science | none |
| Guardian World / US / Science | none |
| NPR | none |
| Al Jazeera | none |
| NASA breaking | none |
| Texas Tribune | none |
| Houston Public Media | none |
| Defense.gov | none |

Reuters and AP public RSS are dead or gated here. We do not scrape them.

**SRC:Attribution** is feed health.

Personal pins live in `localStorage` (`wirebench.pins`).

## Run locally

```bash
python3 server.py
# open http://127.0.0.1:1990/
```

Port: `WIREBENCH_PORT=8080`. Bind: `WIREBENCH_HOST=0.0.0.0`.

## Docker

```bash
docker compose up --build -d
# http://127.0.0.1:1990/
```

## CLI

```
1> help
1> desk
1> show texas
1> wire war
1> find houston
1> src
1> refresh
```

F1 help · F2 DESK-10 · F3 WIRE · F4 SRC.

## Notes

- Homage to Workbench 1.3 / Kickstart — not a Commodore product.
- Next on the queue: DOCKET.
