import 'package:flutter/material.dart';

import 'src/api.dart';
import 'src/config.dart';
import 'src/monitor_screen.dart';
import 'src/settings_screen.dart';
import 'src/shop_screen.dart';
import 'src/theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(ThesisApp(initialConfig: await ServerConfig.load()));
}

class ThesisApp extends StatefulWidget {
  const ThesisApp({super.key, required this.initialConfig, this.apiFor, this.refreshInterval = const Duration(seconds: 5)});

  final ServerConfig initialConfig;

  /// Builds the API client for a configuration (tests inject a fake HTTP client here).
  final Api Function(ServerConfig)? apiFor;
  final Duration? refreshInterval;

  @override
  State<ThesisApp> createState() => _ThesisAppState();
}

class _ThesisAppState extends State<ThesisApp> {
  late ServerConfig _config = widget.initialConfig;
  late Api _api = _build(_config);

  Api _build(ServerConfig c) => (widget.apiFor ?? Api.new)(c);

  Future<void> _update(ServerConfig c) async {
    await c.save();
    setState(() {
      _api.close();
      _config = c;
      _api = _build(c);
    });
  }

  @override
  void dispose() {
    _api.close();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Thesis Shop & Monitor',
      theme: buildTheme(Brightness.light),
      darkTheme: buildTheme(Brightness.dark),
      home: HomePage(api: _api, config: _config, onConfig: _update, apiFor: _build,
          refreshInterval: widget.refreshInterval),
    );
  }
}

class HomePage extends StatefulWidget {
  const HomePage({super.key, required this.api, required this.config, required this.onConfig,
      required this.apiFor, this.refreshInterval});

  final Api api;
  final ServerConfig config;
  final ValueChanged<ServerConfig> onConfig;
  final Api Function(ServerConfig) apiFor;
  final Duration? refreshInterval;

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  // The monitor opens first: it is safe at any time. Only the visible tab polls, so the shop
  // makes no requests unless it is on screen.
  int _tab = 1;

  static const _titles = ['Shop', 'Anomaly monitor', 'Settings'];

  @override
  Widget build(BuildContext context) {
    final key = ValueKey(widget.config);   // new address -> fresh screens
    final body = switch (_tab) {
      0 => ShopScreen(key: key, api: widget.api, refreshInterval: widget.refreshInterval),
      1 => MonitorScreen(key: key, api: widget.api, refreshInterval: widget.refreshInterval),
      _ => SettingsScreen(key: key, config: widget.config, onSaved: widget.onConfig, apiFor: widget.apiFor),
    };
    return Scaffold(
      appBar: AppBar(
        title: Text(_titles[_tab]),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 12),
            child: Center(child: Text(widget.config.host, style: Theme.of(context).textTheme.bodySmall)),
          ),
        ],
      ),
      body: SafeArea(child: body),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) => setState(() => _tab = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.storefront_outlined), selectedIcon: Icon(Icons.storefront), label: 'Shop'),
          NavigationDestination(icon: Icon(Icons.monitor_heart_outlined), selectedIcon: Icon(Icons.monitor_heart), label: 'Monitor'),
          NavigationDestination(icon: Icon(Icons.settings_outlined), selectedIcon: Icon(Icons.settings), label: 'Settings'),
        ],
      ),
    );
  }
}
