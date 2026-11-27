import json
from pathlib import Path

import pytest

import participant_report
from rehearse import supported_desk


def test_participant_report__missing_snapshot__does_not_invent_traffic():
    # Given an existing experiment awaiting its first refresh
    # When
    report = participant_report.render_report("running", 7, None)
    # Then
    assert "No warehouse snapshot" in report
    assert "0%" not in report


def test_participant_report__incomplete_metric__omits_unobserved_rates():
    # Given a result with only one observed desk
    snapshot = {
        "as_of": "2026-11-26T09:00:00Z",
        "payload": {
            "metrics": [{"metric_id": 7, "variants": {"control": {"n": 2, "sum": 0}}}]
        },
    }
    # When
    report = participant_report.render_report("running", 7, snapshot)
    # Then
    assert "| Standard | 2 | 0 | 0.0% |" in report
    assert "| Guided | — | — | — |" in report
    assert "Collecting data" in report


@pytest.mark.parametrize(
    ("last_error", "split_p", "expected"),
    [
        (None, 0.3, "data favour the guided desk"),
        ("2026-11-26T12:00:00Z", 0.3, "latest warehouse refresh failed"),
        (None, 0.0003, "Sample-ratio mismatch"),
        (None, None, "no sample-ratio check"),
    ],
)
def test_participant_report__native_snapshot__qualifies_rollout(
    last_error, split_p, expected
):
    # Given a successful desk with or without a warehouse or assignment warning
    snapshot = {
        "as_of": "2026-11-26T09:00:00Z",
        "last_error_at": last_error,
        "payload": {
            "srm_p_value": split_p,
            "metrics": [
                {
                    "metric_id": 7,
                    "variants": {
                        "control": {"n": 100, "sum": 40},
                        "guided": {"n": 100, "sum": 70},
                    },
                    "inference": {
                        "guided": {
                            "lift": 0.75,
                            "ci_low": 0.2,
                            "ci_high": 1.3,
                            "chance_to_win": 0.99,
                        }
                    },
                }
            ],
        },
    }
    # When
    report = participant_report.render_report("running", 7, snapshot)
    # Then
    assert expected in report
    assert "+30.0 percentage points" in report
    assert "Relative lift: +75.0%" in report
    assert ("data favour" in report) == (expected == "data favour the guided desk")


def test_participant_report__live_lookup__reads_only_the_participant_environment(
    monkeypatch,
):
    # Given two environments in the same project, each containing this experiment
    datasets = {
        "projects/": [{"name": "First Minute", "organisation": 8, "id": 1}],
        "environments/?project=1": [
            {
                "name": "Synthetic rollout rehearsal",
                "project": 1,
                "api_key": "simulation",
            },
            {"name": "Participant drill", "project": 1, "api_key": "participant"},
        ],
        "environments/participant/experiments/": [
            {
                "id": 3,
                "name": "Can a runbook help on-call responders?",
                "status": "running",
                "feature": {"name": "triage_guide"},
                "metrics": [{"metric": 7, "expected_direction": "increase"}],
            }
        ],
        "environments/participant/experiment-metrics/": [
            {
                "id": 7,
                "name": "First attempt resolved within 60 seconds",
                "aggregation": "occurrence",
                "direction": "up",
                "definition": {"event": "drill_resolved"},
            }
        ],
    }
    monkeypatch.setattr(participant_report, "records", datasets.__getitem__)
    snapshots = {"environments/participant/experiments/3/results/": {"results": None}}
    monkeypatch.setattr(participant_report, "request", snapshots.__getitem__)
    # When
    report = participant_report.participant_report(8)
    # Then
    assert "Participant drill" in report
    assert "No warehouse snapshot" in report


@pytest.mark.parametrize(
    ("capture", "expected"), [("rehearsal.json", "guided"), ("equal-chance.json", None)]
)
def test_supported_desk__recorded_warehouse_snapshots__distinguishes_decisions(
    capture, expected
):
    # Given an aggregate capture from Flagsmith
    report = json.loads((Path(__file__).resolve().parents[1] / capture).read_text())
    # When / Then
    assert supported_desk(report["guided_inference"]) == expected
