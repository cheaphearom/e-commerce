import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:thesis_mobile/src/api.dart';
import 'package:thesis_mobile/src/config.dart';

/// An in-memory gateway (port 8080) and ml-detector (port 8000) that records every request.
class FakeBackend {
  String? experimentRunning;
  bool gatewayDown = false;
  bool monitorDown = false;
  final List<http.Request> requests = [];
  final List<Map<String, dynamic>> placedOrders = [];
  final List<Map<String, dynamic>> injectedFaults = [];

  static const config = ServerConfig(host: 'pc.test');

  Api api() => Api(config, client: MockClient(_handle));

  List<http.Request> get gatewayRequests => requests.where((r) => r.url.port == 8080).toList();

  Future<http.Response> _handle(http.Request r) async {
    requests.add(r);
    final gateway = r.url.port == 8080;
    if ((gateway && gatewayDown) || (!gateway && monitorDown)) {
      throw http.ClientException('Connection refused', r.url);
    }
    final key = '${r.method} ${r.url.path}';
    return switch (key) {
      'GET /api/products' => _json([
          {'id': 'P-100', 'name': 'USB-C Cable', 'price': 9.99, 'availableStock': 474, 'reservedStock': 26},
          {'id': 'P-101', 'name': 'Wireless Mouse', 'price': 24.5, 'availableStock': 472, 'reservedStock': 28},
        ]),
      'GET /api/accounts' => _json([
          {'customerId': 'C-001', 'balance': 998643.5},
          {'customerId': 'C-007', 'balance': 50.0},
        ]),
      'GET /api/orders' => _json([
          for (final o in placedOrders.reversed) o,
          {'id': 'o-1', 'customerId': 'C-007', 'productId': 'P-101', 'quantity': 2, 'amount': 49.0,
            'status': 'CANCELLED', 'failureReason': 'INSUFFICIENT_FUNDS', 'createdAt': '2026-11-11T03:50:29Z'},
          {'id': 'o-0', 'customerId': 'C-001', 'productId': 'P-100', 'quantity': 1, 'amount': 9.99,
            'status': 'COMPLETED', 'failureReason': null, 'createdAt': '2026-11-11T03:50:25Z'},
        ]),
      'POST /api/orders' => _placeOrder(r),
      'GET /api/services' => _json({
          'services': [
            {'name': 'api-gateway', 'health': 'UP', 'fault': null},
            {'name': 'order-service', 'health': 'UP', 'fault': {'active': false}},
            {'name': 'inventory-service', 'health': 'UP',
              'fault': {'active': true, 'type': 'DB_TIMEOUT', 'latencyMs': 3000, 'errorRate': 0.4}},
            {'name': 'payment-service', 'health': 'DOWN', 'fault': null},
          ],
          'experiment_running': experimentRunning == null ? null : {'out': '/results/$experimentRunning'},
          'telegram': false,
        }),
      'GET /detect' => _json({
          'status': 'anomaly',
          'window_start': '2026-11-11T04:17:20+00:00',
          'window_end': '2026-11-11T04:17:50+00:00',
          'methods': {
            'rules': {'score': 1.35, 'threshold': 1.0, 'alert': true, 'fired_rules': ['gateway_p95_latency']},
            'isolation_forest': {'score': 0.61, 'threshold': 0.69, 'alert': false},
          },
          'features': {'api-gateway__http_count': 158, 'api-gateway__latency_p95': 3586, 'system__saga_timeout': 77},
          'explanation': null,
        }),
      'GET /api/history' => _json({
          'points': [
            for (var i = 0; i < 12; i++)
              {'t': 1794369000 + i * 10, 'methods': {'rules': {'score': i / 8, 'threshold': 1.0, 'alert': i > 8}}},
          ],
        }),
      'GET /alerts' => _json({
          'count': 1,
          'alerts': [
            {
              'raised_at': '2026-11-11T04:17:58+00:00', 'method': 'rules', 'window_end': '2026-11-11T04:17:50+00:00',
              'score': 1.35, 'threshold': 1.0, 'fired_rules': ['gateway_p95_latency'],
              'explanation': {
                'suspected_service': 'payment-service', 'suspected_problem': 'slow responses (like LATENCY)',
                'top_signals': [{'text': 'payment-service: p95 latency (ms) = 3586 ms (normal ≈ 50 ms)'}],
                'notes': ['orders are getting stuck (saga timeouts)'],
                'example_errors': ['[order-service] Saga timed out event=saga_timeout'],
              },
            },
          ],
        }),
      'GET /api/experiments' => _json({
          'experiment_running': null,
          'experiments': [
            {'name': 'trial_1', 'status': 'completed', 'faults': 9, 'seed': 1, 'duration_min': 30.0,
              'evaluation': {'metrics': {'rules': {'f1': 0.45}, 'random_forest': {'f1': 0.82}}}},
            {'name': 'run_2', 'status': 'completed', 'faults': 12, 'evaluation': null},
          ],
        }),
      _ when r.url.path.startsWith('/api/chaos/') => _chaos(r),
      _ => http.Response('{"detail":"not found"}', 404),
    };
  }

  http.Response _placeOrder(http.Request r) {
    final body = jsonDecode(r.body) as Map<String, dynamic>;
    final order = {'id': 'o-${placedOrders.length + 2}', ...body, 'amount': 24.5 * (body['quantity'] as int),
      'status': 'PENDING', 'failureReason': null, 'createdAt': '2026-11-11T05:00:00Z'};
    placedOrders.add(order);
    return _json(order, 202);
  }

  http.Response _chaos(http.Request r) {
    if (experimentRunning != null) {
      return _json({'detail': 'an experiment is running ($experimentRunning); manual faults would spoil its results.'}, 409);
    }
    if (r.method == 'POST') injectedFaults.add({'service': r.url.pathSegments.last, ...jsonDecode(r.body)});
    return _json({'active': r.method == 'POST'});
  }

  static http.Response _json(Object body, [int status = 200]) =>
      http.Response.bytes(utf8.encode(jsonEncode(body)), status, headers: {'content-type': 'application/json'});
}
