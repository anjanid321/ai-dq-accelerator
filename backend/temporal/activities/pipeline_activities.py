"""Activities for pipeline generation and dataset export."""
from temporalio import activity
import asyncio
from functools import partial


@activity.defn
async def generate_pipeline_activity(params: dict) -> dict:
    """
    params: {session_id, target_env, approved_rules}
    Returns: {output_dir}
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(_generate_pipeline_sync, params))

def _generate_pipeline_sync(params: dict) -> dict:
    from dq_tools.pipeline_generator import generate
    from dq_tools.transformation_executor import load_transformation_log

    transformation_log = load_transformation_log(params["session_id"])
    output_dir = generate(
        session_id=params["session_id"],
        transformation_log=transformation_log,
        approved_rules=params.get("approved_rules", []),
        target_env=params.get("target_env", {}),
    )
    return {"output_dir": output_dir}


@activity.defn
async def export_working_dataset_activity(params: dict) -> dict:
    """
    params: {session_id}
    Returns: {output_path}
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(_export_working_dataset_sync, params))

def _export_working_dataset_sync(params: dict) -> dict:
    from dq_tools.profiler import export_to_parquet
    output_path = export_to_parquet(params["session_id"])
    return {"output_path": output_path}


@activity.defn
async def zip_output_activity(params: dict) -> dict:
    """
    params: {session_id, output_dir}
    Returns: {zip_path}
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(_zip_output_sync, params))

def _zip_output_sync(params: dict) -> dict:
    import shutil
    from pathlib import Path

    output_dir = Path(params["output_dir"])
    zip_path = shutil.make_archive(str(output_dir), "zip", str(output_dir.parent), output_dir.name)
    return {"zip_path": zip_path}
