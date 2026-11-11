import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import 'config.dart';
import 'models.dart';

/// A request failed; [message] is meant for the user.
class ApiException implements Exception {
  const ApiException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  @override
  String toString() => message;
}

/// Client for the shop (api-gateway) and the anomaly monitor (ml-detector).
///
/// Only the shop calls go through the gateway and appear in the analysed logs; the monitor
/// calls go to the ml-detector, which reads the logs but writes none of the analysed ones.
class Api {
  Api(this.config, {http.Client? client, this.timeout = const Duration(seconds: 6)})
      : _client = client ?? http.Client();

  final ServerConfig config;
  final Duration timeout;
  final http.Client _client;

  void close() => _client.close();

  // ---- shop (gateway) -------------------------------------------------------------------
  Future<List<Product>> products() async =>
      (await _get(config.gateway, '/api/products') as List).map((e) => Product.fromJson(_m(e))).toList();

  Future<List<Account>> accounts() async =>
      (await _get(config.gateway, '/api/accounts') as List).map((e) => Account.fromJson(_m(e))).toList();

  Future<List<Order>> orders({int limit = 20}) async =>
      (await _get(config.gateway, '/api/orders', {'limit': '$limit'}) as List)
          .map((e) => Order.fromJson(_m(e)))
          .toList();

  Future<Order> placeOrder({required String customerId, required String productId, required int quantity}) async =>
      Order.fromJson(_m(await _send('POST', config.gateway, '/api/orders',
          {'customerId': customerId, 'productId': productId, 'quantity': quantity})));

  // ---- monitor (ml-detector) ------------------------------------------------------------
  Future<SystemStatus> status() async => SystemStatus.fromJson(_m(await _get(config.monitor, '/api/services')));

  Future<Detection> detect() async => Detection.fromJson(_m(await _get(config.monitor, '/detect')));

  Future<List<HistoryPoint>> history({double minutes = 30}) async {
    final body = _m(await _get(config.monitor, '/api/history', {'minutes': '$minutes'}));
    return (body['points'] as List? ?? const []).map((e) => HistoryPoint.fromJson(_m(e))).toList();
  }

  Future<List<Alert>> alerts({int limit = 20}) async {
    final body = _m(await _get(config.monitor, '/alerts', {'limit': '$limit'}));
    return (body['alerts'] as List? ?? const []).map((e) => Alert.fromJson(_m(e))).toList();
  }

  Future<ExperimentList> experiments() async =>
      ExperimentList.fromJson(_m(await _get(config.monitor, '/api/experiments')));

  /// Injects a fault through the monitor (refused with 409 while an experiment runs).
  Future<void> injectFault({required String service, required String type, required String severity,
      required int durationSec}) =>
      _send('POST', config.monitor, '/api/chaos/$service',
          {'type': type, 'severity': severity, 'durationSec': durationSec});

  Future<void> clearFault(String service) => _send('DELETE', config.monitor, '/api/chaos/$service');

  // ---- plumbing -------------------------------------------------------------------------
  static Map<String, dynamic> _m(Object? v) => v is Map ? v.cast<String, dynamic>() : <String, dynamic>{};

  Future<Object?> _get(Uri base, String path, [Map<String, String>? query]) =>
      _request(() => _client.get(base.replace(path: path, queryParameters: query)), base);

  Future<Object?> _send(String method, Uri base, String path, [Map<String, Object?>? body]) =>
      _request(() {
        final request = http.Request(method, base.replace(path: path));
        if (body != null) {
          request.headers['Content-Type'] = 'application/json';
          request.body = jsonEncode(body);
        }
        return _client.send(request).then(http.Response.fromStream);
      }, base);

  Future<Object?> _request(Future<http.Response> Function() call, Uri base) async {
    final http.Response response;
    try {
      response = await call().timeout(timeout);
    } on TimeoutException {
      throw ApiException('No answer from ${base.host}:${base.port} - is the system running and the address '
          'in Settings right?');
    } on Exception {
      throw ApiException('Cannot reach ${base.host}:${base.port} - is the system running and the address '
          'in Settings right?');
    }
    Object? body;
    if (response.body.isNotEmpty) {
      try {
        body = jsonDecode(utf8.decode(response.bodyBytes));
      } on FormatException {
        body = null;
      }
    }
    if (response.statusCode >= 400) {
      final detail = body is Map ? (body['detail'] ?? body['title'] ?? body['message']) : null;
      throw ApiException(detail != null ? '$detail' : 'The server answered HTTP ${response.statusCode}',
          statusCode: response.statusCode);
    }
    return body;
  }
}
