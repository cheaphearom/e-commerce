package com.thesis.common.saga;

import java.util.UUID;

/** Reply from the payment service to the order saga orchestrator. */
public record PaymentReply(UUID sagaId, UUID orderId, PaymentCommand.Type type, boolean success, String reason) {

    public static PaymentReply ok(PaymentCommand command) {
        return new PaymentReply(command.sagaId(), command.orderId(), command.type(), true, null);
    }

    public static PaymentReply failed(PaymentCommand command, String reason) {
        return new PaymentReply(command.sagaId(), command.orderId(), command.type(), false, reason);
    }
}
