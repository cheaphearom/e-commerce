package com.thesis.common.chaos;

/** Kinds of fault that can be injected into a service. */
public enum FaultType {
    /** Every operation is slowed down by roughly {@code latencyMs} (with jitter). */
    LATENCY,
    /** Each operation throws a realistic exception with probability {@code errorRate}. */
    ERROR,
    /** Database work is slowed down and sometimes fails with a JDBC/connection-pool timeout. */
    DB_TIMEOUT
}
