# Enterprise Scale & ML Readiness Roadmap

## Scaling to Enterprise Data

### 1. Warehouse Connectivity (Highest Leverage)
Direct connectors to Snowflake, BigQuery, Redshift, and Databricks with sampling controls. Without this, no enterprise dataset reaches the tool. Eliminates the time engineers spend extracting representative samples, managing credentials, and handling schema drift.

### 2. Multi-Table Scope
Real DQ work is about referential integrity across tables — orphaned foreign keys, join quality, cross-table consistency. A session needs to span a schema or dbt project. This is architecturally significant: the profiler, rule engine, and transformation executor all currently assume one `working_data` table.

### 3. Scale — Sampling Strategy
A tiered execution model: run statistical profiling and rule validation as pushdown SQL against the warehouse (where the data already lives), only pulling samples locally for preview and exploration. DuckDB's Iceberg/Parquet support and Soda's existing pushdown checks provide a path, but requires rethinking `_load_df` as a design primitive.

### 4. Generated Artifact Quality
The dbt templates and Airflow DAG currently produce scaffolds needing manual cleanup. For true time savings the output needs to drop into an existing project with zero editing — reading the target dbt project's structure and conventions, generating models that follow the project's naming patterns, integrating with existing `sources.yml` and dbt tests rather than generating standalone files.

### 5. Rule Library and Reuse
Every session starts from scratch. Weeks-level savings come from institutional knowledge accumulation — a persistent rule library with tagging, domain categorization, and similarity matching against new datasets makes session 10 dramatically faster than session 1.

### 6. Collaboration and Approval Workflows
Currently one person drives the whole session. Enterprise DQ involves a data engineer, a domain analyst, and a stakeholder. The Temporal signal/query model is well-suited for multi-user workflows — needs auth, role assignment (who approves rules vs. transforms), and async notifications.

### 7. Deployment Automation
Integrating with GitHub/GitLab to open a real PR with the generated artifacts — and potentially triggering a CI run to validate the dbt project — collapses a week of back-and-forth into an hour.

### 8. Post-Deployment Monitoring
Exporting approved rules as a Great Expectations suite or Soda Cloud config that runs on a schedule, feeding results back into the tool to flag drift. Turns a one-time engagement artifact into a persistent asset.

---

### Sequencing

| Phase | Focus | Impact |
|-------|-------|--------|
| 1 | Warehouse connectors + sampling strategy | Makes it usable on real data |
| 2 | Generated artifact quality + dbt project integration | Hours → days saved |
| 3 | Rule library + multi-table scope + collaboration | Days → weeks saved |
| 4 | Deployment automation + monitoring | Project accelerator → ongoing infrastructure |

---

## Profiling and Transformations for ML/AI Downstream Use

### The Profiling Gap

The current profiler (ydata-profiling) covers general-purpose statistics: null rates, cardinality, distributions, skewness, Pearson correlations. For ML readiness it's missing:

**Target Variable Analysis**
The tool accepts `target_column` but does nothing with it in profiling. Critical missing questions:
- Class distribution (imbalance kills model performance)
- Target null rate
- Feature-target correlations vs. noise features

**Data Leakage Signals**
Columns that are suspiciously predictive of the target are often leakage — a timestamp encoding when the outcome was recorded, an ID mapping 1:1 to the target class. Statistical profiling doesn't surface this; requires correlation-with-target and temporal ordering analysis.

**Feature Fitness for Models**
- Near-zero variance columns (useless to any model)
- High cardinality categoricals (fine for embeddings, problematic for tree models, fatal for one-hot)
- Bimodal distributions (often signals mixed populations)
- Skewness that determines which transforms are needed

**Train/Test Distribution Drift**
If the dataset has a temporal dimension or explicit split, flag features whose distributions differ meaningfully between training and serving periods — a primary cause of models that validate well and perform badly in production.

### Do You Need a Separate Analytics Step?

No separate workflow stage — expand profiling to be **ML-context-aware** when `target_column` and task type are supplied:
- Class distribution, feature-target correlations, leakage candidates, missing target rate
- Feature importance proxies via mutual information (fast and model-agnostic)
- Flag problem features: near-zero variance, extreme skew, cardinality needing encoding decisions
- If a date/timestamp column exists: temporal distribution, recency, seasonality signals

This feeds the AI rule suggestion step with richer context — instead of "salary column has nulls and skew" it becomes "salary has 12% nulls, high right skew, moderate target correlation — impute with median, apply log transform, likely top-5 feature."

### The Transformation Gap for ML

Current transforms are all **correctness transforms** (fix bad data). ML data prep needs a second class:

**Scaling and Normalization**
StandardScaler, MinMaxScaler, RobustScaler. Table-stakes for most models and completely absent. Winsorize is adjacent but not the same.

**Encoding**
One-hot for low-cardinality categoricals, target encoding for high-cardinality, ordinal encoding for ordered categories. Currently the tool can standardize strings or filter invalid values but cannot prepare categoricals for a model.

**Log and Power Transforms**
For right-skewed numeric columns (salary, revenue, counts). Relevant for linear models and anything assuming normality. Not currently representable as a transformation type.

**Sophisticated Imputation**
`impute_constant` and `impute_mode` are appropriate for DQ. For ML: KNN imputation or median imputation with missingness indicators (a separate binary column flagging the value was imputed, which can itself be predictive).

**Train/Test Leakage Prevention**
Scalers and encoders need to be fit on training data only and applied to test/serving data. The current transform model applies everything to the full dataset — correct for DQ but wrong for ML preprocessing. The generated sklearn pipeline handles this correctly; the in-session transformations do not respect this distinction.

### Recommended Structure: Two Modes

Selected at session creation rather than a new workflow stage:

**DQ Mode** (current)
Focus: correctness — validity, completeness, uniqueness.
Output: cleaned dataset and monitoring pipeline.

**ML Prep Mode** (extended)
Builds on DQ with target-aware profiling, feature fitness assessment, and ML transform types.
Output: everything DQ mode produces, plus a fitted preprocessing pipeline with train/test split awareness and a feature quality report.

**Architectural changes required:**
- Profiler: add target-aware analysis pass
- Transformation executor: add ML transform types + concept of "fit on train, apply to all"
- LangGraph agents: benefit immediately from richer context and broader tool set

**Expected impact:** A data scientist currently spends 3–5 days on EDA, feature assessment, and building a reproducible preprocessing pipeline before running a first model. Target-aware profiling + ML transforms would collapse most of that into a single accelerated session.
