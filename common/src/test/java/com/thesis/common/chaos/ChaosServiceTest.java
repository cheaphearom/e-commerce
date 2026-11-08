package com.thesis.common.chaos;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.QueryTimeoutException;

class ChaosServiceTest {

    /** A clock the test can move forward. */
    static final class MutableClock extends Clock {
        private Instant now;

        MutableClock(Instant start) {
            this.now = start;
        }

        void advance(Duration d) {
            now = now.plus(d);
        }

        @Override
        public ZoneOffset getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }

    private MutableClock clock;
    private List<Long> sleeps;
    private ChaosService chaos;

    @BeforeEach
    void setUp() {
        clock = new MutableClock(Instant.parse("2026-01-01T00:00:00Z"));
        sleeps = new ArrayList<>();
        chaos = new ChaosService(clock, new Random(7), sleeps::add);
    }

    @Test
    void inactiveByDefaultAndApplyDoesNothing() {
        assertThat(chaos.status().active()).isFalse();
        assertThatCode(() -> chaos.apply("op")).doesNotThrowAnyException();
        assertThat(sleeps).isEmpty();
    }

    @Test
    void latencySleepsWithJitterAroundConfiguredValue() {
        chaos.activate(new ChaosRequest(FaultType.LATENCY, 1000L, null, 60L));
        for (int i = 0; i < 200; i++) {
            chaos.apply("op");
        }
        assertThat(sleeps).hasSize(200);
        assertThat(sleeps).allSatisfy(ms -> assertThat(ms).isBetween(750L, 1250L));
        double mean = sleeps.stream().mapToLong(Long::longValue).average().orElseThrow();
        assertThat(mean).isBetween(900.0, 1100.0);
    }

    @Test
    void errorFaultFailsAboutErrorRateOfCalls() {
        chaos.activate(new ChaosRequest(FaultType.ERROR, null, 0.3, 60L));
        int failures = 0;
        for (int i = 0; i < 2000; i++) {
            try {
                chaos.apply("op");
            } catch (RuntimeException e) {
                failures++;
            }
        }
        assertThat(failures / 2000.0).isBetween(0.25, 0.35);
        assertThat(sleeps).isEmpty();
    }

    @Test
    void errorRateOneAlwaysThrowsAndZeroNeverThrows() {
        chaos.activate(new ChaosRequest(FaultType.ERROR, null, 1.0, 60L));
        for (int i = 0; i < 50; i++) {
            assertThatThrownBy(() -> chaos.apply("op")).isInstanceOf(RuntimeException.class);
        }
        chaos.activate(new ChaosRequest(FaultType.ERROR, null, 0.0, 60L));
        for (int i = 0; i < 50; i++) {
            assertThatCode(() -> chaos.apply("op")).doesNotThrowAnyException();
        }
    }

    @Test
    void dbTimeoutSleepsThenThrowsHikariStyleTimeout() {
        chaos.activate(new ChaosRequest(FaultType.DB_TIMEOUT, 2000L, 1.0, 60L));
        assertThatThrownBy(() -> chaos.apply("reserveStock"))
                .isInstanceOf(QueryTimeoutException.class)
                .hasMessageContaining("JDBC query timeout")
                .hasMessageContaining("reserveStock")
                .hasMessageContaining("HikariPool-1")
                .hasMessageContaining("Total=10, Active=10, Idle=0, Waiting=");
        assertThat(sleeps).hasSize(1);
        assertThat(sleeps.get(0)).isBetween(1500L, 2500L);
    }

    @Test
    void faultExpiresByItself() {
        chaos.activate(new ChaosRequest(FaultType.ERROR, null, 1.0, 30L));
        assertThat(chaos.status().active()).isTrue();
        clock.advance(Duration.ofSeconds(29));
        assertThatThrownBy(() -> chaos.apply("op")).isInstanceOf(RuntimeException.class);
        clock.advance(Duration.ofSeconds(1));
        assertThatCode(() -> chaos.apply("op")).doesNotThrowAnyException();
        assertThat(chaos.status().active()).isFalse();
    }

    @Test
    void clearStopsTheFault() {
        chaos.activate(new ChaosRequest(FaultType.ERROR, null, 1.0, 600L));
        chaos.clear();
        assertThatCode(() -> chaos.apply("op")).doesNotThrowAnyException();
        assertThat(chaos.status()).isEqualTo(ChaosStatus.inactive());
    }

    @Test
    void defaultsAreFilledIn() {
        ChaosStatus status = chaos.activate(new ChaosRequest(FaultType.DB_TIMEOUT, null, null, null));
        assertThat(status.active()).isTrue();
        assertThat(status.latencyMs()).isEqualTo(3000);
        assertThat(status.errorRate()).isEqualTo(0.5);
        assertThat(Duration.between(status.activatedAt(), status.expiresAt())).isEqualTo(Duration.ofSeconds(120));
    }

    @Test
    void invalidRequestsAreRejected() {
        assertThatThrownBy(() -> chaos.activate(new ChaosRequest(null, 10L, 0.1, 10L)))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> chaos.activate(new ChaosRequest(FaultType.ERROR, null, 1.5, 10L)))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> chaos.activate(new ChaosRequest(FaultType.LATENCY, -1L, null, 10L)))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> chaos.activate(new ChaosRequest(FaultType.LATENCY, 100L, null, 0L)))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void thrownExceptionsDoNotRevealTheInjector() {
        chaos.activate(new ChaosRequest(FaultType.ERROR, null, 1.0, 60L));
        for (int i = 0; i < 50; i++) {
            try {
                chaos.apply("op");
            } catch (RuntimeException e) {
                for (Throwable t = e; t != null; t = t.getCause()) {
                    assertThat(t.getStackTrace())
                            .noneMatch(f -> f.getClassName().startsWith("com.thesis.common.chaos."));
                    assertThat(String.valueOf(t.getMessage()).toLowerCase()).doesNotContain("chaos");
                }
            }
        }
        chaos.activate(new ChaosRequest(FaultType.DB_TIMEOUT, 10L, 1.0, 60L));
        assertThatThrownBy(() -> chaos.apply("op"))
                .satisfies(e -> assertThat(e.getStackTrace())
                        .noneMatch(f -> f.getClassName().startsWith("com.thesis.common.chaos.")));
    }

    @Test
    void randomExceptionsMentionTheOperation() {
        for (int i = 0; i < 100; i++) {
            RuntimeException e = chaos.randomException("chargePayment");
            String text = e.getMessage() + (e.getCause() != null ? e.getCause().getMessage() : "");
            assertThat(text).contains("chargePayment");
        }
    }
}
