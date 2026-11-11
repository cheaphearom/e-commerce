import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:thesis_mobile/src/api.dart';
import 'package:thesis_mobile/src/config.dart';
import 'package:thesis_mobile/src/models.dart';
import 'package:thesis_mobile/src/theme.dart';

import 'fake_backend.dart';

void main() {
  group('ServerConfig', () {
    test('host input is normalised', () {
      expect(ServerConfig.normaliseHost(' 192.168.1.20 '), '192.168.1.20');
      expect(ServerConfig.normaliseHost('http://my-pc.local:8080/'), 'my-pc.local');
      expect(ServerConfig.validateHost('   '), isNotNull);
      expect(ServerConfig.validatePort('8080'), isNull);
      expect(ServerConfig.validatePort('0'), isNotNull);
      expect(ServerConfig.validatePort('70000'), isNotNull);
      expect(ServerConfig.validatePort('abc'), isNotNull);
    });

    test('defaults: emulator alias on Android, page host on the web', () {
      expect(ServerConfig.defaults(web: false).host, '10.0.2.2');
      expect(ServerConfig.defaults(web: true, pageUri: Uri.parse('http://192.168.1.20:5000/')).host, '192.168.1.20');
      expect(ServerConfig.defaults(web: true, pageUri: Uri.parse('file:///index.html')).host, 'localhost');
    });

    test('urls and persistence', () async {
      SharedPreferences.setMockInitialValues({});
      const c = ServerConfig(host: '192.168.1.20', gatewayPort: 9080, monitorPort: 9000);
      expect(c.gateway.toString(), 'http://192.168.1.20:9080');
      expect(c.monitor.toString(), 'http://192.168.1.20:9000');
      await c.save();
      expect(await ServerConfig.load(), c);
    });
  });

  group('models', () {
    test('services, faults and the experiment lock', () {
      final s = SystemStatus.fromJson({
        'services': [
          {'name': 'inventory-service', 'health': 'UP', 'fault': {'active': true, 'type': 'DB_TIMEOUT', 'latencyMs': 3000, 'errorRate': 0.4}},
          {'name': 'order-service', 'health': 'DOWN', 'fault': {'active': false}},
        ],
        'experiment_running': {'out': '/results/run_3'},
      });
      expect(s.experimentRunning, 'run_3');
      expect(s.services.first.fault!.describe(), 'DB_TIMEOUT · 3000 ms · 40 % errors');
      expect(s.services.last.fault, isNull);
      expect(s.services.last.isUp, isFalse);
      expect(SystemStatus.fromJson({'services': [], 'experiment_running': null}).experimentRunning, isNull);
    });

    test('scores relative to the threshold', () {
      expect(const MethodScore(score: 1.5, threshold: 1.0, alert: true).ratio, 1.5);
      expect(const MethodScore(score: 0.7, threshold: double.infinity, alert: false).ratio, 0);
    });

    test('orders, experiments and alerts', () {
      final o = Order.fromJson({'id': 'x', 'customerId': 'C-1', 'productId': 'P-1', 'quantity': 2, 'amount': 49,
        'status': 'CANCELLED', 'failureReason': 'INSUFFICIENT_FUNDS'});
      expect(o.isFinished, isTrue);
      expect(o.amount, 49.0);
      final e = Experiment.fromJson({'name': 'run_1', 'status': 'completed',
        'evaluation': {'metrics': {'pca': {'f1': 0.8, 'roc_auc': null}}}});
      expect(e.evaluated, isTrue);
      expect(e.metrics['pca']!['f1'], 0.8);
      expect(Experiment.fromJson({'name': 'r', 'evaluation': null}).evaluated, isFalse);
      final a = Alert.fromJson({'method': 'rules', 'score': 1.2, 'threshold': 1.0,
        'explanation': {'suspected_problem': 'errors', 'top_signals': [{'text': 'x = 3'}]}});
      expect(a.explanation!.signals, ['x = 3']);
    });

    test('formatting and method order', () {
      expect(formatMoney(998643.5), '\$998,643.50');
      expect(formatMoney(9.99), '\$9.99');
      expect(orderedMethods(['pca', 'rules', 'unknown', 'isolation_forest']),
          ['rules', 'isolation_forest', 'pca', 'unknown']);
    });
  });

  group('Api', () {
    test('shop calls go to the gateway, monitor calls to the detector', () async {
      final backend = FakeBackend();
      final api = backend.api();
      expect((await api.products()).length, 2);
      expect((await api.status()).services.length, 4);
      expect(backend.requests.map((r) => '${r.url.port} ${r.url.path}'), ['8080 /api/products', '8000 /api/services']);
    });

    test('an order is posted as JSON', () async {
      final backend = FakeBackend();
      final order = await backend.api().placeOrder(customerId: 'C-001', productId: 'P-101', quantity: 3);
      expect(order.status, 'PENDING');
      expect(jsonDecode(backend.requests.single.body), {'customerId': 'C-001', 'productId': 'P-101', 'quantity': 3});
      expect(backend.requests.single.headers['Content-Type'], startsWith('application/json'));
    });

    test('server errors become readable messages', () async {
      final backend = FakeBackend()..experimentRunning = 'run_1';
      await expectLater(
        backend.api().injectFault(service: 'order-service', type: 'ERROR', severity: 'low', durationSec: 60),
        throwsA(isA<ApiException>()
            .having((e) => e.statusCode, 'status', 409)
            .having((e) => e.message, 'message', contains('experiment is running'))),
      );
      final problem = Api(FakeBackend.config, client: MockClient((_) async =>
          http.Response('{"title":"Bad Request","detail":"quantity must be at least 1"}', 400)));
      await expectLater(problem.orders(), throwsA(isA<ApiException>().having((e) => e.message, 'm', 'quantity must be at least 1')));
    });

    test('an unreachable server says how to fix it', () async {
      final backend = FakeBackend()..gatewayDown = true;
      await expectLater(backend.api().products(),
          throwsA(isA<ApiException>().having((e) => e.message, 'm', contains('Cannot reach pc.test:8080'))));
    });
  });
}
