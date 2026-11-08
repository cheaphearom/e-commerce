package com.thesis.payment.api;

import com.thesis.payment.domain.PaymentService;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/accounts")
public class AccountController {

    private final PaymentService payments;

    public AccountController(PaymentService payments) {
        this.payments = payments;
    }

    @GetMapping
    public List<AccountView> list() {
        return payments.listAccounts().stream().map(AccountView::of).toList();
    }

    @PostMapping("/{id}/topup")
    public AccountView topUp(@PathVariable String id, @Valid @RequestBody TopUpRequest request) {
        return AccountView.of(payments.topUp(id, request.amount()));
    }
}
