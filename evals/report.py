"""Scores every golden case (passing ones too) and saves the run to
results/<timestamp>.json — what you diff when comparing two pipeline models
or two judges. `uv run python report.py [case-id-substring]`."""

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from cases import CASES, JUDGE

selector = sys.argv[1] if len(sys.argv) > 1 else ""
rows = []
for case_id, test_case, metric in CASES:
    if selector not in case_id:
        continue
    metric.measure(test_case)
    rows.append(
        {
            "case": case_id,
            "metric": metric.name,
            "score": metric.score,
            "threshold": metric.threshold,
            "passed": metric.is_successful(),
            "reason": metric.reason,
        }
    )
    status = "PASS" if rows[-1]["passed"] else "FAIL"
    print(f"{status}  {metric.score:.2f}/{metric.threshold:.2f}  {case_id}")

results_dir = Path(__file__).resolve().parent / "results"
results_dir.mkdir(exist_ok=True)
stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
out = results_dir / f"{stamp}.json"
out.write_text(
    json.dumps({"judge": JUDGE.get_model_name(), "results": rows}, ensure_ascii=False, indent=2),
    encoding="utf-8",
)

print(f"\n{sum(r['passed'] for r in rows)}/{len(rows)} passed — {out}")
sys.exit(0 if all(r["passed"] for r in rows) else 1)
