# Lightweight ML vs Rule-Based Anomaly Detection in Backend Application Logs

Code for the master's thesis **"A Comparative Evaluation of Lightweight Machine Learning and
Rule-Based Methods for Anomaly Detection in Backend Application Logs"** by Phearom CHEA.

The project has two parts:

- **A. A microservice system** (Java 21, Spring Boot 3.3, Spring Cloud 2023.0) that processes
  orders with an orchestrated **Saga**, writes structured JSON logs with trace ids, and can
  **inject faults on purpose**. The logs show only the symptoms of a fault, never the fault itself.
- **B. A Python ML detector** that turns those logs into sliding-window features and compares a
  **rule-based baseline**, **Isolation Forest** and **Random Forest** against the ground-truth
  fault labels written by the experiment runner.

| Research question | Answered by |
|---|---|
| **Q1** How accurately can ML detect anomalies in backend logs? | Precision, Recall, F1, ROC-AUC on held-out test windows |
| **Q2** How do Rule-Based, Isolation Forest and Random Forest compare? | The same metrics plus false-positive rate and false-alarm episodes per method, on identical windows |
| **Q3** Can log-based ML detect problems earlier than rule-based monitoring? | Per-fault detection delay and an earlier / same / later comparison against the rules |

---

## 1. Architecture

```mermaid
flowchart LR
    LG["Load generator<br/>(Poisson, ~5 req/s)"] -->|HTTP| GW["api-gateway :8080<br/>Spring Cloud Gateway"]
    EX["Experiment runner"] -. "POST /admin/chaos<br/>(not via gateway, not logged)" .-> OS & IS & PS
    GW -->|/api/orders/**| OS["order-service :8081<br/>Saga orchestrator"]
    GW -->|/api/products/**| IS["inventory-service :8082"]
    GW -->|/api/accounts/**| PS["payment-service :8083"]

    OS <-->|"inventory-commands /<br/>inventory-replies"| K[("Kafka (KRaft)")]
    OS <-->|"payment-commands /<br/>payment-replies"| K
    K <--> IS
    K <--> PS

    OS --- ODB[("orderdb")]
    IS --- IDB[("inventorydb")]
    PS --- PDB[("paymentdb")]

    GW & OS & IS & PS -->|"JSON logs<br/>./logs/*.log"| LOGS[["./logs"]]
    LOGS --> ML["ml-detector :8000<br/>FastAPI + scikit-learn"]
    EX -->|labels.csv| ML
```

- One PostgreSQL 16 instance with **one database per service** (`orderdb`, `inventorydb`, `paymentdb`).
- **Micrometer Tracing (Brave)** puts `traceId`/`spanId` in every log line and propagates them over
  HTTP and Kafka (`spring.kafka.template.observation-enabled` / `listener.observation-enabled`).
  One order produces a single trace across the gateway, order, inventory and payment logs.
- Every service logs JSON (logstash-logback-encoder) to the console and to `${LOG_DIR}/<service>.log`
  (rolling, asynchronous), with the custom field `service`.

### Log format

```json
{"@timestamp":"2026-11-08T03:49:05.944Z","@version":"1",
 "message":"HTTP request event=http_request method=GET path=/api/orders/{id} status=200 durationMs=11",
 "logger_name":"com.thesis.common.logging.AccessLogFilter","thread_name":"http-nio-8081-exec-4",
 "level":"INFO","level_value":20000,"service":"order-service",
 "traceId":"6aeff131ecfd53e34ce69867da20ad3b","spanId":"ac1975c6ef5a3da1",
 "event":"http_request","method":"GET","path":"/api/orders/{id}","status":200,"durationMs":11}
```

Business fields are written with `StructuredArguments.kv(...)`, so they appear both inside the
message and as JSON fields. Unexpected exceptions add `stack_trace`.

