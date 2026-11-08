package com.thesis.inventory.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.math.BigDecimal;

@Entity
@Table(name = "products")
public class Product {

    @Id
    private String id;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false, precision = 12, scale = 2)
    private BigDecimal price;

    private int availableStock;

    private int reservedStock;

    @Version
    private Long version;

    protected Product() {
    }

    public Product(String id, String name, BigDecimal price, int availableStock) {
        this.id = id;
        this.name = name;
        this.price = price;
        this.availableStock = availableStock;
        this.reservedStock = 0;
    }

    public boolean canReserve(int quantity) {
        return availableStock >= quantity;
    }

    public void reserve(int quantity) {
        if (!canReserve(quantity)) {
            throw new IllegalStateException("Insufficient stock for " + id);
        }
        availableStock -= quantity;
        reservedStock += quantity;
    }

    public void release(int quantity) {
        int returned = Math.min(quantity, reservedStock);
        reservedStock -= returned;
        availableStock += returned;
    }

    public void restock(int quantity) {
        availableStock += quantity;
    }

    public String getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public BigDecimal getPrice() {
        return price;
    }

    public int getAvailableStock() {
        return availableStock;
    }

    public int getReservedStock() {
        return reservedStock;
    }
}
