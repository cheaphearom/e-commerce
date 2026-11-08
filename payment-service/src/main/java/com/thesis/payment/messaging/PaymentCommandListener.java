package com.thesis.payment.messaging;

import static net.logstash.logback.argument.StructuredArguments.kv;

import com.thesis.common.saga.PaymentCommand;
import com.thesis.common.saga.PaymentReply;
import com.thesis.common.saga.Topics;
import com.thesis.payment.domain.PaymentService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

@Component
public class PaymentCommandListener {

    private static final Logger log = LoggerFactory.getLogger(PaymentCommandListener.class);

    private final PaymentService payments;
    private final KafkaTemplate<String, Object> kafka;

    public PaymentCommandListener(PaymentService payments, KafkaTemplate<String, Object> kafka) {
        this.payments = payments;
        this.kafka = kafka;
    }

    @KafkaListener(topics = Topics.PAYMENT_COMMANDS)
    public void onCommand(PaymentCommand command) {
        long start = System.nanoTime();
        try {
            // The service method is transactional; the reply is sent only after it has committed.
            PaymentReply reply = payments.handle(command);
            kafka.send(Topics.PAYMENT_REPLIES, command.orderId().toString(), reply);
            log.info("Message processed {} {} {} {} {} {}",
                    kv("event", "message_processed"),
                    kv("topic", Topics.PAYMENT_COMMANDS),
                    kv("messageType", command.type()),
                    kv("sagaId", command.sagaId()),
                    kv("success", reply.success()),
                    kv("durationMs", (System.nanoTime() - start) / 1_000_000));
        } catch (RuntimeException e) {
            log.error("Message processing failed {} {} {} {} {} {}",
                    kv("event", "message_failed"),
                    kv("topic", Topics.PAYMENT_COMMANDS),
                    kv("messageType", command.type()),
                    kv("sagaId", command.sagaId()),
                    kv("durationMs", (System.nanoTime() - start) / 1_000_000),
                    kv("exception", e.getClass().getSimpleName()),
                    e);
            throw e;
        }
    }
}