| Event | Service | Meaning |
|---|---|---|
| `http_request` | all | one access-log line per request (INFO / WARN 4xx / ERROR 5xx); ids in paths become `{id}` |
| `unhandled_exception` | servlet services | exception reached the global handler (logged with stack trace, RFC 7807 response) |
| `saga_started`, `saga_step`, `saga_completed` | order | the saga's normal path |
| `saga_failed`, `saga_compensating`, `saga_compensated` | order | business failure / compensation (INFO for business reasons, WARN for technical ones) |
| `saga_timeout`, `saga_late_reply` | order | stuck saga compensated by the scheduler; a reply arriving after that |
| `message_processed`, `message_failed` | all Kafka consumers | one line per message attempt, with `durationMs` |
| `message_retries_exhausted`, `message_dropped` | Kafka consumers | retries used up |
| `stock_reserved`, `stock_released`, `stock_rejected`, `payment_charged`, `payment_declined`, `payment_refunded` | participants | participant business events |

---

## 2. The order saga

The order service is an **orchestrator**: it stores the saga state and tells each participant
what to do through Kafka commands. Commands are sent **only after the database transaction has
committed** (`TransactionSynchronization.afterCommit`), so a participant never acts on state that
was rolled back.

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant G as api-gateway
    participant O as order-service
    participant K as Kafka
    participant I as inventory-service
    participant P as payment-service

    C->>G: POST /api/orders
    G->>O: POST /api/orders
    O->>O: save Order(PENDING) + SagaState(STARTED, RESERVE_INVENTORY)
    O-->>G: 202 Accepted
    G-->>C: 202 Accepted
    O->>K: InventoryCommand RESERVE (after commit)
    K->>I: RESERVE
    I->>I: reserve stock (idempotent per orderId)
    I->>K: InventoryReply(success)
    K->>O: reply
    O->>O: Order INVENTORY_RESERVED, step PROCESS_PAYMENT
    O->>K: PaymentCommand CHARGE
    K->>P: CHARGE
    alt balance sufficient
        P->>K: PaymentReply(success)
        K->>O: reply
        O->>O: Order COMPLETED, saga COMPLETED
    else payment declined
        P->>K: PaymentReply(fail, INSUFFICIENT_FUNDS)
        K->>O: reply
        O->>O: saga COMPENSATING, step RELEASE_INVENTORY
        O->>K: InventoryCommand RELEASE
        K->>I: RELEASE
        I->>K: InventoryReply(success)
        K->>O: reply
        O->>O: Order CANCELLED, saga COMPENSATED
    end
    Note over O: @Scheduled every 5 s: sagas without progress for 15 s<br/>get REFUND + RELEASE and become TIMED_OUT
```

| Step | Command (participant) | On success | On failure | Compensation |
|---|---|---|---|---|
| 1 Reserve inventory | `RESERVE` (inventory) | step → `PROCESS_PAYMENT`, order `INVENTORY_RESERVED` | saga `FAILED`, order `CANCELLED` (`OUT_OF_STOCK`, `PROCESSING_ERROR`, …) | nothing reserved, nothing to undo |
| 2 Process payment | `CHARGE` (payment) | saga `COMPLETED`, order `COMPLETED` | saga `COMPENSATING` | `RELEASE` inventory → saga `COMPENSATED`, order `CANCELLED` |
| Timeout (any step) | – | – | no reply within `SAGA_TIMEOUT_MS` (15 s) | `REFUND` + `RELEASE`, saga `TIMED_OUT`, order `CANCELLED` (`SAGA_TIMEOUT`) |
| Late reply | – | – | success reply for a finished saga (`saga_late_reply`) | `RELEASE` (late reserve) or `REFUND` (late charge) |

**Idempotency and races.** Inventory keeps one `Reservation` and payment one `Payment` per
`orderId`, so repeated commands return the same answer. When a compensation overtakes the
original command (`RELEASE` before `RESERVE`, `REFUND` before `CHARGE`) the participant stores a
tombstone, so the late command is rejected instead of leaking stock or money. Stock and balances
are updated under a row lock (`PESSIMISTIC_WRITE`); the entities also carry `@Version`.

**Kafka error handling.** Order service: 3 retries one second apart, then the reply is dropped
(the timeout compensates). Participants: 2 retries, then the orchestrator receives
`success=false, reason=PROCESSING_ERROR`.

**Business noise.** Customers C-007 and C-014 are seeded with a balance of 50, so a share of
payments is declined and compensated during normal operation. Out-of-stock can also happen. This
is ordinary behaviour, not an anomaly, and it makes the detection task realistic.

---

## 3. Fault injection

Every servlet service exposes `/admin/chaos` (from the `common` module):

```bash
curl -X POST localhost:8082/admin/chaos -H 'Content-Type: application/json' \
     -d '{"type":"DB_TIMEOUT","latencyMs":3000,"errorRate":0.4,"durationSec":120}'
