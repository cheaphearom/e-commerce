package com.thesis.inventory.api;

import com.thesis.inventory.domain.Product;
import java.math.BigDecimal;

public record ProductView(String id, String name, BigDecimal price, int availableStock, int reservedStock) {

    public static ProductView of(Product p) {
        return new ProductView(p.getId(), p.getName(), p.getPrice(), p.getAvailableStock(), p.getReservedStock());
    }
}
