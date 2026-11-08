package com.thesis.order.saga;

import static net.logstash.logback.argument.StructuredArguments.kv;

import com.thesis.common.chaos.ChaosService;
import com.thesis.common.saga.Catalog;
import com.thesis.common.saga.InventoryCommand;
import com.thesis.common.saga.InventoryReply;
import com.thesis.common.saga.PaymentCommand;
import com.thesis.common.saga.PaymentReply;
import com.thesis.order.api.CreateOrderRequest;
import com.thesis.order.api.OrderView;
import com.thesis.order.domain.Order;
import com.thesis.order.domain.OrderRepository;
import com.thesis.order.domain.SagaState;
import com.thesis.order.domain.SagaStateRepository;
import com.thesis.order.domain.SagaStatus;
import com.thesis.order.domain.SagaStep;
import java.math.BigDecimal;
import java.time.Clock;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Orchestration-based saga for orders:
 * RESERVE inventory -> CHARGE payment -> COMPLETED.
 * Out of stock -> FAILED. Payment declined -> COMPENSATING (RELEASE inventory) -> COMPENSATED.
 * Stuck sagas are finished by {@link #timeout(UUID, long)}.
 */
@Service
public class SagaOrchestrator {

    private static final Logger log = LoggerFactory.getLogger(SagaOrchestrator.class);

    /** Failure reasons that are normal business outcomes rather than technical problems. */
    private static final Set<String> BUSINESS_REASONS =
            Set.of("OUT_OF_STOCK", "UNKNOWN_PRODUCT", "INSUFFICIENT_FUNDS", "UNKNOWN_CUSTOMER");

    static final String TIMEOUT_REASON = "SAGA_TIMEOUT";

    private final OrderRepository orders;
    private final SagaStateRepository sagas;
    private final SagaMessaging messaging;
    private final ChaosService chaos;
    private final Clock clock;

    public SagaOrchestrator(OrderRepository orders, SagaStateRepository sagas, SagaMessaging messaging,
                            ChaosService chaos) {
        this.orders = orders;
        this.sagas = sagas;
        this.messaging = messaging;
        this.chaos = chaos;
        this.clock = Clock.systemUTC();
    }

    @Transactional
    public OrderView createOrder(CreateOrderRequest request) {
        Catalog.Product product = Catalog.find(request.productId())
                .orElseThrow(() -> new IllegalArgumentException("Unknown product " + request.productId()));
        chaos.apply("createOrder");
        var now = clock.instant();
        BigDecimal amount = product.price().multiply(BigDecimal.valueOf(request.quantity()));
        Order order = orders.save(new Order(UUID.randomUUID(), request.customerId(), product.id(),
                request.quantity(), amount, now));
        SagaState saga = sagas.save(new SagaState(UUID.randomUUID(), order.getId(), now));
        log.info("Saga started {} {} {} {} {}",
                kv("event", "saga_started"),
                kv("sagaId", saga.getSagaId()),
                kv("orderId", order.getId()),
                kv("productId", order.getProductId()),
                kv("quantity", order.getQuantity()));
        messaging.send(InventoryCommand.reserve(saga.getSagaId(), order.getId(), order.getProductId(),
                order.getQuantity()));
        return OrderView.of(order);
    }

    @Transactional(readOnly = true)
    public OrderView getOrder(UUID id) {
        chaos.apply("getOrder");
        return orders.findById(id)
                .map(OrderView::of)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Order " + id + " not found"));
    }

    @Transactional(readOnly = true)
    public List<OrderView> listOrders(int limit) {
        chaos.apply("listOrders");
        int size = Math.max(1, Math.min(limit, 100));
        return orders.findAll(PageRequest.of(0, size, Sort.by(Sort.Direction.DESC, "createdAt")))
                .map(OrderView::of)
                .getContent();
    }

    @Transactional
    public void handleInventoryReply(InventoryReply reply) {
        chaos.apply("handleInventoryReply");
        SagaState saga = sagas.findById(reply.sagaId()).orElse(null);
        if (saga == null) {
            log.warn("Reply for unknown saga {} {} {}", kv("event", "saga_unknown_reply"),
                    kv("sagaId", reply.sagaId()), kv("orderId", reply.orderId()));
            return;
        }
        Order order = orders.findById(saga.getOrderId()).orElseThrow();
        var now = clock.instant();

        if (reply.type() == InventoryCommand.Type.RELEASE) {
            if (saga.getStatus() == SagaStatus.COMPENSATING && saga.getStep() == SagaStep.RELEASE_INVENTORY) {
                saga.finish(SagaStatus.COMPENSATED, saga.getFailureReason(), now);
                order.cancel(saga.getFailureReason(), now);
                logOutcome("Saga compensated", "saga_compensated", saga, saga.getFailureReason(), now.toEpochMilli());
            }
            return;
        }

        if (saga.getStatus().isFinished()) {
            lateReply(saga, "RESERVE", reply.success());
            if (reply.success()) {
                messaging.send(InventoryCommand.release(saga.getSagaId(), order.getId(), order.getProductId(),
                        order.getQuantity()));
            }
            return;
        }
        if (saga.getStep() != SagaStep.RESERVE_INVENTORY) {
            return;
        }
        if (reply.success()) {
            saga.advance(SagaStep.PROCESS_PAYMENT, now);
            order.markInventoryReserved(now);
            log.info("Saga step {} {} {} {}",
                    kv("event", "saga_step"),
                    kv("sagaId", saga.getSagaId()),
                    kv("orderId", order.getId()),
                    kv("step", SagaStep.PROCESS_PAYMENT));
            messaging.send(PaymentCommand.charge(saga.getSagaId(), order.getId(), order.getCustomerId(),
                    order.getAmount()));
        } else {
            String reason = reasonOrDefault(reply.reason());
            saga.finish(SagaStatus.FAILED, reason, now);
            order.cancel(reason, now);
            logOutcome("Saga failed", "saga_failed", saga, reason, now.toEpochMilli());
        }
    }

    @Transactional
    public void handlePaymentReply(PaymentReply reply) {
        chaos.apply("handlePaymentReply");
        SagaState saga = sagas.findById(reply.sagaId()).orElse(null);
        if (saga == null) {
            log.warn("Reply for unknown saga {} {} {}", kv("event", "saga_unknown_reply"),
                    kv("sagaId", reply.sagaId()), kv("orderId", reply.orderId()));
            return;
        }
        if (reply.type() == PaymentCommand.Type.REFUND) {
            return;
        }
        Order order = orders.findById(saga.getOrderId()).orElseThrow();
        var now = clock.instant();

        if (saga.getStatus().isFinished()) {
            lateReply(saga, "CHARGE", reply.success());
            if (reply.success()) {
                messaging.send(PaymentCommand.refund(saga.getSagaId(), order.getId(), order.getCustomerId(),
                        order.getAmount()));
            }
            return;
        }
        if (saga.getStep() != SagaStep.PROCESS_PAYMENT) {
            return;
        }
        if (reply.success()) {
            saga.finish(SagaStatus.COMPLETED, null, now);
            order.complete(now);
            log.info("Saga completed {} {} {} {}",
                    kv("event", "saga_completed"),
                    kv("sagaId", saga.getSagaId()),
                    kv("orderId", order.getId()),
                    kv("durationMs", saga.ageMillis(now)));
        } else {
            String reason = reasonOrDefault(reply.reason());
            saga.startCompensation(reason, now);
            order.recordFailureReason(reason, now);
            Object[] args = {
                    kv("event", "saga_compensating"),
                    kv("sagaId", saga.getSagaId()),
                    kv("orderId", order.getId()),
                    kv("reason", reason)
            };
            if (BUSINESS_REASONS.contains(reason)) {
                log.info("Saga compensating {} {} {} {}", args);
            } else {
                log.warn("Saga compensating {} {} {} {}", args);
            }
            messaging.send(InventoryCommand.release(saga.getSagaId(), order.getId(), order.getProductId(),
                    order.getQuantity()));
        }
    }

    /**
     * Finishes a saga that has not progressed for {@code timeoutMs}. Both compensations are sent;
     * the participants handle them idempotently.
     *
     * @return true if the saga was timed out by this call
     */
    @Transactional
    public boolean timeout(UUID sagaId, long timeoutMs) {
        SagaState saga = sagas.findById(sagaId).orElse(null);
        var now = clock.instant();
        if (saga == null || saga.getStatus().isFinished()
                || saga.getUpdatedAt().plusMillis(timeoutMs).isAfter(now)) {
            return false;
        }
        Order order = orders.findById(saga.getOrderId()).orElseThrow();
        SagaStep stuckAt = saga.getStep();
        saga.finish(SagaStatus.TIMED_OUT, TIMEOUT_REASON, now);
        order.cancel(TIMEOUT_REASON, now);
        log.warn("Saga timed out {} {} {} {} {}",
                kv("event", "saga_timeout"),
                kv("sagaId", saga.getSagaId()),
                kv("orderId", order.getId()),
                kv("step", stuckAt),
                kv("durationMs", saga.ageMillis(now)));
        messaging.send(PaymentCommand.refund(saga.getSagaId(), order.getId(), order.getCustomerId(),
                order.getAmount()));
        messaging.send(InventoryCommand.release(saga.getSagaId(), order.getId(), order.getProductId(),
                order.getQuantity()));
        return true;
    }

    private void lateReply(SagaState saga, String replyType, boolean success) {
        log.warn("Late reply for finished saga {} {} {} {} {}",
                kv("event", "saga_late_reply"),
                kv("sagaId", saga.getSagaId()),
                kv("orderId", saga.getOrderId()),
                kv("replyType", replyType),
                kv("success", success));
    }

    private void logOutcome(String message, String event, SagaState saga, String reason, long nowMillis) {
        Object[] args = {
                kv("event", event),
                kv("sagaId", saga.getSagaId()),
                kv("orderId", saga.getOrderId()),
                kv("reason", reason),
                kv("durationMs", nowMillis - saga.getStartedAt().toEpochMilli())
        };
        if (BUSINESS_REASONS.contains(reason)) {
            log.info(message + " {} {} {} {} {}", args);
        } else {
            log.warn(message + " {} {} {} {} {}", args);
        }
    }

    private static String reasonOrDefault(String reason) {
        return reason == null || reason.isBlank() ? "UNKNOWN" : reason;
    }
}
