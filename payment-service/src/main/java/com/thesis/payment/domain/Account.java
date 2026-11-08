package com.thesis.payment.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.math.BigDecimal;

@Entity
@Table(name = "accounts")
public class Account {

    @Id
    private String customerId;

    @Column(nullable = false, precision = 14, scale = 2)
    private BigDecimal balance;

    @Version
    private Long version;

    protected Account() {
    }

    public Account(String customerId, BigDecimal balance) {
        this.customerId = customerId;
        this.balance = balance;
    }

    public boolean canPay(BigDecimal amount) {
        return balance.compareTo(amount) >= 0;
    }

    public void debit(BigDecimal amount) {
        if (!canPay(amount)) {
            throw new IllegalStateException("Insufficient funds for " + customerId);
        }
        balance = balance.subtract(amount);
    }

    public void credit(BigDecimal amount) {
        balance = balance.add(amount);
    }

    public String getCustomerId() {
        return customerId;
    }

    public BigDecimal getBalance() {
        return balance;
    }
}
