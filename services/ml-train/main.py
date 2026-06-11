"""ml-train entrypoint.

Single-shot, like the TS crons — the process must exit (Railway cron has no
overlapping runs). Two subcommands:

  python main.py train   # daily 06:00 UTC: fit the model, then emit tomorrow's
                         # hourly curve in the same run
  python main.py infer   # every 15 min: near-term (now+30/60/120) forecasts

Run from the service dir so sibling modules import flatly (`import features`):
the Railway start command sets the working dir to services/ml-train.
"""

from __future__ import annotations

import sys

from infer import infer
from train import train


def main(argv: list[str]) -> int:
    cmd = argv[1] if len(argv) > 1 else "train"
    if cmd == "train":
        train()
        infer("curve")  # next-day batch curve in the same run as training
    elif cmd == "infer":
        infer("near")
    else:
        print(f"[ml-train] unknown command {cmd!r} (expected 'train' or 'infer')")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