curl localhost:8082/admin/chaos            # status
curl -X DELETE localhost:8082/admin/chaos  # clear early
```

Business code calls `chaos.apply("operation")` before its database work. A fault **expires by
itself** after `durationSec`. `/admin` is not routed through the gateway and is excluded from the
access log, the chaos code writes no log lines, and the injector's own frames are removed from
the stack traces it causes, so **the logs show only symptoms**.

| Type | What happens | Symptoms in the logs |
|---|---|---|
| `LATENCY` | every operation sleeps `latencyMs` ± 25 % | higher `durationMs` in access logs and `message_processed`; Kafka backlog; `saga_timeout`/`saga_late_reply` when replies take over 15 s; gateway 504 above 10 s |
| `ERROR` | each operation throws a realistic exception with probability `errorRate` (connection failure, lock timeout, socket timeout, connection reset, NPE) | `unhandled_exception` with stack trace, HTTP 500 (also at the gateway), `message_failed` + retries, `PROCESSING_ERROR` → failed/compensated sagas, new message templates |
| `DB_TIMEOUT` | sleeps `latencyMs` ± 25 %, then with probability `errorRate` throws `QueryTimeoutException: JDBC query timeout … HikariPool-1 - Connection is not available … (Total=10, Active=10, Idle=0, Waiting=N)` | a mix of both: slow requests, connection-pool timeout stack traces, 500s, retries and saga timeouts |

The experiment runner chooses severities from these presets:

| Type | low | medium | high |
|---|---|---|---|
| LATENCY | 400 ms | 1200 ms | 3000 ms |
| ERROR | 10 % | 30 % | 60 % |
| DB_TIMEOUT | 1500 ms, 20 % | 3000 ms, 40 % | 6000 ms, 70 % |

---

## 4. How to run

Requirements: Docker with Compose v2. For local development: JDK 21, Maven 3.9, Python 3.12.

### 4.1 Start the system

```bash
docker compose up -d --build
```

```bash
docker compose ps
```

```bash
curl -X POST localhost:8080/api/orders -H 'Content-Type: application/json' \
     -d '{"customerId":"C-001","productId":"P-101","quantity":2}'
```

Logs are written to `./logs/<service>.log`.

### 4.2 Run an experiment

```bash
docker compose --profile experiment run --rm experiment \
    --duration-min 180 --warmup-min 10 --rps 5 --seed 42 --out /results
```

The runner waits until every service is healthy, sends warm-up traffic, then repeatedly injects
a random fault (random service, type and severity, 60–180 s) followed by a normal gap of
180–420 s. It writes `./results/labels.csv` (`fault_id, service, type, start, end, params`, ISO-8601
UTC) and `./results/experiment.json` (configuration, load start/end, load statistics).

**Run one experiment at a time.** Two runs in parallel would inject faults into the same
services, and each run's labels would miss the other's faults. A lock file
`results/.experiment-running` makes a second run refuse to start; it is removed when a run ends
(if a run was killed, delete it by hand). The evaluation refuses a run that is still going (no
`experiment.json` yet) or was stopped early; `--allow-incomplete` overrides this.

### 4.3 Evaluate

Through the detector's API:

```bash
curl -X POST localhost:8000/evaluate -H 'Content-Type: application/json' -d '{"train_frac":0.6}'
```

Or from the command line:

```bash
cd ml-detector && python -m detector.cli evaluate --logs ../logs --labels ../results/labels.csv \
    --out ../results/detector --window 30 --step 10 --train-frac 0.6
