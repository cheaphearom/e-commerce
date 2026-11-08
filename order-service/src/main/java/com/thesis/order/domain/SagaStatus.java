package com.thesis.order.domain;

import java.util.EnumSet;
import java.util.Set;

public enum SagaStatus {
    STARTED,
    COMPENSATING,
    COMPLETED,
    COMPENSATED,
    FAILED,
    TIMED_OUT;

    public static final Set<SagaStatus> IN_PROGRESS = EnumSet.of(STARTED, COMPENSATING);

    public boolean isFinished() {
        return !IN_PROGRESS.contains(this);
    }
}
