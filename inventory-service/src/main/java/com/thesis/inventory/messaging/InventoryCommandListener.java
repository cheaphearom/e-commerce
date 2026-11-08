package com.thesis.inventory.messaging;

import static net.logstash.logback.argument.StructuredArguments.kv;

import com.thesis.common.saga.InventoryCommand;
import com.thesis.common.saga.InventoryReply;
import com.thesis.common.saga.Topics;
import com.thesis.inventory.domain.InventoryService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

@Component
public class InventoryCommandListener {

    private static final Logger log = LoggerFactory.getLogger(InventoryCommandListener.class);

    private final InventoryService inventory;
    private final KafkaTemplate<String, Object> kafka;

    public InventoryCommandListener(InventoryService inventory, KafkaTemplate<String, Object> kafka) {
        this.inventory = inventory;
        this.kafka = kafka;
    }

    @KafkaListener(topics = Topics.INVENTORY_COMMANDS)
    public void onCommand(InventoryCommand command) {
        long start = System.nanoTime();
        try {
            // The service method is transactional; the reply is sent only after it has committed.
            InventoryReply reply = inventory.handle(command);
            kafka.send(Topics.INVENTORY_REPLIES, command.orderId().toString(), reply);
            log.info("Message processed {} {} {} {} {} {}",
                    kv("event", "message_processed"),
                    kv("topic", Topics.INVENTORY_COMMANDS),
                    kv("messageType", command.type()),
                    kv("sagaId", command.sagaId()),
                    kv("success", reply.success()),
                    kv("durationMs", (System.nanoTime() - start) / 1_000_000));
        } catch (RuntimeException e) {
            log.error("Message processing failed {} {} {} {} {} {}",
                    kv("event", "message_failed"),
                    kv("topic", Topics.INVENTORY_COMMANDS),
                    kv("messageType", command.type()),
                    kv("sagaId", command.sagaId()),
                    kv("durationMs", (System.nanoTime() - start) / 1_000_000),
                    kv("exception", e.getClass().getSimpleName()),
                    e);
            throw e;
        }
    }
}
