import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Where the app finds the system: the api-gateway (shop) and the ml-detector (monitor).
///
/// A phone reaches the PC that runs `docker compose` over Wi-Fi, so the host is the PC's
/// address on the network (for example 192.168.1.20). The Android emulator reaches the PC as
/// 10.0.2.2. The web build defaults to the host it was loaded from.
@immutable
class ServerConfig {
  const ServerConfig({required this.host, this.gatewayPort = 8080, this.monitorPort = 8000});

  final String host;
  final int gatewayPort;
  final int monitorPort;

  static const _hostKey = 'server.host';
  static const _gatewayKey = 'server.gatewayPort';
  static const _monitorKey = 'server.monitorPort';

  Uri get gateway => Uri(scheme: 'http', host: host, port: gatewayPort);
  Uri get monitor => Uri(scheme: 'http', host: host, port: monitorPort);

  /// Default host: the web page's own host, or the Android emulator's alias for the PC.
  static ServerConfig defaults({bool web = kIsWeb, Uri? pageUri}) {
    if (web) {
      final host = (pageUri ?? Uri.base).host;
      return ServerConfig(host: host.isEmpty ? 'localhost' : host);
    }
    return const ServerConfig(host: '10.0.2.2');
  }

  static Future<ServerConfig> load() async {
    final prefs = await SharedPreferences.getInstance();
    final d = defaults();
    return ServerConfig(
      host: prefs.getString(_hostKey) ?? d.host,
      gatewayPort: prefs.getInt(_gatewayKey) ?? d.gatewayPort,
      monitorPort: prefs.getInt(_monitorKey) ?? d.monitorPort,
    );
  }

  Future<void> save() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_hostKey, host);
    await prefs.setInt(_gatewayKey, gatewayPort);
    await prefs.setInt(_monitorKey, monitorPort);
  }

  /// Accepts "192.168.1.20", "http://192.168.1.20:8080/" or "my-pc.local" and returns the host.
  static String normaliseHost(String input) {
    var text = input.trim();
    if (text.isEmpty) return text;
    if (!text.contains('://')) text = 'http://$text';
    return Uri.tryParse(text)?.host ?? input.trim();
  }

  /// An error message for an invalid setting, or null if it is valid.
  static String? validateHost(String input) =>
      normaliseHost(input).isEmpty ? 'Enter the address of the PC that runs the system' : null;

  static String? validatePort(String input) {
    final port = int.tryParse(input.trim());
    return (port == null || port < 1 || port > 65535) ? 'A port is a number from 1 to 65535' : null;
  }

  @override
  bool operator ==(Object other) =>
      other is ServerConfig &&
      other.host == host &&
      other.gatewayPort == gatewayPort &&
      other.monitorPort == monitorPort;

  @override
  int get hashCode => Object.hash(host, gatewayPort, monitorPort);
}
