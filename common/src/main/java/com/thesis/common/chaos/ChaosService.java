package com.thesis.common.chaos;

import java.io.UncheckedIOException;
import java.net.SocketTimeoutException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Objects;
import java.util.Random;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Function;
import org.springframework.dao.CannotAcquireLockException;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.dao.TransientDataAccessResourceException;

/**
 * Fault injection. Business code calls {@link #apply(String)} before its database work; while a
 * fault is active the call sleeps or throws. The fault expires by itself after its duration.
 *
 * <p>This class deliberately writes no log lines: the logs must show only the symptoms of a
 * fault (slow requests, exceptions, timeouts), never the fault itself.
 */
public class ChaosService {

    /** Abstraction over {@link Thread#sleep(long)} so tests run instantly. */
    @FunctionalInterface
    public interface Sleeper {
        void sleep(long millis) throws InterruptedException;
    }

    static final long MAX_DURATION_SEC = 3600;
    static final long MAX_LATENCY_MS = 60_000;
    private static final String INJECTOR_PACKAGE = ChaosService.class.getPackageName() + ".";

    private record ActiveFault(FaultType type, long latencyMs, double errorRate,
                               Instant activatedAt, Instant expiresAt) {
    }

    private final AtomicReference<ActiveFault> current = new AtomicReference<>();
    private final Clock clock;
    private final Random random;
    private final Sleeper sleeper;

    public ChaosService() {
        this(Clock.systemUTC(), new Random(), Thread::sleep);
    }

    public ChaosService(Clock clock, Random random, Sleeper sleeper) {
        this.clock = Objects.requireNonNull(clock);
        this.random = Objects.requireNonNull(random);
        this.sleeper = Objects.requireNonNull(sleeper);
    }

    public ChaosStatus activate(ChaosRequest request) {
        if (request == null || request.type() == null) {
            throw new IllegalArgumentException("type is required (LATENCY, ERROR or DB_TIMEOUT)");
        }
        FaultType type = request.type();
        long latency = request.latencyMs() != null ? request.latencyMs() : defaultLatency(type);
        double errorRate = request.errorRate() != null ? request.errorRate() : defaultErrorRate(type);
        long duration = request.durationSec() != null ? request.durationSec() : 120;
        if (latency < 0 || latency > MAX_LATENCY_MS) {
            throw new IllegalArgumentException("latencyMs must be between 0 and " + MAX_LATENCY_MS);
        }
        if (errorRate < 0.0 || errorRate > 1.0) {
            throw new IllegalArgumentException("errorRate must be between 0 and 1");
        }
        if (duration < 1 || duration > MAX_DURATION_SEC) {
            throw new IllegalArgumentException("durationSec must be between 1 and " + MAX_DURATION_SEC);
        }
        Instant now = clock.instant();
        ActiveFault fault = new ActiveFault(type, latency, errorRate, now, now.plus(Duration.ofSeconds(duration)));
        current.set(fault);
        return toStatus(fault);
    }

    public ChaosStatus clear() {
        current.set(null);
        return ChaosStatus.inactive();
    }

    public ChaosStatus status() {
        ActiveFault fault = activeFault();
        return fault == null ? ChaosStatus.inactive() : toStatus(fault);
    }

    /**
     * Applies the active fault, if any, to the named operation.
     *
     * @param operation a short name of the business operation, used in exception messages
     */
    public void apply(String operation) {
        ActiveFault fault = activeFault();
        if (fault == null) {
            return;
        }
        switch (fault.type()) {
            case LATENCY -> sleep(jitter(fault.latencyMs()));
            case ERROR -> {
                if (random.nextDouble() < fault.errorRate()) {
                    throw withoutInjectorFrames(randomException(operation));
                }
            }
            case DB_TIMEOUT -> {
                long waited = jitter(fault.latencyMs());
                sleep(waited);
                if (random.nextDouble() < fault.errorRate()) {
                    int waiting = 1 + random.nextInt(40);
                    throw withoutInjectorFrames(new QueryTimeoutException("JDBC query timeout after " + waited
                            + "ms during " + operation + "; HikariPool-1 - Connection is not available, request "
                            + "timed out (Total=10, Active=10, Idle=0, Waiting=" + waiting + ")"));
                }
            }
        }
    }

    /**
     * Removes this package's frames from the stack trace (and the cause's), so a logged stack
     * trace starts at the business method and never reveals that the failure was injected.
     */
    static <T extends Throwable> T withoutInjectorFrames(T error) {
        for (Throwable t = error; t != null; t = t.getCause()) {
            StackTraceElement[] frames = t.getStackTrace();
            t.setStackTrace(java.util.Arrays.stream(frames)
                    .filter(f -> !f.getClassName().startsWith(INJECTOR_PACKAGE))
                    .toArray(StackTraceElement[]::new));
            if (t.getCause() == t) {
                break;
            }
        }
        return error;
    }

    private ActiveFault activeFault() {
        ActiveFault fault = current.get();
        if (fault == null) {
            return null;
        }
        if (!clock.instant().isBefore(fault.expiresAt())) {
            current.compareAndSet(fault, null);
            return null;
        }
        return fault;
    }

    private long jitter(long latencyMs) {
        if (latencyMs <= 0) {
            return 0;
        }
        return Math.round(latencyMs * (0.75 + random.nextDouble() * 0.5));
    }

    private void sleep(long millis) {
        if (millis <= 0) {
            return;
        }
        try {
            sleeper.sleep(millis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    private static final java.util.List<Function<String, RuntimeException>> EXCEPTIONS = java.util.List.of(
            op -> new DataAccessResourceFailureException(
                    "Unable to acquire JDBC Connection during " + op),
            op -> new CannotAcquireLockException(
                    "could not obtain lock on row during " + op + "; SQL [select ... for update]"),
            op -> new TransientDataAccessResourceException(
                    "I/O error while sending to the backend during " + op),
            op -> new IllegalStateException(
                    "Connection reset by peer while executing " + op),
            op -> new UncheckedIOException(new SocketTimeoutException("Read timed out during " + op)),
            op -> new NullPointerException(
                    "Cannot invoke \"java.math.BigDecimal.compareTo(Object)\" because \"value\" is null in " + op));

    RuntimeException randomException(String operation) {
        return EXCEPTIONS.get(random.nextInt(EXCEPTIONS.size())).apply(operation);
    }

    private static long defaultLatency(FaultType type) {
        return switch (type) {
            case LATENCY -> 1500;
            case ERROR -> 0;
            case DB_TIMEOUT -> 3000;
        };
    }

    private static double defaultErrorRate(FaultType type) {
        return switch (type) {
            case LATENCY -> 0.0;
            case ERROR -> 0.3;
            case DB_TIMEOUT -> 0.5;
        };
    }

    private static ChaosStatus toStatus(ActiveFault fault) {
        return new ChaosStatus(true, fault.type(), fault.latencyMs(), fault.errorRate(),
                fault.activatedAt(), fault.expiresAt());
    }
}
