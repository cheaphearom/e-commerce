package com.thesis.order.domain;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface SagaStateRepository extends JpaRepository<SagaState, UUID> {

    @Query("select s.sagaId from SagaState s where s.status in :statuses and s.updatedAt < :before order by s.updatedAt")
    List<UUID> findStuckSagaIds(@Param("statuses") Collection<SagaStatus> statuses,
                                @Param("before") Instant before,
                                Pageable page);
}
