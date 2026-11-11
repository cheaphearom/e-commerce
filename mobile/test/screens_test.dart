import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:thesis_mobile/main.dart';
import 'package:thesis_mobile/src/api.dart';
import 'package:thesis_mobile/src/config.dart';
import 'package:thesis_mobile/src/monitor_screen.dart';
import 'package:thesis_mobile/src/settings_screen.dart';
import 'package:thesis_mobile/src/shop_screen.dart';

import 'fake_backend.dart';

Future<void> show(WidgetTester tester, Widget screen) async {
  tester.view.physicalSize = const Size(1000, 3000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(MaterialApp(home: Scaffold(body: screen)));
  await tester.pumpAndSettle();
}

void main() {
  group('Shop', () {
    testWidgets('shows products, customers and orders', (tester) async {
      final backend = FakeBackend();
      await show(tester, ShopScreen(api: backend.api(), refreshInterval: null));
      expect(find.text('Wireless Mouse'), findsOneWidget);
      expect(find.text('472 in stock · 28 reserved'), findsOneWidget);
      expect(find.text('Balance \$998,643.50'), findsOneWidget);
      expect(find.text('Cancelled'), findsOneWidget);
      expect(find.textContaining('INSUFFICIENT_FUNDS'), findsOneWidget);
      expect(find.text('Completed'), findsOneWidget);
    });

    testWidgets('places an order with the chosen customer and quantity', (tester) async {
      final backend = FakeBackend();
      await show(tester, ShopScreen(api: backend.api(), refreshInterval: null));
      await tester.tap(find.byKey(const Key('customer')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('C-007').last);
      await tester.pumpAndSettle();
      final more = find.descendant(of: find.ancestor(of: find.text('Wireless Mouse'), matching: find.byType(Card)),
          matching: find.byTooltip('More'));
      await tester.tap(more);
      await tester.pump();
      await tester.tap(more);
      await tester.pump();
      expect(tester.widget<Text>(find.byKey(const Key('qty-P-101'))).data, '3');
      await tester.tap(find.byKey(const Key('order-P-101')));
      await tester.pumpAndSettle();
      expect(backend.placedOrders.single, containsPair('customerId', 'C-007'));
      expect(backend.placedOrders.single, containsPair('quantity', 3));
      expect(find.text('Order for 3 × Wireless Mouse placed (pending)'), findsOneWidget);
      expect(find.text('In progress'), findsOneWidget);       // the new order in the list
    });

    testWidgets('pauses completely while an experiment runs', (tester) async {
      final backend = FakeBackend()..experimentRunning = 'run_3';
      await show(tester, ShopScreen(api: backend.api(), refreshInterval: null));
      expect(find.text('Experiment running (run_3)'), findsOneWidget);
      expect(find.text('Wireless Mouse'), findsNothing);
      expect(backend.gatewayRequests, isEmpty, reason: 'no shop traffic may reach the logs');
    });

    testWidgets('explains an unreachable gateway', (tester) async {
      final backend = FakeBackend()..gatewayDown = true;
      await show(tester, ShopScreen(api: backend.api(), refreshInterval: null));
      expect(find.text('Shop not reachable'), findsOneWidget);
      expect(find.textContaining('Cannot reach pc.test:8080'), findsOneWidget);
    });

    testWidgets('still works without the monitor, with a warning', (tester) async {
      final backend = FakeBackend()..monitorDown = true;
      await show(tester, ShopScreen(api: backend.api(), refreshInterval: null));
      expect(find.textContaining('cannot check for a running experiment'), findsOneWidget);
      expect(find.text('Wireless Mouse'), findsOneWidget);
    });
  });

  group('Monitor', () {
    testWidgets('shows status, services, latest window, alerts and experiments', (tester) async {
      final backend = FakeBackend();
      await show(tester, MonitorScreen(api: backend.api(), refreshInterval: null));
      expect(find.text('Anomaly'), findsOneWidget);
      expect(find.text('inventory-service'), findsOneWidget);
      expect(find.text('DB_TIMEOUT · 3000 ms · 40 % errors'), findsOneWidget);
      expect(find.text('DOWN'), findsOneWidget);
      expect(find.text('alert'), findsOneWidget);                 // rules alert in the latest window
      expect(find.text('3586 ms'), findsOneWidget);
      expect(find.textContaining('Random Forest  F1 0.82'), findsOneWidget);
      expect(find.textContaining('Not evaluated yet'), findsOneWidget);
      expect(backend.gatewayRequests, isEmpty, reason: 'the monitor never calls the gateway');

      await tester.tap(find.textContaining('payment-service: slow responses'));
      await tester.pumpAndSettle();
      expect(find.textContaining('p95 latency (ms) = 3586 ms'), findsOneWidget);
      expect(find.textContaining('Rules fired: gateway_p95_latency'), findsOneWidget);
    });

    testWidgets('injects a fault with the chosen settings', (tester) async {
      final backend = FakeBackend();
      await show(tester, MonitorScreen(api: backend.api(), refreshInterval: null));
      await tester.tap(find.byKey(const Key('inject')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('high'));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('inject-confirm')));
      await tester.pumpAndSettle();
      expect(backend.injectedFaults.single,
          {'service': 'inventory-service', 'type': 'DB_TIMEOUT', 'severity': 'high', 'durationSec': 90});
      expect(find.textContaining('injected into inventory-service'), findsOneWidget);
    });

    testWidgets('no manual faults during an experiment', (tester) async {
      final backend = FakeBackend()..experimentRunning = 'run_2';
      await show(tester, MonitorScreen(api: backend.api(), refreshInterval: null));
      expect(find.text('Experiment running (run_2)'), findsOneWidget);
      final button = tester.widget<ButtonStyleButton>(find.byKey(const Key('inject')));
      expect(button.onPressed, isNull);
      expect(find.text('Clear fault'), findsNothing);
    });
  });

  group('Settings', () {
    testWidgets('validates, normalises and saves the address', (tester) async {
      ServerConfig? saved;
      await show(tester, SettingsScreen(config: const ServerConfig(host: '10.0.2.2'), onSaved: (c) => saved = c));
      await tester.enterText(find.byKey(const Key('host')), '');
      await tester.tap(find.byKey(const Key('save')));
      await tester.pump();
      expect(find.textContaining('Enter the address'), findsOneWidget);
      expect(saved, isNull);

      await tester.enterText(find.byKey(const Key('host')), 'http://192.168.1.20:8080/');
      await tester.enterText(find.byKey(const Key('gatewayPort')), '9080');
      await tester.tap(find.byKey(const Key('save')));
      await tester.pump();
      expect(saved, const ServerConfig(host: '192.168.1.20', gatewayPort: 9080, monitorPort: 8000));
    });

    testWidgets('tests the connection through the monitor only', (tester) async {
      final backend = FakeBackend();
      Api? used;
      await show(tester, SettingsScreen(
        config: FakeBackend.config,
        onSaved: (_) {},
        apiFor: (c) => used = backend.api(),
      ));
      await tester.tap(find.byKey(const Key('test')));
      await tester.pumpAndSettle();
      expect(used, isNotNull);
      expect(find.text('Monitor OK. Services up: 3 of 4 (gateway UP).'), findsOneWidget);
      expect(backend.gatewayRequests, isEmpty);
    });
  });

  group('App', () {
    testWidgets('opens on the monitor; the shop only loads when its tab is shown', (tester) async {
      SharedPreferences.setMockInitialValues({});
      final backend = FakeBackend();
      tester.view.physicalSize = const Size(1000, 3000);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(ThesisApp(initialConfig: FakeBackend.config, apiFor: (_) => backend.api(),
          refreshInterval: null));
      await tester.pumpAndSettle();
      expect(find.text('Anomaly monitor'), findsOneWidget);
      expect(backend.gatewayRequests, isEmpty);

      await tester.tap(find.text('Shop'));
      await tester.pumpAndSettle();
      expect(find.text('Wireless Mouse'), findsOneWidget);
      expect(backend.gatewayRequests, isNotEmpty);

      await tester.tap(find.text('Settings'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('host')), '192.168.1.50');
      await tester.tap(find.byKey(const Key('save')));
      await tester.pumpAndSettle();
      expect(find.text('192.168.1.50'), findsWidgets);           // shown in the app bar
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString('server.host'), '192.168.1.50');
      expect(jsonEncode(backend.placedOrders), '[]');
    });
  });
}
