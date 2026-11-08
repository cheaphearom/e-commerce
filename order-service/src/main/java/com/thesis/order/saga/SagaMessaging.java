package com.thesis.order.saga;

import com.thesis.common.saga.InventoryCommand;
import com.thesis.common.saga.PaymentCommand;
import com.thesis.common.saga.Topics;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Sends saga commands. When called inside a transaction the message is sent only after the
 * transaction commits, so a participant never sees a command for state that was rolled back.
 */
@Component
public class SagaMessaging {

    private final KafkaTemplate<String, Object> kafka;

    public SagaMessaging(KafkaTemplate<String, Object> kafka) {
        this.kafka = kafka;
    }

    public void send(InventoryCommand command) {
        afterCommit(() -> kafka.send(Topics.INVENTORY_COMMANDS, command.orderId().toString(), command));
    }

    public void send(PaymentCommand command) {
        afterCommit(() -> kafka.send(Topics.PAYMENT_COMMANDS, command.orderId().toString(), command));
    }

    static void afterCommit(Runnable action) {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    action.run();
                }
            });
        } else {
            action.run();
        }
    }
}
