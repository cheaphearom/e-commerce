package com.thesis.inventory.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;

/** One reservation per order; makes RESERVE and RELEASE idempotent. */
@Entity
@Table(name = "reservations")
public class Reservation {

    @Id
    private UUID orderId;

    @Column(nullable = false)
    private UUID sagaId;

    @Column(nullable = false)
    private String productId;

    private int quantity;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private ReservationStatus status;

    private String reason;

    @Column(nullable = false)
    private Instant updatedAt;

    @Version
    private Long version;

    protected Reservation() {
    }

    public Reservation(UUID orderId, UUID sagaId, String productId, int quantity, ReservationStatus status,
                       String reason, Instant now) {
        this.orderId = orderId;
        this.sagaId = sagaId;
        this.productId = productId;
        this.quantity = quantity;
        this.status = status;
        this.reason = reason;
        this.updatedAt = now;
    }

    public void markReleased(Instant now) {
        this.status = ReservationStatus.RELEASED;
        this.updatedAt = now;
    }

    public UUID getOrderId() {
        return orderId;
    }

    public String getProductId() {
        return productId;
    }

    public int getQuantity() {
        return quantity;
    }

    public ReservationStatus getStatus() {
        return status;
    }

    public String getReason() {
        return reason;
    }
}
