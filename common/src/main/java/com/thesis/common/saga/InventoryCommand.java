package com.thesis.common.saga;

import java.util.UUID;

/** Command sent by the order saga orchestrator to the inventory service. */
public record InventoryCommand(UUID sagaId, UUID orderId, String productId, int quantity, Type type) {

    public enum Type {
        RESERVE,
        RELEASE
    }

    public static InventoryCommand reserve(UUID sagaId, UUID orderId, String productId, int quantity) {
        return new InventoryCommand(sagaId, orderId, productId, quantity, Type.RESERVE);
    }

    public static InventoryCommand release(UUID sagaId, UUID orderId, String productId, int quantity) {
        return new InventoryCommand(sagaId, orderId, productId, quantity, Type.RELEASE);
    }
}
