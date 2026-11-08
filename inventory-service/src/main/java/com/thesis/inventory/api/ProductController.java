package com.thesis.inventory.api;

import com.thesis.inventory.domain.InventoryService;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/products")
public class ProductController {

    private final InventoryService inventory;

    public ProductController(InventoryService inventory) {
        this.inventory = inventory;
    }

    @GetMapping
    public List<ProductView> list() {
        return inventory.listProducts().stream().map(ProductView::of).toList();
    }

    @PostMapping("/{id}/restock")
    public ProductView restock(@PathVariable String id, @Valid @RequestBody RestockRequest request) {
        return ProductView.of(inventory.restock(id, request.quantity()));
    }
}
