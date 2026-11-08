package com.thesis.order.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity(name = "CustomerOrder")
@Table(name = "orders", indexes = @Index(name = "idx_orders_created_at", columnList = "createdAt"))
public class Order {

    @Id
    private UUID id;

    @Column(nullable = false)
    private String customerId;

    @Column(nullable = false)
    private String productId;

    private int quantity;

    @Column(nullable = false, precision = 12, scale = 2)
    private BigDecimal amount;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 32)
    private OrderStatus status;

    private String failureReason;

    @Column(nullable = false)
    private Instant createdAt;

    @Column(nullable = false)
    private Instant updatedAt;

    @Version
    private long version;

    protected Order() {
    }

    public Order(UUID id, String customerId, String productId, int quantity, BigDecimal amount, Instant now) {
        this.id = id;
        this.customerId = customerId;
        this.productId = productId;
        this.quantity = quantity;
        this.amount = amount;
        this.status = OrderStatus.PENDING;
        this.createdAt = now;
        this.updatedAt = now;
    }

    public void markInventoryReserved(Instant now) {
        this.status = OrderStatus.INVENTORY_RESERVED;
        this.updatedAt = now;
    }

    public void complete(Instant now) {
        this.status = OrderStatus.COMPLETED;
        this.failureReason = null;
        this.updatedAt = now;
    }

    public void cancel(String reason, Instant now) {
        this.status = OrderStatus.CANCELLED;
        this.failureReason = reason;
        this.updatedAt = now;
    }

    public void recordFailureReason(String reason, Instant now) {
        this.failureReason = reason;
        this.updatedAt = now;
    }

    public UUID getId() {
        return id;
    }

    public String getCustomerId() {
        return customerId;
    }

    public String getProductId() {
        return productId;
    }

    public int getQuantity() {
        return quantity;
    }

    public BigDecimal getAmount() {
        return amount;
    }

    public OrderStatus getStatus() {
        return status;
    }

    public String getFailureReason() {
        return failureReason;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
