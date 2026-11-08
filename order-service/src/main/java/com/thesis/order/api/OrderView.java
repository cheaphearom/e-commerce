package com.thesis.order.api;

import com.thesis.order.domain.Order;
import com.thesis.order.domain.OrderStatus;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

public record OrderView(UUID id, String customerId, String productId, int quantity, BigDecimal amount,
                        OrderStatus status, String failureReason, Instant createdAt, Instant updatedAt) {

    public static OrderView of(Order o) {
        return new OrderView(o.getId(), o.getCustomerId(), o.getProductId(), o.getQuantity(), o.getAmount(),
                o.getStatus(), o.getFailureReason(), o.getCreatedAt(), o.getUpdatedAt());
    }
}
