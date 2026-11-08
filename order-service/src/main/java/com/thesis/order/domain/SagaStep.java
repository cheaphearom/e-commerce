package com.thesis.order.domain;

/** The saga step the orchestrator is waiting for. */
public enum SagaStep {
    RESERVE_INVENTORY,
    PROCESS_PAYMENT,
    RELEASE_INVENTORY,
    DONE
}
