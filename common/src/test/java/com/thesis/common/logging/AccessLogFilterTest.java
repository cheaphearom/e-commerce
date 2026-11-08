package com.thesis.common.logging;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.servlet.http.HttpServletResponse;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class AccessLogFilterTest {

    @ParameterizedTest
    @CsvSource({
            "/api/orders, /api/orders",
            "/api/orders/, /api/orders/",
            "/api/orders/3f2a9c1e-4b5d-4e6f-8a7b-9c0d1e2f3a4b, /api/orders/{id}",
            "/api/products/P-100/restock, /api/products/{id}/restock",
            "/api/accounts/C-007/topup, /api/accounts/{id}/topup",
            "/api/items/12345, /api/items/{id}",
            "/api/blobs/0123456789abcdef0123, /api/blobs/{id}",
            "/api/orders?limit=20, /api/orders",
            "/api/v2/orders, /api/v2/orders"
    })
    void normalizesIdentifiersInPaths(String raw, String expected) {
        assertThat(AccessLogFilter.normalizePath(raw)).isEqualTo(expected);
    }

    @Test
    void emptyOrNullPathBecomesRoot() {
        assertThat(AccessLogFilter.normalizePath(null)).isEqualTo("/");
        assertThat(AccessLogFilter.normalizePath("")).isEqualTo("/");
    }

    @Test
    void adminAndActuatorPathsAreExcluded() {
        assertThat(AccessLogFilter.isExcluded("/admin/chaos")).isTrue();
        assertThat(AccessLogFilter.isExcluded("/admin")).isTrue();
        assertThat(AccessLogFilter.isExcluded("/actuator/health")).isTrue();
        assertThat(AccessLogFilter.isExcluded("/api/orders")).isFalse();
        assertThat(AccessLogFilter.isExcluded("/administrator")).isFalse();
    }

    @Test
    void filterPassesRequestThroughAndSkipsExcludedPaths() throws Exception {
        AccessLogFilter filter = new AccessLogFilter();
        AtomicBoolean called = new AtomicBoolean();

        MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/orders/42");
        MockHttpServletResponse response = new MockHttpServletResponse();
        filter.doFilter(request, response, (req, res) -> {
            called.set(true);
            ((HttpServletResponse) res).setStatus(404);
        });
        assertThat(called).isTrue();
        assertThat(response.getStatus()).isEqualTo(404);

        called.set(false);
        MockHttpServletRequest admin = new MockHttpServletRequest("POST", "/admin/chaos");
        filter.doFilter(admin, new MockHttpServletResponse(), (req, res) -> called.set(true));
        assertThat(called).isTrue();
    }
}
