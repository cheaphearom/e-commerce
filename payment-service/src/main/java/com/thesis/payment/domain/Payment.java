package com.thesis.payment.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** One payment per order; makes CHARGE and REFUND idempotent. */
@Entity
@Table(name = "payments")
public class Payment {

    @Id
    private UUID orderId;

    @Column(nullable = false)
    private UUID sagaId;

    @Column(nullable = false)
    private String customerId;

    @Column(nullable = false, precision = 14, scale = 2)
    private BigDecimal amount;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private PaymentStatus status;

    private String reason;

    @Column(nullable = false)
    private Instant updatedAt;

    @Version
    private Long version;

    protected Payment() {
    }

    public Payment(UUID orderId, UUID sagaId, String customerId, BigDecimal amount, PaymentStatus status,
                   String reason, Instant now) {
        this.orderId = orderId;
        this.sagaId = sagaId;
        this.customerId = customerId;
        this.amount = amount;
        this.status = status;
        this.reason = reason;
        this.updatedAt = now;
    }

    public void markRefunded(Instant now) {
        this.status = PaymentStatus.REFUNDED;
        this.updatedAt = now;
    }

    public UUID getOrderId() {
        return orderId;
    }

    public String getCustomerId() {
        return customerId;
    }

    public BigDecimal getAmount() {
        return amount;
    }

    public PaymentStatus getStatus() {
        return status;
    }

    public String getReason() {
        return reason;
    }
}
