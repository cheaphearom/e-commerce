package com.thesis.common.saga;

import java.math.BigDecimal;
import java.util.UUID;

/** Command sent by the order saga orchestrator to the payment service. */
public record PaymentCommand(UUID sagaId, UUID orderId, String customerId, BigDecimal amount, Type type) {

    public enum Type {
        CHARGE,
        REFUND
    }

    public static PaymentCommand charge(UUID sagaId, UUID orderId, String customerId, BigDecimal amount) {
        return new PaymentCommand(sagaId, orderId, customerId, amount, Type.CHARGE);
    }

    public static PaymentCommand refund(UUID sagaId, UUID orderId, String customerId, BigDecimal amount) {
        return new PaymentCommand(sagaId, orderId, customerId, amount, Type.REFUND);
    }
}
