package com.thesis.payment.config;

import static net.logstash.logback.argument.StructuredArguments.kv;

import com.thesis.common.saga.PaymentCommand;
import com.thesis.common.saga.PaymentReply;
import com.thesis.common.saga.Topics;
import org.apache.kafka.clients.admin.NewTopic;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.config.TopicBuilder;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.util.backoff.FixedBackOff;

@Configuration
public class KafkaConfig {

    private static final Logger log = LoggerFactory.getLogger(KafkaConfig.class);

    @Bean
    public NewTopic paymentCommands() {
        return TopicBuilder.name(Topics.PAYMENT_COMMANDS).partitions(3).replicas(1).build();
    }

    @Bean
    public NewTopic paymentReplies() {
        return TopicBuilder.name(Topics.PAYMENT_REPLIES).partitions(3).replicas(1).build();
    }

    /** 2 retries; after that the orchestrator is told the step failed with PROCESSING_ERROR. */
    @Bean
    public DefaultErrorHandler kafkaErrorHandler(KafkaTemplate<String, Object> kafka) {
        return new DefaultErrorHandler((record, ex) -> {
            if (record.value() instanceof PaymentCommand command) {
                kafka.send(Topics.PAYMENT_REPLIES, command.orderId().toString(),
                        PaymentReply.failed(command, "PROCESSING_ERROR"));
                log.error("Message retries exhausted {} {} {} {}",
                        kv("event", "message_retries_exhausted"),
                        kv("topic", record.topic()),
                        kv("messageType", command.type()),
                        kv("sagaId", command.sagaId()));
            } else {
                log.error("Undeliverable message dropped {} {} {}",
                        kv("event", "message_dropped"),
                        kv("topic", record.topic()),
                        kv("offset", record.offset()));
            }
        }, new FixedBackOff(1000L, 2));
    }
}
