# Log anomaly detection experiments (HDFS_v1, BGL)

Experiment code for the thesis *A Comparative Evaluation of Lightweight Machine Learning and
Rule-Based Methods for Anomaly Detection in Backend Application Logs*. CPU only, scikit-learn only.

Status: data pipeline (download → parse → windows → features) done; rules, models,
statistics, RQ3 and plots follow. The full README is written at the end.

## Setup

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt        # Python 3.11+ (the pinned NumPy needs it)
```

## Steps so far

```bash
python -m src.download                      # Zenodo record 8196385 -> data/raw/
python -m src.parse --dataset HDFS          # Drain3 -> data/processed/*.parquet
python -m src.parse --dataset BGL           # add --sample 200000 for a quick test run
python -m src.windowing --summary           # samples + split + results/tables/dataset_stats.*
pytest -q
```
