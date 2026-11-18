"""Pass/fail gate over the goldens — `uv run pytest` (or `npm run eval`).
For the full score table, use report.py instead."""

import pytest
from deepeval import assert_test
from deepeval.metrics import GEval
from deepeval.test_case import LLMTestCase

from cases import CASES


@pytest.mark.parametrize("case_id,test_case,metric", CASES, ids=[c[0] for c in CASES])
def test_content_quality(case_id: str, test_case: LLMTestCase, metric: GEval):
    assert_test(test_case, [metric])
