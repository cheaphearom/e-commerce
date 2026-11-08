package com.thesis.payment.api;

import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;

public record TopUpRequest(@NotNull @DecimalMin("0.01") @DecimalMax("10000000") BigDecimal amount) {
}
