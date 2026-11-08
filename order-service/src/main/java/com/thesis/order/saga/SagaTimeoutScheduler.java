package com.thesis.order.saga;

import com.thesis.order.domain.SagaStateRepository;
import com.thesis.order.domain.SagaStatus;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.PageRequest;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Periodically times out sagas that have not progressed within {@code saga.timeout-ms}. */
@Component
public class SagaTimeoutScheduler {

    private static final int BATCH = 200;

    private final SagaStateRepository sagas;
    private final SagaOrchestrator orchestrator;
    private final long timeoutMs;

    public SagaTimeoutScheduler(SagaStateRepository sagas, SagaOrchestrator orchestrator,
                                @Value("${saga.timeout-ms:15000}") long timeoutMs) {
        this.sagas = sagas;
        this.orchestrator = orchestrator;
        this.timeoutMs = timeoutMs;
    }

    @Scheduled(fixedDelayString = "${saga.timeout-check-ms:5000}", initialDelayString = "${saga.timeout-check-ms:5000}")
    public void checkTimeouts() {
        Instant before = Instant.now().minusMillis(timeoutMs);
        List<UUID> stuck = sagas.findStuckSagaIds(SagaStatus.IN_PROGRESS, before, PageRequest.of(0, BATCH));
        for (UUID sagaId : stuck) {
            try {
                orchestrator.timeout(sagaId, timeoutMs);
            } catch (ObjectOptimisticLockingFailureException concurrentReply) {
                // A reply updated the saga at the same moment; it is no longer stuck.
            }
        }
    }
}