```

Outputs in `results/detector/`: `results.json`, `report.md`, `detection_delays.csv`,
`timeline.png`, `metrics.png`, `detection_delay.png`.

If `experiment.json` sits next to `labels.csv`, only logs from the period when the load generator
ran are evaluated, which keeps service start-up noise out of the data (override with `--start`/`--end`).

### 4.4 Live detection

```bash
curl -X POST localhost:8000/train -H 'Content-Type: application/json' -d '{}'
```

```bash
curl localhost:8000/detect
```

```bash
curl localhost:8000/alerts
```

`/train` fits Isolation Forest (and Random Forest if labels exist) on the logs and saves the model
to `./models`. A background loop tails `./logs` every 10 s, scores the newest window with every
available method and records alerts. The rules work without training.

Every alert carries an **explanation**: the suspected service, the kind of problem (slow
responses → like LATENCY, errors → like ERROR, both → like DB_TIMEOUT), the features that deviate
most from their normal level (learned from the normal training windows), and real error lines
from the logs of that window. On the 7 faults of a real 30-minute test run, and on synthetic
faults, it named the injected service and fault type correctly every time.

### 4.5 Telegram alerts

The detector can send each incident to Telegram: **one message when a problem starts** (with the
explanation) and **one when it is resolved** (no alert for 60 s). It does not send a message for
every 10-second window.

1. In Telegram, open **@BotFather**, send `/newbot` and follow the steps. Copy the **token**.
2. Open your new bot and send it any message (e.g. `hi`).
3. Find your **chat id**: open `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser and
   copy the number at `"chat":{"id": ...}`.
4. Copy `.env.example` to `.env` (it is git-ignored) and fill in `TELEGRAM_BOT_TOKEN` and
   `TELEGRAM_CHAT_ID`.
5. Recreate the detector so it reads the new settings, then send a test message:

```bash
docker compose up -d ml-detector
```

```bash
curl -X POST localhost:8000/notify/test
```

`NOTIFY_METHODS` chooses which detectors may notify (default: all three);
`NOTIFY_RESOLVE_AFTER_S` sets when an incident counts as resolved.

Example message:

```
🚨 Anomaly detected (incident #3)
Time: 2026-11-08 04:14:40 UTC
Detected by: Random Forest (0.94), Isolation Forest (0.82)

Suspected service: inventory-service
Suspected problem: slow responses and errors (database or connection problem, like DB_TIMEOUT)

Strongest signals:
• inventory-service: p95 latency (ms) = 7154 ms (normal ≈ 5 ms)
• inventory-service: Kafka message p95 (ms) = 7128 ms (normal ≈ 6 ms)
• system: saga timeouts = 85 (normal ≈ 0)

Example log lines:
• [inventory-service] Unhandled exception event=unhandled_exception path=/api/products
  exception=QueryTimeoutException errorMessage=JDBC query timeout after 5600ms during
  listProducts; HikariPool-1 - Connection is not available, request time…
```

### 4.6 Without Docker

```bash
mvn -B package
```

The services need PostgreSQL and Kafka (`DB_URL`, `DB_USER`, `DB_PASSWORD`, `KAFKA_BOOTSTRAP`,
`LOG_DIR`; defaults point to `localhost`). The detector can be tried on synthetic logs, with no
services running:

```bash
cd ml-detector && pip install -r requirements-dev.txt
```

```bash
python -m detector.cli synth --out ./synthetic --duration-min 120 --seed 1
```

```bash
python -m detector.cli evaluate --logs ./synthetic/logs --labels ./synthetic/labels.csv --out ./synthetic/eval
```

> Synthetic logs use the same JSON format, and their faults ramp up gradually. They exist **only
> to test the code**; do not report results from them in the thesis.

---

## 5. ML pipeline

```mermaid
flowchart LR
    A["JSON log lines"] --> B["parse + template<br/>(mask UUIDs, ids, numbers)"]
    B --> C["sliding windows<br/>30 s, step 10 s"]
    L["labels.csv"] --> D
    C --> D["label: window overlaps<br/>[start, end + 15 s]"]
    D --> E["chronological split<br/>60 % train / 40 % test"]
    E --> F1["Rule-based"]
    E --> F2["Isolation Forest<br/>(normal windows only)"]
    E --> F3["Random Forest<br/>(supervised)"]
    F1 & F2 & F3 --> G["metrics, delays,<br/>report, figures"]
```

