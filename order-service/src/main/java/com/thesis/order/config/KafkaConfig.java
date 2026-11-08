package com.thesis.order.config;

import static net.logstash.logback.argument.StructuredArguments.kv;

import com.thesis.common.saga.Topics;
import org.apache.kafka.clients.admin.NewTopic;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.config.TopicBuilder;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.util.backoff.FixedBackOff;

@Configuration
public class KafkaConfig {

    private static final Logger log = LoggerFactory.getLogger(KafkaConfig.class);

    @Bean
    public NewTopic inventoryCommands() {
        return TopicBuilder.name(Topics.INVENTORY_COMMANDS).partitions(3).replicas(1).build();
    }

    @Bean
    public NewTopic inventoryReplies() {
        return TopicBuilder.name(Topics.INVENTORY_REPLIES).partitions(3).replicas(1).build();
    }

    @Bean
    public NewTopic paymentCommands() {
        return TopicBuilder.name(Topics.PAYMENT_COMMANDS).partitions(3).replicas(1).build();
    }

    @Bean
    public NewTopic paymentReplies() {
        return TopicBuilder.name(Topics.PAYMENT_REPLIES).partitions(3).replicas(1).build();
    }

    /** 3 retries one second apart, then the reply is dropped; the saga timeout compensates. */
    @Bean
    public DefaultErrorHandler kafkaErrorHandler() {
        return new DefaultErrorHandler((record, ex) -> log.warn("Message dropped after retries {} {} {} {}",
                kv("event", "message_dropped"),
                kv("topic", record.topic()),
                kv("partition", record.partition()),
                kv("offset", record.offset())),
                new FixedBackOff(1000L, 3));
    }
}
