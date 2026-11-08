package com.thesis.common.chaos;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Admin endpoints for fault injection. Not routed through the gateway and excluded from the
 * access log, so activating a fault leaves no trace in the logs.
 */
@RestController
@RequestMapping("/admin/chaos")
public class ChaosController {

    private final ChaosService chaos;

    public ChaosController(ChaosService chaos) {
        this.chaos = chaos;
    }

    @PostMapping
    public ChaosStatus activate(@RequestBody ChaosRequest request) {
        return chaos.activate(request);
    }

    @DeleteMapping
    public ChaosStatus clear() {
        return chaos.clear();
    }

    @GetMapping
    public ChaosStatus status() {
        return chaos.status();
    }
}
