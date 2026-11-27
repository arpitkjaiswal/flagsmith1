"""Print a read-only Markdown report from the local Participant drill environment."""

from rehearse import metric_result, supported_desk
from setup_experiment import (
    EXPERIMENT_NAME,
    METRIC_NAME,
    PARTICIPANT_ENVIRONMENT,
    PROJECT_NAME,
    check_metric,
    local_organisation,
    records,
    request,
)


def find_one(path, name, **filters):
    matches = [
        row
        for row in records(path)
        if row["name"] == name and all(row.get(k) == v for k, v in filters.items())
    ]
    if len(matches) != 1:
        raise SystemExit(
            f"Expected one {name!r}, found {len(matches)}. Check the local dashboard."
        )
    return matches[0]


def render_report(status, metric_id, snapshot):
    lines = [
        "# First Minute participant results",
        "",
        f"Source: Flagsmith / {PROJECT_NAME} / {PARTICIPANT_ENVIRONMENT}. Experiment status: {status}.",
        "",
        "Does a three-step runbook help responders correctly diagnose the outage on their first attempt within 60 seconds?",
    ]
    if snapshot and snapshot.get("last_error_at"):
        lines += [
            "",
            "The latest warehouse refresh failed. Refresh the results in Flagsmith before using this report.",
        ]
    metric = metric_result(snapshot or {}, metric_id)
    if not snapshot or not snapshot.get("as_of") or not metric:
        lines += [
            "",
            "No warehouse snapshot for this metric yet. Open the experiment in Flagsmith and select **Refresh results**.",
        ]
        return "\n".join(lines)
    lines += [
        "",
        f"Warehouse snapshot: {snapshot['as_of']}",
        "",
        "| Desk | Exposed identities | Correct first attempts | Resolution rate |",
        "| --- | ---: | ---: | ---: |",
    ]
    variants = metric["variants"]
    if set(variants) - {"control", "guided"}:
        raise SystemExit(
            "Unexpected variation in the participant results. Check the experiment in Flagsmith."
        )
    for key, label in [("control", "Standard"), ("guided", "Guided")]:
        row = variants.get(key)
        if row is None:
            lines.append(f"| {label} | — | — | — |")
            continue
        n, successes = row["n"], row["sum"]
        if not 0 <= successes <= n or not float(successes).is_integer():
            raise SystemExit(
                "The warehouse returned invalid counts for an occurrence metric."
            )
        rate = f"{successes / n:.1%}" if n else "—"
        lines.append(f"| {label} | {n} | {int(successes)} | {rate} |")

    if all(variants.get(k, {}).get("n") for k in ("control", "guided")):
        guided, control = variants["guided"], variants["control"]
        gap = guided["sum"] / guided["n"] - control["sum"] / control["n"]
        lines += [
            "",
            f"Observed difference (guided minus standard): {100 * gap:+.1f} percentage points.",
        ]
    split_p = snapshot["payload"].get("srm_p_value")
    inference = (metric.get("inference") or {}).get("guided")
    enough_data = len(variants) == 2 and all(
        row["n"] >= 50 and row["sum"] >= 5 for row in variants.values()
    )
    if split_p is None:
        lines += [
            "",
            "Flagsmith has no sample-ratio check for this snapshot. Check enrolment against the configured split before rollout.",
        ]
    elif split_p < 0.001:
        lines += [
            "",
            f"Sample-ratio mismatch (p = {split_p:.3g}). Investigate the assignment before rollout.",
        ]
    if not enough_data or not inference:
        lines += [
            "",
            "Collecting data. A comparison needs at least 50 identities and 5 conversions per desk, plus a Flagsmith inference.",
        ]
    else:
        lines += [
            "",
            (
                f"Flagsmith estimates a {inference['chance_to_win']:.1%} chance that guided beats standard. "
                f"Relative lift: {inference['lift']:+.1%} (95% credible interval {inference['ci_low']:+.1%} to {inference['ci_high']:+.1%})."
            ),
        ]
        desk = supported_desk(inference)
        if desk is None:
            lines += ["", "No clear winner under the rehearsal's rollout rule."]
        elif (
            not snapshot.get("last_error_at")
            and split_p is not None
            and split_p >= 0.001
        ):
            lines += [
                "",
                f"The data favour the {'standard' if desk == 'control' else 'guided'} desk under the rehearsal's rollout rule.",
            ]
    return "\n".join(lines)


def participant_report(org_id):
    project = find_one("projects/", PROJECT_NAME, organisation=org_id)
    pid = project["id"]
    env = find_one(f"environments/?project={pid}", PARTICIPANT_ENVIRONMENT, project=pid)
    root = f"environments/{env['api_key']}/"
    experiment = find_one(root + "experiments/", EXPERIMENT_NAME)
    metric = find_one(root + "experiment-metrics/", METRIC_NAME)
    check_metric(metric)
    if experiment["feature"]["name"] != "triage_guide" or not any(
        m["metric"] == metric["id"] and m["expected_direction"] == "increase"
        for m in experiment["metrics"]
    ):
        raise SystemExit(
            "The participant experiment uses a different flag, metric or expected direction."
        )
    snapshot = request(root + f"experiments/{experiment['id']}/results/")["results"]
    return render_report(experiment["status"], metric["id"], snapshot)


if __name__ == "__main__":
    print(participant_report(local_organisation(__doc__)))
