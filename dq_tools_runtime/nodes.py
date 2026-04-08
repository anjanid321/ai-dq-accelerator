"""
dq_tools_runtime.nodes — lightweight runtime for AI-generated transformation nodes.

Designed to be installed inside Airflow workers. Executes AI-generated Python
transformation functions in a restricted sandbox (only pandas + numpy in scope).
"""
from __future__ import annotations

import textwrap
from typing import Any


class CustomCodeTransform:
    """Wraps AI-generated transformation code for safe execution in Airflow.

    The generated code must define a single function with this signature:
        def transform(df: pd.DataFrame) -> pd.DataFrame:

    Only `pd` (pandas) and `np` (numpy) are available in scope.
    No imports, file I/O, or system calls are permitted.

    Usage in a PythonOperator:
        python_callable=CustomCodeTransform(code=..., function_name="transform").execute
    """

    BLOCKED_PATTERNS = [
        "import ",
        "__import__",
        "open(",
        "os.",
        "sys.",
        "subprocess",
        "eval(",
        "exec(",
        "builtins",
        "globals()",
        "locals()",
        "getattr(",
        "setattr(",
    ]

    def __init__(self, code: str, function_name: str = "transform", description: str = ""):
        self.code = textwrap.dedent(code)
        self.function_name = function_name
        self.description = description
        self._validate()

    def _validate(self) -> None:
        """Raise ValueError if the code contains disallowed patterns."""
        for pattern in self.BLOCKED_PATTERNS:
            if pattern in self.code:
                raise ValueError(
                    f"CustomCodeTransform: disallowed pattern '{pattern}' found in code. "
                    "Only pandas (pd) and numpy (np) operations are permitted."
                )
        if f"def {self.function_name}" not in self.code:
            raise ValueError(
                f"CustomCodeTransform: code must define a function named '{self.function_name}'."
            )

    def _get_function(self):
        """Compile and return the transformation function."""
        import re
        import pandas as pd
        import numpy as np

        namespace: dict[str, Any] = {"pd": pd, "np": np, "re": re, "__builtins__": {}}
        exec(compile(self.code, "<generated>", "exec"), namespace)  # noqa: S102

        fn = namespace.get(self.function_name)
        if fn is None:
            raise RuntimeError(
                f"CustomCodeTransform: function '{self.function_name}' not found after exec."
            )
        return fn

    def execute(self, input_key: str = "working_data", **context) -> None:
        """Airflow PythonOperator callable. Reads df from XCom, transforms, pushes back."""
        import pandas as pd

        ti = context.get("ti")
        if ti is None:
            raise RuntimeError("CustomCodeTransform.execute must be called as an Airflow task.")

        # Pull data from upstream XCom
        raw = ti.xcom_pull(key=input_key)
        if raw is None:
            raise ValueError(f"No data found in XCom key '{input_key}'.")

        df = pd.DataFrame(raw) if isinstance(raw, list) else raw

        fn = self._get_function()
        result = fn(df)

        if not isinstance(result, pd.DataFrame):
            raise TypeError(
                f"CustomCodeTransform: '{self.function_name}' must return a pd.DataFrame, "
                f"got {type(result).__name__}."
            )

        ti.xcom_push(key=input_key, value=result.to_dict("records"))

    def transform_dataframe(self, df) -> Any:
        """Direct call — transforms a DataFrame without Airflow context."""
        fn = self._get_function()
        return fn(df)

    def __repr__(self) -> str:
        return f"CustomCodeTransform(function={self.function_name!r}, description={self.description!r})"
