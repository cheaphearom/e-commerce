package com.thesis.gateway;

import static net.logstash.logback.argument.StructuredArguments.kv;

import com.thesis.common.logging.PathNormalizer;
import java.net.ConnectException;
import java.util.concurrent.TimeoutException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.http.HttpStatusCode;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

/**
 * Writes the same {@code event=http_request} access log line as the servlet services, for every
 * request that passes through the gateway. Errors (e.g. the 10 s response timeout) are mapped to
 * the status the client will receive.
 */
@Component
public class AccessLogGlobalFilter implements GlobalFilter, Ordered {

    private static final Logger log = LoggerFactory.getLogger(AccessLogGlobalFilter.class);

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        long start = System.nanoTime();
        String method = exchange.getRequest().getMethod().name();
        String path = PathNormalizer.normalize(exchange.getRequest().getURI().getRawPath());
        return chain.filter(exchange)
                .doOnSuccess(ignored -> write(method, path, statusOf(exchange), start))
                .doOnError(error -> write(method, path, statusOf(error), start));
    }

    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE;
    }

    private static int statusOf(ServerWebExchange exchange) {
        HttpStatusCode code = exchange.getResponse().getStatusCode();
        return code == null ? 200 : code.value();
    }

    static int statusOf(Throwable error) {
        if (error instanceof ResponseStatusException rse) {
            return rse.getStatusCode().value();
        }
        if (error instanceof TimeoutException || error.getCause() instanceof TimeoutException) {
            return 504;
        }
        if (error instanceof ConnectException || error.getCause() instanceof ConnectException) {
            return 503;
        }
        return 500;
    }

    private static void write(String method, String path, int status, long startNanos) {
        long durationMs = (System.nanoTime() - startNanos) / 1_000_000;
        Object[] args = {
                kv("event", "http_request"),
                kv("method", method),
                kv("path", path),
                kv("status", status),
                kv("durationMs", durationMs)
        };
        if (status >= 500) {
            log.error("HTTP request {} {} {} {} {}", args);
        } else if (status >= 400) {
            log.warn("HTTP request {} {} {} {} {}", args);
        } else {
            log.info("HTTP request {} {} {} {} {}", args);
        }
    }
}
