"""Temporal worker entry point — registers all workflows and activities."""
import asyncio
import logging
import os
from pathlib import Path

# Load .env from project root before anything else (including Anthropic client init)
_env_path = Path(__file__).resolve().parent.parent.parent / ".env"
if _env_path.exists():
    for _line in _env_path.read_text().splitlines():
        _line = _line.strip()
        if _line and not _line.startswith("#") and "=" in _line:
            _k, _, _v = _line.partition("=")
            os.environ.setdefault(_k.strip(), _v.strip())

from temporalio.client import Client
from temporalio.worker import Worker

from backend.temporal.workflows.dq_workflow import DQAcceleratorWorkflow
from backend.temporal.activities.data_activities import (
    load_dataset_activity,
    profile_and_analyze_activity,
    run_validation_activity,
    detect_anomalies_activity,
    analyze_and_prioritize_activity,
)
from backend.temporal.activities.transform_activities import (
    suggest_next_transformation_activity,
    preview_transformation_activity,
    apply_transformation_activity,
    update_scorecard_activity,
    generate_scorecard_summary_activity,
)
from backend.temporal.activities.pipeline_activities import (
    generate_pipeline_activity,
    export_working_dataset_activity,
    zip_output_activity,
)
from backend.temporal.activities.triage_activities import triage_rules_activity

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

TASK_QUEUE = "dq-accelerator-queue"


async def main():
    temporal_host = os.getenv("TEMPORAL_HOST", "localhost:7233")
    temporal_namespace = os.getenv("TEMPORAL_NAMESPACE", "default")

    logger.info(f"Connecting to Temporal at {temporal_host} (namespace: {temporal_namespace})")
    client = await Client.connect(temporal_host, namespace=temporal_namespace)

    worker = Worker(
        client,
        task_queue=TASK_QUEUE,
        workflows=[DQAcceleratorWorkflow],
        activities=[
            load_dataset_activity,
            profile_and_analyze_activity,
            run_validation_activity,
            detect_anomalies_activity,
            analyze_and_prioritize_activity,
            suggest_next_transformation_activity,
            preview_transformation_activity,
            apply_transformation_activity,
            update_scorecard_activity,
            generate_scorecard_summary_activity,
            generate_pipeline_activity,
            export_working_dataset_activity,
            zip_output_activity,
            triage_rules_activity,
        ],
    )

    logger.info(f"Worker started on task queue: {TASK_QUEUE}")
    await worker.run()


if __name__ == "__main__":
    asyncio.run(main())
