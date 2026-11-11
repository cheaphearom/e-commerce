import 'package:flutter/material.dart';

import 'api.dart';
import 'models.dart';
import 'polling.dart';
import 'theme.dart';

/// The shop: choose a customer, order products and follow each order through the saga.
///
/// Every shop request is real traffic through the gateway and ends up in the analysed logs.
/// So the screen first asks the monitor whether an experiment is running and, if one is, makes
/// no shop request at all until it has finished.
class ShopScreen extends StatefulWidget {
  const ShopScreen({super.key, required this.api, this.refreshInterval = const Duration(seconds: 5)});

  final Api api;
  final Duration? refreshInterval;

  @override
  State<ShopScreen> createState() => _ShopScreenState();
}

class _ShopScreenState extends State<ShopScreen> with Polling<ShopScreen> {
  List<Product> _products = const [];
  List<Account> _accounts = const [];
  List<Order> _orders = const [];
  String? _customer;
  final Map<String, int> _quantity = {};
  final Set<String> _placing = {};
  String? _experiment;
  bool _monitorReachable = true;
  String? _error;
  bool _loaded = false;

  @override
  Duration? get refreshInterval => widget.refreshInterval;

  @override
  void initState() {
    super.initState();
    startPolling();
  }

  @override
  Future<void> refresh() async {
    String? experiment;
    var monitorOk = true;
    try {
      experiment = (await widget.api.status()).experimentRunning;
    } on ApiException {
      monitorOk = false;   // cannot check; the shop still works, with a note
    }
    if (!mounted) return;
    if (experiment != null) {
      setState(() {
        _experiment = experiment;
        _monitorReachable = true;
        _error = null;
        _loaded = true;
      });
      return;
    }
    try {
      final results = await Future.wait([widget.api.products(), widget.api.accounts(), widget.api.orders()]);
      if (!mounted) return;
      setState(() {
        _products = results[0] as List<Product>;
        _accounts = results[1] as List<Account>;
        _orders = results[2] as List<Order>;
        _customer ??= _accounts.isNotEmpty ? _accounts.first.customerId : null;
        _experiment = null;
        _monitorReachable = monitorOk;
        _error = null;
        _loaded = true;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _experiment = null;
        _monitorReachable = monitorOk;
        _error = e.message;
        _loaded = true;
      });
    }
  }

  Future<void> _order(Product p) async {
    final customer = _customer;
    if (customer == null || _experiment != null) return;
    final qty = _quantity[p.id] ?? 1;
    setState(() => _placing.add(p.id));
    final messenger = ScaffoldMessenger.of(context);
    try {
      final order = await widget.api.placeOrder(customerId: customer, productId: p.id, quantity: qty);
      messenger.showSnackBar(SnackBar(content: Text('Order for $qty × ${p.name} placed (${order.status.toLowerCase()})')));
      await refresh();
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('Order failed: ${e.message}')));
    } finally {
      if (mounted) setState(() => _placing.remove(p.id));
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_loaded) return const Center(child: CircularProgressIndicator());
    return RefreshIndicator(
      onRefresh: refresh,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          if (_experiment != null) _ExperimentPaused(name: _experiment!),
          if (_experiment == null && _error != null) _ErrorCard(message: _error!, onRetry: refresh),
          if (_experiment == null && _error == null) ...[
            if (!_monitorReachable)
              const _Note('The monitor is not reachable, so the app cannot check for a running experiment. '
                  'Do not order while one runs.'),
            _customerCard(context),
            const _SectionTitle('Products'),
            for (final p in _products) _productCard(context, p),
            const _SectionTitle('Recent orders'),
            if (_orders.isEmpty) const Text('No orders yet.'),
            for (final o in _orders) _OrderTile(order: o, product: _productName(o.productId)),
          ],
        ],
      ),
    );
  }

  String _productName(String id) => _products.where((p) => p.id == id).map((p) => p.name).firstOrNull ?? id;

  Widget _customerCard(BuildContext context) {
    final account = _accounts.where((a) => a.customerId == _customer).firstOrNull;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(children: [
          const Text('Customer'),
          const SizedBox(width: 12),
          DropdownButton<String>(
            key: const Key('customer'),
            value: _customer,
            items: [for (final a in _accounts) DropdownMenuItem(value: a.customerId, child: Text(a.customerId))],
            onChanged: (v) => setState(() => _customer = v),
          ),
          const Spacer(),
          if (account != null) Flexible(child: Text('Balance ${formatMoney(account.balance)}', textAlign: TextAlign.end)),
        ]),
      ),
    );
  }

  Widget _productCard(BuildContext context, Product p) {
    final qty = _quantity[p.id] ?? 1;
    final theme = Theme.of(context);
    return Card(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
        child: Row(children: [
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(p.name, style: theme.textTheme.titleSmall),
              Text('${p.id} · ${formatMoney(p.price)}', style: theme.textTheme.bodySmall),
              Text('${p.availableStock} in stock · ${p.reservedStock} reserved', style: theme.textTheme.bodySmall),
            ]),
          ),
          IconButton(
            tooltip: 'Fewer',
            icon: const Icon(Icons.remove_circle_outline),
            onPressed: qty > 1 ? () => setState(() => _quantity[p.id] = qty - 1) : null,
          ),
          Text('$qty', key: Key('qty-${p.id}')),
          IconButton(
            tooltip: 'More',
            icon: const Icon(Icons.add_circle_outline),
            onPressed: qty < 10 ? () => setState(() => _quantity[p.id] = qty + 1) : null,
          ),
          FilledButton(
            key: Key('order-${p.id}'),
            onPressed: _placing.contains(p.id) || _customer == null ? null : () => _order(p),
            child: const Text('Order'),
          ),
        ]),
      ),
    );
  }
}

