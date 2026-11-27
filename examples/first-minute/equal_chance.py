"""Run the same seeded success rule on both desks in a separate local experiment."""

import json

from rehearse import (
    PARTICIPANTS,
    measured_results,
    rehearsal_summary,
    sdk,
    supported_desk,
)
from setup_experiment import (
    check_enrolment,
    check_rollout,
    local_organisation,
    prepare_experiment,
    request,
)

ENVIRONMENT = "Synthetic equal-chance check"
RATES = {"control": 0.55, "guided": 0.55}


def equal_chance(org_id):
    env, metric, variant, detail = prepare_experiment(org_id, ENVIRONMENT)
    experiment = request(detail)
    if experiment["status"] != "running":
        raise SystemExit(
            "The equal-chance check needs its dedicated running experiment."
        )
    expected = sdk(
        "sample",
        environment=env["api_key"],
        experiment=experiment["id"],
        total=PARTICIPANTS,
        rates=RATES,
    )
    result = measured_results(detail, metric["id"], expected)
    report = rehearsal_summary(result, metric["id"], experiment["id"], RATES)
    # A known null effect is a diagnostic, even if sampling produces an apparent winner.
    # Read back the rollout; this check never promotes a variation.
    active = request(detail)
    if active["status"] != "running":
        raise SystemExit("The equal-chance experiment changed during the run.")
    check_enrolment(active)
    check_rollout(active, variant["id"])
    report["decision"] = {
        "supported_desk": supported_desk(report["guided_inference"]),
        "experiment_status": active["status"],
    }
    return report


if __name__ == "__main__":
    print(
        json.dumps(equal_chance(local_organisation(__doc__)), indent=2, allow_nan=False)
    )
