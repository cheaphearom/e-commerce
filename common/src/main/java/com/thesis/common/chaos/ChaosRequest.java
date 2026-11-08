package com.thesis.common.chaos;

/**
 * Body of {@code POST /admin/chaos}. Missing values are filled with defaults for the fault type.
 *
 * @param type        the fault type (required)
 * @param latencyMs   added latency for LATENCY and DB_TIMEOUT
 * @param errorRate   probability (0..1) that an operation fails, for ERROR and DB_TIMEOUT
 * @param durationSec how long the fault stays active before it expires by itself
 */
public record ChaosRequest(FaultType type, Long latencyMs, Double errorRate, Long durationSec) {
}
