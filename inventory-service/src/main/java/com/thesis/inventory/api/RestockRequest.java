package com.thesis.inventory.api;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

public record RestockRequest(@Min(1) @Max(100_000) int quantity) {
}
