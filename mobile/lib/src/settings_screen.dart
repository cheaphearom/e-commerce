import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'api.dart';
import 'config.dart';

/// Where the system runs. On a phone this is the PC's address on the Wi-Fi network.
class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key, required this.config, required this.onSaved, this.apiFor});

  final ServerConfig config;
  final ValueChanged<ServerConfig> onSaved;

  /// Builds the client for "Test connection" (tests inject a fake one).
  final Api Function(ServerConfig)? apiFor;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final _form = GlobalKey<FormState>();
  late final _host = TextEditingController(text: widget.config.host);
  late final _gateway = TextEditingController(text: '${widget.config.gatewayPort}');
  late final _monitor = TextEditingController(text: '${widget.config.monitorPort}');
  String? _testResult;
  bool _testing = false;

  @override
  void dispose() {
    _host.dispose();
    _gateway.dispose();
    _monitor.dispose();
    super.dispose();
  }

  ServerConfig? _read() {
    if (!(_form.currentState?.validate() ?? false)) return null;
    return ServerConfig(
      host: ServerConfig.normaliseHost(_host.text),
      gatewayPort: int.parse(_gateway.text.trim()),
      monitorPort: int.parse(_monitor.text.trim()),
    );
  }

  void _save() {
    final config = _read();
    if (config == null) return;
    widget.onSaved(config);
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Saved: ${config.host}')));
  }

  /// Checks the monitor (which also reports the gateway's health). It deliberately sends
  /// nothing to the shop, so testing never adds traffic to an experiment's logs.
  Future<void> _test() async {
    final config = _read();
    if (config == null) return;
    setState(() {
      _testing = true;
      _testResult = null;
    });
    final api = (widget.apiFor ?? Api.new)(config);
    String result;
    try {
      final status = await api.status();
      final gateway = status.services.where((s) => s.name == 'api-gateway').firstOrNull;
      final up = status.services.where((s) => s.isUp).length;
      result = 'Monitor OK. Services up: $up of ${status.services.length}'
          '${gateway == null ? '' : ' (gateway ${gateway.health})'}.';
    } on ApiException catch (e) {
      result = e.message;
    } finally {
      api.close();
    }
    if (mounted) {
      setState(() {
        _testResult = result;
        _testing = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Form(
      key: _form,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('Server', style: theme.textTheme.titleMedium),
          const SizedBox(height: 4),
          Text(
            kIsWeb
                ? 'The address of the PC that runs docker compose. Usually the same host as this page.'
                : 'The address of the PC that runs docker compose. On a phone: the PC\'s Wi-Fi address '
                    '(Windows: ipconfig → IPv4 Address, e.g. 192.168.1.20). In the Android emulator: 10.0.2.2.',
            style: theme.textTheme.bodySmall,
          ),
          const SizedBox(height: 12),
          TextFormField(
            key: const Key('host'),
            controller: _host,
            decoration: const InputDecoration(labelText: 'PC address', hintText: '192.168.1.20'),
            keyboardType: TextInputType.url,
            validator: (v) => ServerConfig.validateHost(v ?? ''),
          ),
          Row(children: [
            Expanded(
              child: TextFormField(
                key: const Key('gatewayPort'),
                controller: _gateway,
                decoration: const InputDecoration(labelText: 'Shop port (gateway)'),
                keyboardType: TextInputType.number,
                validator: (v) => ServerConfig.validatePort(v ?? ''),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: TextFormField(
                key: const Key('monitorPort'),
                controller: _monitor,
                decoration: const InputDecoration(labelText: 'Monitor port'),
                keyboardType: TextInputType.number,
                validator: (v) => ServerConfig.validatePort(v ?? ''),
              ),
            ),
          ]),
          const SizedBox(height: 16),
          Row(children: [
            FilledButton(key: const Key('save'), onPressed: _save, child: const Text('Save')),
            const SizedBox(width: 12),
            OutlinedButton(
              key: const Key('test'),
              onPressed: _testing ? null : _test,
              child: Text(_testing ? 'Testing…' : 'Test connection'),
            ),
          ]),
          if (_testResult != null) ...[
            const SizedBox(height: 12),
            Text(_testResult!, key: const Key('testResult')),
          ],
          const SizedBox(height: 24),
          Text('Phone checklist', style: theme.textTheme.titleMedium),
          const SizedBox(height: 4),
          const Text('• Phone and PC on the same Wi-Fi.\n'
              '• The system runs on the PC (docker compose up -d).\n'
              '• Windows firewall allows ports 8080 and 8000 (Windows asks the first time; '
              'otherwise add inbound rules for Docker Desktop).'),
        ],
      ),
    );
  }
}
