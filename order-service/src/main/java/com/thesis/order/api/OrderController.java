package com.thesis.order.api;

import com.thesis.order.saga.SagaOrchestrator;
import jakarta.validation.Valid;
import java.net.URI;
import java.util.List;
import java.util.UUID;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/orders")
public class OrderController {

    private final SagaOrchestrator orchestrator;

    public OrderController(SagaOrchestrator orchestrator) {
        this.orchestrator = orchestrator;
    }

    /** Starts the order saga; the outcome is visible later via {@code GET /api/orders/{id}}. */
    @PostMapping
    public ResponseEntity<OrderView> create(@Valid @RequestBody CreateOrderRequest request) {
        OrderView order = orchestrator.createOrder(request);
        return ResponseEntity.accepted().location(URI.create("/api/orders/" + order.id())).body(order);
    }

    @GetMapping("/{id}")
    public OrderView get(@PathVariable UUID id) {
        return orchestrator.getOrder(id);
    }

    @GetMapping
    public List<OrderView> list(@RequestParam(defaultValue = "20") int limit) {
        return orchestrator.listOrders(limit);
    }
}
