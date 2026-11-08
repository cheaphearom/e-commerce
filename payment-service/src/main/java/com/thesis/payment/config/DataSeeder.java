package com.thesis.payment.config;

import static net.logstash.logback.argument.StructuredArguments.kv;

import com.thesis.payment.domain.Account;
import com.thesis.payment.domain.AccountRepository;
import java.math.BigDecimal;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Seeds customers C-001..C-020. Every 7th customer (C-007, C-014) gets a small balance so a
 * share of payments is declined during normal operation - business noise, not an anomaly.
 */
@Component
public class DataSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DataSeeder.class);
    static final int CUSTOMERS = 20;

    private final AccountRepository accounts;
    private final BigDecimal initialBalance;
    private final BigDecimal smallBalance;

    public DataSeeder(AccountRepository accounts,
                      @Value("${payment.initial-balance:1000000}") BigDecimal initialBalance,
                      @Value("${payment.small-balance:50}") BigDecimal smallBalance) {
        this.accounts = accounts;
        this.initialBalance = initialBalance;
        this.smallBalance = smallBalance;
    }

    public static String customerId(int index) {
        return String.format("C-%03d", index);
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        int created = 0;
        for (int i = 1; i <= CUSTOMERS; i++) {
            String id = customerId(i);
            if (!accounts.existsById(id)) {
                accounts.save(new Account(id, i % 7 == 0 ? smallBalance : initialBalance));
                created++;
            }
        }
        log.info("Customer accounts seeded {} {}", kv("event", "data_seeded"), kv("created", created));
    }
}
