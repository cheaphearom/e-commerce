package com.thesis.inventory.domain;

import static net.logstash.logback.argument.StructuredArguments.kv;

import com.thesis.common.chaos.ChaosService;
import com.thesis.common.saga.InventoryCommand;
import com.thesis.common.saga.InventoryReply;
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
public class InventoryService {

    private static final Logger log = LoggerFactory.getLogger(InventoryService.class);

    private final ProductRepository products;
    private final ReservationRepository reservations;
    private final ChaosService chaos;
    private final Clock clock = Clock.systemUTC();

    public InventoryService(ProductRepository products, ReservationRepository reservations, ChaosService chaos) {
        this.products = products;
        this.reservations = reservations;
        this.chaos = chaos;
    }

    @Transactional
    public InventoryReply handle(InventoryCommand command) {
        return switch (command.type()) {
            case RESERVE -> reserve(command);
            case RELEASE -> release(command);
        };
    }

    private InventoryReply reserve(InventoryCommand command) {
        var existing = reservations.findById(command.orderId());
        if (existing.isPresent()) {
            Reservation r = existing.get();
            return switch (r.getStatus()) {
                case RESERVED -> InventoryReply.ok(command);
                case RELEASED -> InventoryReply.failed(command, "ALREADY_RELEASED");
                case REJECTED -> InventoryReply.failed(command, r.getReason());
            };
        }
        chaos.apply("reserveStock");
        var now = clock.instant();
        Product product = products.findForUpdate(command.productId()).orElse(null);
        if (product == null) {
            reservations.save(new Reservation(command.orderId(), command.sagaId(), command.productId(),
                    command.quantity(), ReservationStatus.REJECTED, "UNKNOWN_PRODUCT", now));
            return InventoryReply.failed(command, "UNKNOWN_PRODUCT");
        }
        if (!product.canReserve(command.quantity())) {
            reservations.save(new Reservation(command.orderId(), command.sagaId(), command.productId(),
                    command.quantity(), ReservationStatus.REJECTED, "OUT_OF_STOCK", now));
            log.info("Stock reservation rejected {} {} {} {} {}",
                    kv("event", "stock_rejected"),
                    kv("orderId", command.orderId()),
                    kv("productId", product.getId()),
                    kv("requested", command.quantity()),
                    kv("available", product.getAvailableStock()));
            return InventoryReply.failed(command, "OUT_OF_STOCK");
        }
        product.reserve(command.quantity());
        reservations.save(new Reservation(command.orderId(), command.sagaId(), command.productId(),
                command.quantity(), ReservationStatus.RESERVED, null, now));
        log.info("Stock reserved {} {} {} {}",
                kv("event", "stock_reserved"),
                kv("orderId", command.orderId()),
                kv("productId", product.getId()),
                kv("quantity", command.quantity()));
        return InventoryReply.ok(command);
    }

    private InventoryReply release(InventoryCommand command) {
        chaos.apply("releaseStock");
        var now = clock.instant();
        var existing = reservations.findById(command.orderId());
        if (existing.isEmpty()) {
            // RELEASE overtook RESERVE (saga timeout): remember it so a late RESERVE is rejected.
            reservations.save(new Reservation(command.orderId(), command.sagaId(), command.productId(),
                    0, ReservationStatus.RELEASED, "RELEASED_BEFORE_RESERVE", now));
            return InventoryReply.ok(command);
        }
        Reservation reservation = existing.get();
        if (reservation.getStatus() == ReservationStatus.RESERVED) {
            Product product = products.findForUpdate(reservation.getProductId()).orElseThrow();
            product.release(reservation.getQuantity());
            reservation.markReleased(now);
            log.info("Stock released {} {} {} {}",
                    kv("event", "stock_released"),
                    kv("orderId", command.orderId()),
                    kv("productId", product.getId()),
                    kv("quantity", reservation.getQuantity()));
        }
        return InventoryReply.ok(command);
    }

    @Transactional(readOnly = true)
    public List<Product> listProducts() {
        chaos.apply("listProducts");
        return products.findAll(Sort.by("id"));
    }

    @Transactional
    public Product restock(String productId, int quantity) {
        chaos.apply("restock");
        Product product = products.findForUpdate(productId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Product " + productId + " not found"));
        product.restock(quantity);
        log.info("Product restocked {} {} {} {}",
                kv("event", "stock_restocked"),
                kv("productId", productId),
                kv("quantity", quantity),
                kv("available", product.getAvailableStock()));
        return product;
    }
}
