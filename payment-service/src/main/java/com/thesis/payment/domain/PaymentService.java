package com.thesis.payment.domain;

import static net.logstash.logback.argument.StructuredArguments.kv;

import com.thesis.common.chaos.ChaosService;
import com.thesis.common.saga.PaymentCommand;
import com.thesis.common.saga.PaymentReply;
import java.math.BigDecimal;
import java.time.Clock;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class PaymentService {

    private static final Logger log = LoggerFactory.getLogger(PaymentService.class);

    private final AccountRepository accounts;
    private final PaymentRepository payments;
    private final ChaosService chaos;
    private final Clock clock = Clock.systemUTC();

    public PaymentService(AccountRepository accounts, PaymentRepository payments, ChaosService chaos) {
        this.accounts = accounts;
        this.payments = payments;
        this.chaos = chaos;
    }

    @Transactional
    public PaymentReply handle(PaymentCommand command) {
        return switch (command.type()) {
            case CHARGE -> charge(command);
            case REFUND -> refund(command);
        };
    }

    private PaymentReply charge(PaymentCommand command) {
        var existing = payments.findById(command.orderId());
        if (existing.isPresent()) {
            Payment p = existing.get();
            return switch (p.getStatus()) {
                case CHARGED -> PaymentReply.ok(command);
                case DECLINED -> PaymentReply.failed(command, p.getReason());
                case REFUNDED -> PaymentReply.failed(command, "ALREADY_REFUNDED");
            };
        }
        chaos.apply("chargePayment");
        var now = clock.instant();
        Account account = accounts.findForUpdate(command.customerId()).orElse(null);
        if (account == null) {
            payments.save(new Payment(command.orderId(), command.sagaId(), command.customerId(), command.amount(),
                    PaymentStatus.DECLINED, "UNKNOWN_CUSTOMER", now));
            return PaymentReply.failed(command, "UNKNOWN_CUSTOMER");
        }
        if (!account.canPay(command.amount())) {
            payments.save(new Payment(command.orderId(), command.sagaId(), command.customerId(), command.amount(),
                    PaymentStatus.DECLINED, "INSUFFICIENT_FUNDS", now));
            log.info("Payment declined {} {} {} {}",
                    kv("event", "payment_declined"),
                    kv("orderId", command.orderId()),
                    kv("customerId", command.customerId()),
                    kv("reason", "INSUFFICIENT_FUNDS"));
            return PaymentReply.failed(command, "INSUFFICIENT_FUNDS");
        }
        account.debit(command.amount());
        payments.save(new Payment(command.orderId(), command.sagaId(), command.customerId(), command.amount(),
                PaymentStatus.CHARGED, null, now));
        log.info("Payment charged {} {} {} {}",
                kv("event", "payment_charged"),
                kv("orderId", command.orderId()),
                kv("customerId", command.customerId()),
                kv("amount", command.amount()));
        return PaymentReply.ok(command);
    }

    private PaymentReply refund(PaymentCommand command) {
        chaos.apply("refundPayment");
        var now = clock.instant();
        var existing = payments.findById(command.orderId());
        if (existing.isEmpty()) {
            // REFUND overtook CHARGE (saga timeout): remember it so a late CHARGE is rejected.
            payments.save(new Payment(command.orderId(), command.sagaId(), command.customerId(), BigDecimal.ZERO,
                    PaymentStatus.REFUNDED, "REFUNDED_BEFORE_CHARGE", now));
            return PaymentReply.ok(command);
        }
        Payment payment = existing.get();
        if (payment.getStatus() == PaymentStatus.CHARGED) {
            Account account = accounts.findForUpdate(payment.getCustomerId()).orElseThrow();
            account.credit(payment.getAmount());
            payment.markRefunded(now);
            log.info("Payment refunded {} {} {} {}",
                    kv("event", "payment_refunded"),
                    kv("orderId", command.orderId()),
                    kv("customerId", payment.getCustomerId()),
                    kv("amount", payment.getAmount()));
        }
        return PaymentReply.ok(command);
    }

    @Transactional(readOnly = true)
    public List<Account> listAccounts() {
        chaos.apply("listAccounts");
        return accounts.findAll(Sort.by("customerId"));
    }

    @Transactional
    public Account topUp(String customerId, BigDecimal amount) {
        chaos.apply("topUp");
        Account account = accounts.findForUpdate(customerId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Account " + customerId + " not found"));
        account.credit(amount);
        log.info("Account topped up {} {} {}",
                kv("event", "account_topped_up"),
                kv("customerId", customerId),
                kv("amount", amount));
        return account;
    }
}
