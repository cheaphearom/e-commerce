package com.thesis.common.saga;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;

/** The fixed product catalogue shared by the order and inventory services. */
public final class Catalog {

    public record Product(String id, String name, BigDecimal price) {
    }

    public static final List<Product> PRODUCTS = List.of(
            new Product("P-100", "USB-C Cable", new BigDecimal("9.99")),
            new Product("P-101", "Wireless Mouse", new BigDecimal("24.50")),
            new Product("P-102", "Mechanical Keyboard", new BigDecimal("89.00")),
            new Product("P-103", "27-inch Monitor", new BigDecimal("249.00")),
            new Product("P-104", "Laptop Stand", new BigDecimal("39.90")),
            new Product("P-105", "Noise-Cancelling Headphones", new BigDecimal("179.00")));

    private Catalog() {
    }

    public static Optional<Product> find(String productId) {
        return PRODUCTS.stream().filter(p -> p.id().equals(productId)).findFirst();
    }
}
