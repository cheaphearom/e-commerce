package com.thesis.order.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "saga_state", indexes = {
        @Index(name = "idx_saga_order", columnList = "orderId", unique = true),
        @Index(name = "idx_saga_status_updated", columnList = "status,updatedAt")
})
public class SagaState {

    @Id
    private UUID sagaId;

    @Column(nullable = false)
    private UUID orderId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private SagaStep step;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private SagaStatus status;

    private String failureReason;

    @Column(nullable = false)
    private Instant startedAt;

    @Column(nullable = false)
    private Instant updatedAt;

    @Version
    private Long version;

    protected SagaState() {
    }

    public SagaState(UUID sagaId, UUID orderId, Instant now) {
        this.sagaId = sagaId;
        this.orderId = orderId;
        this.step = SagaStep.RESERVE_INVENTORY;
        this.status = SagaStatus.STARTED;
        this.startedAt = now;
        this.updatedAt = now;
    }

    public void advance(SagaStep next, Instant now) {
        this.step = next;
        this.updatedAt = now;
    }

    public void finish(SagaStatus finalStatus, String reason, Instant now) {
        this.status = finalStatus;
        this.step = SagaStep.DONE;
        this.failureReason = reason;
        this.updatedAt = now;
    }

    public void startCompensation(String reason, Instant now) {
        this.status = SagaStatus.COMPENSATING;
        this.step = SagaStep.RELEASE_INVENTORY;
        this.failureReason = reason;
        this.updatedAt = now;
    }

    public long ageMillis(Instant now) {
        return Duration.between(startedAt, now).toMillis();
    }

    public UUID getSagaId() {
        return sagaId;
    }

    public UUID getOrderId() {
        return orderId;
    }

    public SagaStep getStep() {
        return step;
    }

    public SagaStatus getStatus() {
        return status;
    }

    public String getFailureReason() {
        return failureReason;
    }

    public Instant getStartedAt() {
        return startedAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