**Parsing (`parsing.py`).** Each line becomes a row with time, service, level, event, HTTP fields,
`durationMs` and whether it has a stack trace. The message is reduced to a **template** by masking
UUIDs, timestamps, IPs, business ids (`P-100`, `C-007`), long hex strings and numbers.
`LogTailer` reads files incrementally for live detection (it handles partial lines and rotation).

**Features (`features.py`), per window.** For each of the four services:

| Feature | Description |
|---|---|
| `log_count`, `error_count`, `warn_count`, `error_ratio` | volume and severity of log lines |
| `http_count`, `http_4xx`, `http_5xx`, `http_5xx_ratio` | from `event=http_request` |
| `latency_mean`, `latency_p95`, `latency_max` | HTTP `durationMs` |
| `kafka_p95` | p95 `durationMs` of `message_processed` / `message_failed` |
| `exception_count` | lines with a stack trace |
| `distinct_templates` | number of different templates |

System-wide: counts of `saga_started`, `saga_completed`, `saga_failed`, `saga_compensating`,
`saga_compensated`, `saga_timeout`, `saga_late_reply`; `saga_success_ratio` (completed / started,
1.0 when nothing started); `unseen_templates` (lines whose template never appeared in the
**normal training** logs, which catches new exception messages).

**Labels.** A window is anomalous if it overlaps `[fault start, fault end + 15 s]`. The grace period
covers symptoms that outlast the fault (queued Kafka messages, retries, timeouts).

**Detectors (`models.py`).**

| Method | Training | Details |
|---|---|---|
| Rule-based | none | gateway 5xx ratio > 5 % (with ≥ 10 requests), gateway p95 > 2000 ms, > 10 ERROR lines in any service; a rule must hold for **3 consecutive windows** (like Prometheus `for:`). Score = max over rules of min(value/threshold) over the last 3 windows, so it can be used for ROC-AUC. |
| Isolation Forest | normal training windows only | symptom features only (ratios, latencies, error/exception counts, saga timeouts and success ratio, unseen templates; no raw traffic volume), `log1p` + `StandardScaler`, 300 trees; alert threshold = 97th percentile of training scores |
| Random Forest | all training windows + labels | every feature, 300 trees, `class_weight="balanced"`, threshold 0.5; feature importance reported |

**Evaluation (`evaluate.py`).** Windows that end before the split point train, windows that start
after it test, and windows crossing it are dropped, so no overlapping window leaks across. The
template vocabulary for `unseen_templates` comes only from normal training logs.

| Metric | Definition |
|---|---|
| Precision / Recall / F1 | per test window |
| ROC-AUC | from each method's continuous score |
| False-positive rate | FP / (FP + TN) |
| False-alarm episodes | runs of consecutive alerting windows that contain no anomalous window (also per hour) |
| Detection delay | end of the first alerting window that overlaps the fault − fault start (only faults that start in the test period) |
| Comparison vs rules | per fault: ML **earlier** (or ML detected and the rules missed), **same**, **later or missed**, **both missed**; mean/median time saved over faults detected by both |
| Breakdowns | detection rate and mean delay by fault type and by target service |

Note on delay resolution: alerts happen at window ends, every 10 s, and the rules need three
windows in a row, so their earliest possible delay is about 20 s after the first symptomatic
window.

### Mapping outputs to the research questions

| Question | Where to look |
|---|---|
| Q1 | `report.md` table "Q1 / Q2", `metrics.png`, `results.json → metrics.{isolation_forest,random_forest}` |
| Q2 | the same table for all three methods (incl. FPR and false-alarm episodes), `timeline.png`, ROC-AUC, breakdown by fault type |
| Q3 | `report.md` "Q3" tables, `detection_delays.csv`, `detection_delay.png`, `results.json → comparison_vs_rules` |

---

## 6. A solid evaluation

- **Repeat with several seeds** (e.g. 5 runs × 3 h, `--seed 1..5`) and report mean ± standard
  deviation, or pool the faults and give bootstrap confidence intervals for F1 and delay.
  Compare methods on paired faults (Wilcoxon signed-rank test on delays; McNemar's test on
  per-fault detection).
- **Vary severity**: run separate experiments per severity level (`low`, `medium`, `high`) and per
  fault type (`--types LATENCY`) to show where the rules break down. Low-severity latency is
  where log-based ML is expected to help most.
