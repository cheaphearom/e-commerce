package com.thesis.common.chaos;

import java.time.Instant;

/** Current fault injection state, returned by the chaos endpoints. */
public record ChaosStatus(boolean active, FaultType type, long latencyMs, double errorRate,
                          Instant activatedAt, Instant expiresAt) {

    public static ChaosStatus inactive() {
        return new ChaosStatus(false, null, 0, 0.0, null, null);
    }
}
