package com.thesis.payment.api;

import com.thesis.payment.domain.Account;
import java.math.BigDecimal;

public record AccountView(String customerId, BigDecimal balance) {

    public static AccountView of(Account a) {
        return new AccountView(a.getCustomerId(), a.getBalance());
    }
}
