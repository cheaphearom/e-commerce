package com.thesis.order.saga;

import static net.logstash.logback.argument.StructuredArguments.kv;

import com.thesis.common.saga.InventoryReply;
import com.thesis.common.saga.PaymentReply;
import com.thesis.common.saga.Topics;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Component;

/** Consumes participant replies and logs one message_processed / message_failed line per attempt. */
@Component
public class SagaReplyListener {

    private static final Logger log = LoggerFactory.getLogger(SagaReplyListener.class);

    private final SagaOrchestrator orchestrator;

    public SagaReplyListener(SagaOrchestrator orchestrator) {
        this.orchestrator = orchestrator;
    }

    @KafkaListener(topics = Topics.INVENTORY_REPLIES)
    public void onInventoryReply(InventoryReply reply) {
        long start = System.nanoTime();
        try {
            orchestrator.handleInventoryReply(reply);
            processed(Topics.INVENTORY_REPLIES, reply.type().name(), reply.sagaId(), start);
        } catch (RuntimeException e) {
            failed(Topics.INVENTORY_REPLIES, reply.type().name(), reply.sagaId(), start, e);
            throw e;
        }
    }

    @KafkaListener(topics = Topics.PAYMENT_REPLIES)
    public void onPaymentReply(PaymentReply reply) {
        long start = System.nanoTime();
        try {
            orchestrator.handlePaymentReply(reply);
            processed(Topics.PAYMENT_REPLIES, reply.type().name(), reply.sagaId(), start);
        } catch (RuntimeException e) {
            failed(Topics.PAYMENT_REPLIES, reply.type().name(), reply.sagaId(), start, e);
            throw e;
        }
    }

    private static void processed(String topic, String type, UUID sagaId, long start) {
        log.info("Message processed {} {} {} {} {}",
                kv("event", "message_processed"),
                kv("topic", topic),
                kv("messageType", type),
                kv("sagaId", sagaId),
                kv("durationMs", (System.nanoTime() - start) / 1_000_000));
    }

    private static void failed(String topic, String type, UUID sagaId, long start, RuntimeException e) {
        log.error("Message processing failed {} {} {} {} {} {}",
                kv("event", "message_failed"),
                kv("topic", topic),
                kv("messageType", type),
                kv("sagaId", sagaId),
                kv("durationMs", (System.nanoTime() - start) / 1_000_000),
                kv("exception", e.getClass().getSimpleName()),
                e);
    }
}
