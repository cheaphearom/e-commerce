package com.thesis.order.api;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;

public record CreateOrderRequest(
        @NotBlank String customerId,
        @NotBlank String productId,
        @Min(1) @Max(100) int quantity) {
}