class _OrderTile extends StatelessWidget {
  const _OrderTile({required this.order, required this.product});

  final Order order;
  final String product;

  @override
  Widget build(BuildContext context) {
    final (label, color) = switch (order.status) {
      'COMPLETED' => ('Completed', statusGood),
      'CANCELLED' => ('Cancelled', statusCritical),
      _ => ('In progress', statusWarning),
    };
    return ListTile(
      contentPadding: EdgeInsets.zero,
      dense: true,
      title: Text('${order.customerId} · ${order.quantity} × $product'),
      subtitle: Text([formatTime(order.createdAt), formatMoney(order.amount),
        if (order.failureReason != null) order.failureReason!].join(' · ')),
      trailing: StatusChip(label: label, color: color),
    );
  }
}

/// Status label with an icon, so the state never depends on colour alone.
class StatusChip extends StatelessWidget {
  const StatusChip({super.key, required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final icon = color == statusGood
        ? Icons.check_circle
        : color == statusCritical
            ? Icons.error
            : Icons.schedule;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(12)),
      child: Row(mainAxisSize: MainAxisSize.min, children: [
        Icon(icon, size: 14, color: color),
        const SizedBox(width: 4),
        Text(label, style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w600)),
      ]),
    );
  }
}

class _ExperimentPaused extends StatelessWidget {
  const _ExperimentPaused({required this.name});

  final String name;

  @override
  Widget build(BuildContext context) => Card(
        color: statusWarning.withValues(alpha: 0.12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              const Icon(Icons.science, color: statusWarning),
              const SizedBox(width: 8),
              Expanded(child: Text('Experiment running ($name)', style: Theme.of(context).textTheme.titleSmall)),
            ]),
            const SizedBox(height: 8),
            const Text('The shop is paused: its requests would be real traffic in the experiment\'s logs. '
                'It comes back by itself when the experiment has finished. The Monitor tab stays live.'),
          ]),
        ),
      );
}

class _ErrorCard extends StatelessWidget {
  const _ErrorCard({required this.message, required this.onRetry});

  final String message;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Row(children: [Icon(Icons.cloud_off, color: statusCritical), SizedBox(width: 8), Text('Shop not reachable')]),
            const SizedBox(height: 8),
            Text(message),
            const SizedBox(height: 8),
            OutlinedButton(onPressed: onRetry, child: const Text('Try again')),
          ]),
        ),
      );
}

class _Note extends StatelessWidget {
  const _Note(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Icon(Icons.info_outline, size: 18, color: statusWarning),
          const SizedBox(width: 6),
          Expanded(child: Text(text, style: Theme.of(context).textTheme.bodySmall)),
        ]),
      );
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(0, 16, 0, 4),
        child: Text(text, style: Theme.of(context).textTheme.titleMedium),
      );
}
