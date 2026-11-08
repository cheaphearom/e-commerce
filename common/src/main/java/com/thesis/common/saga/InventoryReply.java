package com.thesis.common.saga;

import java.util.UUID;

/** Reply from the inventory service to the order saga orchestrator. */
public record InventoryReply(UUID sagaId, UUID orderId, InventoryCommand.Type type, boolean success, String reason) {

    public static InventoryReply ok(InventoryCommand command) {
        return new InventoryReply(command.sagaId(), command.orderId(), command.type(), true, null);
    }

    public static InventoryReply failed(InventoryCommand command, String reason) {
        return new InventoryReply(command.sagaId(), command.orderId(), command.type(), false, reason);
    }
}