- **Sensitivity analysis**: window/step (15/5, 30/10, 60/20), label grace (0/15/30 s), Isolation
  Forest percentile (95/97/99), the rules' `for` length (1/2/3 windows) and train fraction.
- **Generalisation**: train Random Forest on one run and test on another seed, to check that it
  does not memorise one experiment.
- **Public datasets**: validate the template + window + Isolation Forest pipeline on Loghub
  ([HDFS](https://github.com/logpai/loghub/tree/master/HDFS) with block-level labels,
  [BGL](https://github.com/logpai/loghub/tree/master/BGL) with per-line alert labels) to show
  that the method is not specific to this system. They need their own parser (`records_to_frame`
  expects JSON lines), but the rest of the pipeline applies.

### Limitations (to discuss in the thesis)

- Faults are **synthetic and injected at the application level**; real incidents (memory leaks,
  network partitions, bad deployments, noisy neighbours) can look different.
- One Kafka broker, one Postgres instance and a fixed load profile; the absolute numbers depend
  on hardware and traffic.
- Random Forest is supervised: it sees the same fault types in training and test. That is an
  optimistic setting compared with unknown failure modes, which favours Isolation Forest and the rules.
- Labels mark the whole injection interval as anomalous even while a fault is still ramping up
  or has no visible effect yet (e.g. a low error rate on a rarely called endpoint). This lowers
  recall for every method equally.
- The rule thresholds are reasonable defaults, not tuned to this system; tuned rules would be a
  stronger baseline. Report this, or tune them on the training period.
- Window-level metrics count long faults more than short ones; per-fault detection rate and delay
  complement them.

---

## 7. Project structure

```
.
├── pom.xml                      Maven parent (Java 21, Spring Boot 3.3.5, Spring Cloud 2023.0.3)
├── Dockerfile                   multi-stage build for any module (--build-arg MODULE=...)
├── docker-compose.yml           postgres, kafka (KRaft), 4 services, ml-detector, experiment (profile)
├── docker/postgres/init.sql     creates orderdb, inventorydb, paymentdb
├── common/                      shared library (auto-configured for servlet apps)
│   └── src/main/java/com/thesis/common/
│       ├── saga/                InventoryCommand/Reply, PaymentCommand/Reply, Topics, Catalog
│       ├── logging/             AccessLogFilter, PathNormalizer, GlobalExceptionHandler
│       ├── chaos/               ChaosService, ChaosController, ChaosRequest/Status, FaultType
│       └── config/              CommonWebAutoConfiguration
│   └── src/main/resources/      logback-spring.xml, AutoConfiguration.imports
├── api-gateway/                 routes, 10 s response timeout, access-log GlobalFilter
├── order-service/               Saga orchestrator: Order, SagaState, REST, listeners, timeout scheduler
├── inventory-service/           Product, Reservation, RESERVE/RELEASE, restock API, seeding
├── payment-service/             Account, Payment, CHARGE/REFUND, top-up API, seeding
├── experiment/
│   ├── load_generator.py        Poisson traffic through the gateway
│   └── run_experiment.py        warm-up, random faults, labels.csv, experiment.json
└── ml-detector/
    ├── detector/
    │   ├── parsing.py           JSON logs, templates, labels, LogTailer
    │   ├── features.py          sliding windows, features, labels, unseen templates
    │   ├── models.py            RuleBasedDetector, IsolationForestDetector, RandomForestDetector
    │   ├── evaluate.py          split, metrics, delays, comparison, report, figures
    │   ├── api.py               FastAPI: /train /evaluate /detect /alerts /notify/test /health + live loop
    │   ├── explain.py           suspected service, kind of problem, strongest signals, example errors
    │   ├── notify.py            Telegram sender, one message per incident (detected / resolved)
    │   ├── cli.py               `evaluate` and `synth` commands
    │   └── synthetic.py         synthetic logs for testing only
    └── tests/                   pytest: parsing, windows/labels, rules, evaluation, API, explanations, notifications
```

## 8. Build and test

```bash
mvn -B verify
```

```bash
cd ml-detector && pip install -r requirements-dev.txt && python -m pytest
```
