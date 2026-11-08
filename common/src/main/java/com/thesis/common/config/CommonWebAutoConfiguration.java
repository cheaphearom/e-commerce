package com.thesis.common.config;

import com.thesis.common.chaos.ChaosController;
import com.thesis.common.chaos.ChaosService;
import com.thesis.common.logging.AccessLogFilter;
import com.thesis.common.logging.GlobalExceptionHandler;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.core.Ordered;

/**
 * Registers the access log, the global exception handler and fault injection in every servlet
 * service. The reactive gateway does not match the conditions and gets only the logging config.
 */
@AutoConfiguration
@ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
@ConditionalOnClass(name = "jakarta.servlet.Filter")
@Import({ChaosController.class, GlobalExceptionHandler.class})
public class CommonWebAutoConfiguration {

    /** Runs after the tracing observation filter so traceId/spanId are in the MDC. */
    static final int ACCESS_LOG_ORDER = Ordered.HIGHEST_PRECEDENCE + 10;

    @Bean
    @ConditionalOnMissingBean
    public ChaosService chaosService() {
        return new ChaosService();
    }

    @Bean
    public FilterRegistrationBean<AccessLogFilter> accessLogFilter() {
        FilterRegistrationBean<AccessLogFilter> registration = new FilterRegistrationBean<>(new AccessLogFilter());
        registration.setOrder(ACCESS_LOG_ORDER);
        registration.addUrlPatterns("/*");
        return registration;
    }
}
