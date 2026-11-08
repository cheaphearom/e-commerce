package com.thesis.common.logging;

import static net.logstash.logback.argument.StructuredArguments.kv;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Writes one structured log line per HTTP request:
 * {@code event=http_request method path status durationMs}. INFO for 1xx-3xx, WARN for 4xx,
 * ERROR for 5xx. Requests to {@code /admin} and {@code /actuator} are not logged.
 */
public class AccessLogFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(AccessLogFilter.class);

    public static String normalizePath(String path) {
        return PathNormalizer.normalize(path);
    }

    public static boolean isExcluded(String path) {
        if (path == null) {
            return false;
        }
        return path.equals("/admin") || path.startsWith("/admin/")
                || path.equals("/actuator") || path.startsWith("/actuator/");
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return isExcluded(request.getRequestURI());
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        long start = System.nanoTime();
        boolean failed = false;
        try {
            chain.doFilter(request, response);
        } catch (IOException | ServletException | RuntimeException e) {
            failed = true;
            throw e;
        } finally {
            int status = failed && response.getStatus() < 400 ? 500 : response.getStatus();
            long durationMs = (System.nanoTime() - start) / 1_000_000;
            write(request.getMethod(), normalizePath(request.getRequestURI()), status, durationMs);
        }
    }

    static void write(String method, String path, int status, long durationMs) {
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
