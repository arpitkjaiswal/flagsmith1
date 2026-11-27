"""Launch and inspect the isolated Docker Compose experiment lab."""

import argparse
from io import StringIO
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys

STATE = Path("/state/credentials.json")
PUBLIC_CONFIG = Path("/configuration/browser.json")
EMAIL = "builder@first-minute.local"
ORGANISATION = "First Minute Lab"


def write_json(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def bootstrap():
    # This runs inside the isolated Flagsmith image after migrations.
    sys.path.insert(0, "/app")
    import django

    django.setup()
    from django.core.management import call_command
    from environments.models import Environment
    from projects.models import Project
    from rest_framework.authtoken.models import Token
    from users.models import FFAdminUser

    from setup_experiment import PROJECT_NAME

    call_command(
        "bootstrap",
        admin_email=EMAIL,
        organisation_name=ORGANISATION,
        project_name=PROJECT_NAME,
        force=False,
        enforce_sso=False,
        stdout=StringIO(),
    )
    user = FFAdminUser.objects.get(email=EMAIL)
    project = Project.objects.get(name=PROJECT_NAME, organisation__name=ORGANISATION)
    dashboard, _ = Environment.objects.get_or_create(
        name="Dashboard configuration", project=project
    )
    if STATE.exists():
        credentials = json.loads(STATE.read_text())
    else:
        credentials = {"email": EMAIL, "password": secrets.token_urlsafe(24)}
        user.set_password(credentials["password"])
        user.save(update_fields=["password"])
    token, _ = Token.objects.get_or_create(user=user)
    credentials.update(
        token=token.key,
        organisation=project.organisation_id,
        dashboard_key=dashboard.api_key,
    )
    write_json(STATE, credentials)
    print("Local account, project and dashboard configuration are ready.")


def configure():
    from setup_experiment import (
        PARTICIPANT_ENVIRONMENT,
        check_enrolment,
        prepare_experiment,
        request,
    )

    credentials = json.loads(STATE.read_text())
    os.environ["FLAGSMITH_MANAGEMENT_TOKEN"] = credentials["token"]
    env, _, _, detail = prepare_experiment(
        credentials["organisation"], PARTICIPANT_ENVIRONMENT
    )
    experiment = request(detail)
    if experiment["status"] == "running":
        check_enrolment(experiment)
    dashboard = f"http://localhost:{os.environ.get('FIRST_MINUTE_API_PORT', '8000')}"
    write_json(
        PUBLIC_CONFIG,
        {
            "VITE_FLAGSMITH_ENVIRONMENT_ID": env["api_key"],
            "VITE_FLAGSMITH_ORIGIN": "",
            "VITE_FLAGSMITH_DASHBOARD_URL": (
                f"{dashboard}/project/{env['project']}/environment/{env['api_key']}"
                f"/experiments/{experiment['id']}"
            ),
        },
    )
    print(f"Participant experiment configured ({experiment['status']}).")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "action",
        choices=[
            "bootstrap",
            "configure",
            "serve-flagsmith",
            "serve-app",
            "credentials",
            "verify",
            "rehearse",
            "report",
        ],
    )
    action = parser.parse_args().action
    if action == "bootstrap":
        bootstrap()
    elif action == "configure":
        configure()
    elif action == "serve-flagsmith":
        credentials = json.loads(STATE.read_text())
        port = os.environ.get("FIRST_MINUTE_API_PORT", "8000")
        os.environ["FLAGSMITH_ON_FLAGSMITH_API_KEY"] = credentials["dashboard_key"]
        os.environ["FLAGSMITH_ON_FLAGSMITH_API_URL"] = (
            f"http://localhost:{port}/api/v1/"
        )
        os.execvp("flagsmith", ["flagsmith", "serve"])
    elif action == "serve-app":
        os.environ.update(json.loads(PUBLIC_CONFIG.read_text()))
        subprocess.run(["npm", "run", "build"], check=True)
        os.execvp(
            "npm",
            ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "8080"],
        )
    else:
        credentials = json.loads(STATE.read_text())
        if action == "credentials":
            print(f"Email  {credentials['email']}\nPassword  {credentials['password']}")
            return
        os.environ["FLAGSMITH_MANAGEMENT_TOKEN"] = credentials["token"]
        script = {
            "verify": "equal_chance.py",
            "rehearse": "rehearse.py",
            "report": "participant_report.py",
        }[action]
        os.execvp(
            sys.executable, [sys.executable, script, str(credentials["organisation"])]
        )


if __name__ == "__main__":
    main()
