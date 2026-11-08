package com.thesis.common.saga;

/** Kafka topic names used by the order saga. */
public final class Topics {

    public static final String INVENTORY_COMMANDS = "inventory-commands";
    public static final String INVENTORY_REPLIES = "inventory-replies";
    public static final String PAYMENT_COMMANDS = "payment-commands";
    public static final String PAYMENT_REPLIES = "payment-replies";

    private Topics() {
    }
}
