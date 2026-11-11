package com.thesis.gateway;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.http.HttpHeaders;
import org.springframework.test.web.reactive.server.WebTestClient;

/**
 * CORS for the Flutter web app: the gateway answers preflight requests for /api/** itself,
 * without routing them to a service and without writing an access-log line.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = {"LOG_DIR=target/test-logs"})
@ExtendWith(OutputCaptureExtension.class)
class GatewayCorsTest {

    @Autowired
    private WebTestClient client;

    @Test
    void preflightForTheApiIsAllowed() {
        client.options().uri("/api/orders")
                .header(HttpHeaders.ORIGIN, "http://localhost:5000")
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST")
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS, "content-type")
                .exchange()
                .expectStatus().isOk()
                .expectHeader().valueEquals(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, "http://localhost:5000")
                .expectHeader().value(HttpHeaders.ACCESS_CONTROL_ALLOW_METHODS,
                        methods -> assertThat(methods).contains("POST"));
    }

    @Test
    void preflightIsNotWrittenToTheAccessLog(CapturedOutput output) {
        client.options().uri("/api/products")
                .header(HttpHeaders.ORIGIN, "http://localhost:5000")
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "GET")
                .exchange()
                .expectStatus().isOk();
        assertThat(output.getAll()).doesNotContain("event=http_request method=OPTIONS");
    }

    @Test
    void unsupportedMethodsAreRejected() {
        client.options().uri("/api/orders")
                .header(HttpHeaders.ORIGIN, "http://localhost:5000")
                .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "DELETE")
                .exchange()
                .expectStatus().isForbidden();
    }
}
