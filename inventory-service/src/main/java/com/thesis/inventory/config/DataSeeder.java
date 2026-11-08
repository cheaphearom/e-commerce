package com.thesis.inventory.config;

import static net.logstash.logback.argument.StructuredArguments.kv;

import com.thesis.common.saga.Catalog;
import com.thesis.inventory.domain.Product;
import com.thesis.inventory.domain.ProductRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** Seeds every catalogue product with the initial stock (500 units by default). */
@Component
public class DataSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DataSeeder.class);

    private final ProductRepository products;
    private final int initialStock;

    public DataSeeder(ProductRepository products, @Value("${inventory.initial-stock:500}") int initialStock) {
        this.products = products;
        this.initialStock = initialStock;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        int created = 0;
        for (Catalog.Product p : Catalog.PRODUCTS) {
            if (!products.existsById(p.id())) {
                products.save(new Product(p.id(), p.name(), p.price(), initialStock));
                created++;
            }
        }
        log.info("Product catalogue seeded {} {}", kv("event", "data_seeded"), kv("created", created));
    }
}
