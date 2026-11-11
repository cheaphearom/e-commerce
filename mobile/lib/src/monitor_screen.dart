import 'package:flutter/material.dart';

import 'api.dart';
import 'models.dart';
import 'polling.dart';
import 'score_chart.dart';
import 'shop_screen.dart' show StatusChip;
import 'theme.dart';

const _faultTargets = ['order-service', 'inventory-service', 'payment-service'];
const _faultTypes = {
  'LATENCY': 'LATENCY – slow responses',
  'ERROR': 'ERROR – exceptions',
  'DB_TIMEOUT': 'DB_TIMEOUT – slow DB + timeouts',
};

/// The anomaly monitor: service health, live scores, alerts with explanations and experiments.
/// It only talks to the ml-detector, so it adds nothing to the analysed logs and can stay open
/// during experiments.
class MonitorScreen extends StatefulWidget {
  const MonitorScreen({super.key, required this.api, this.refreshInterval = const Duration(seconds: 5)});

  final Api api;
  final Duration? refreshInterval;

  @override
  State<MonitorScreen> createState() => _MonitorScreenState();
}

class _MonitorScreenState extends State<MonitorScreen> with Polling<MonitorScreen> {
  SystemStatus? _status;
  Detection? _detection;
  List<HistoryPoint> _history = const [];
  List<Alert> _alerts = const [];
  ExperimentList? _experiments;
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
    // independent calls: keep whatever loads, report the first failure
    String? error;
    Future<T?> attempt<T>(Future<T> f) async {
      try {
        return await f;
      } on ApiException catch (e) {
        error ??= e.message;
        return null;
      }
    }

    final status = attempt(widget.api.status());
    final detection = attempt(widget.api.detect());
    final history = attempt(widget.api.history());
    final alerts = attempt(widget.api.alerts(limit: 15));
    final experiments = attempt(widget.api.experiments());
    final s = await status, d = await detection, h = await history, a = await alerts, e = await experiments;
    if (!mounted) return;
    setState(() {
      _status = s ?? _status;
      _detection = d ?? _detection;
      _history = h ?? _history;
      _alerts = a ?? _alerts;
      _experiments = e ?? _experiments;
      _error = error;
      _loaded = true;
    });
  }

  String? get _running => _status?.experimentRunning ?? _experiments?.running;

  @override
  Widget build(BuildContext context) {
    if (!_loaded) return const Center(child: CircularProgressIndicator());
    final theme = Theme.of(context);
    return RefreshIndicator(
      onRefresh: refresh,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
        children: [
          if (_error != null && _status == null)
            Card(child: ListTile(
              leading: const Icon(Icons.cloud_off, color: statusCritical),
              title: const Text('Monitor not reachable'),
              subtitle: Text(_error!),
            )),
          _overview(theme),
          if (_running != null)
            Card(
              color: statusWarning.withValues(alpha: 0.12),
              child: ListTile(
                leading: const Icon(Icons.science, color: statusWarning),
                title: Text('Experiment running ($_running)'),
                subtitle: const Text('Manual faults and shop orders are paused so its results stay valid.'),
              ),
            ),
          _section(theme, 'Services'),
          _services(theme),
          _section(theme, 'Anomaly score', 'last 30 min · score ÷ threshold, above 1 = alert'),
          Card(child: Padding(padding: const EdgeInsets.all(12), child: ScoreChart(points: _history))),
          _section(theme, 'Latest window', _windowText()),
          _latestWindow(theme),
          _section(theme, 'Recent alerts'),
          if (_alerts.isEmpty) const Text('No alerts yet.'),
          for (final a in _alerts) _AlertTile(alert: a),
          _section(theme, 'Experiments', 'runs in the results folder'),
          ..._experimentCards(theme),
        ],
      ),
    );
  }

  Widget _overview(ThemeData theme) {
    final d = _detection;
    final (label, color) = switch (d?.status) {
      'anomaly' => ('Anomaly', statusCritical),
      'normal' => ('Normal', statusGood),
      _ => ('Waiting for data', statusWarning),
    };
    final trained = d == null ? <String>[] : orderedMethods(d.methods.keys);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(children: [
          StatusChip(label: label, color: color),
          const SizedBox(width: 12),
          Expanded(
            child: Text(
              d?.status == 'insufficient_data'
                  ? (d?.detail ?? 'Not enough logs yet')
                  : 'Detectors: ${trained.map(methodLabel).join(', ')}',
              style: theme.textTheme.bodySmall,
            ),
          ),
          FilledButton.tonalIcon(
            key: const Key('inject'),
            onPressed: _running == null ? _openFaultSheet : null,
            icon: const Icon(Icons.bolt),
            label: const Text('Fault'),
          ),
        ]),
      ),
    );
  }

  Widget _services(ThemeData theme) {
    final services = _status?.services ?? const [];
    if (services.isEmpty) return const Text('No service information.');
    return Wrap(spacing: 8, runSpacing: 8, children: [
      for (final s in services)
        SizedBox(
          width: 170,
          child: Card(
            margin: EdgeInsets.zero,
            child: Padding(
              padding: const EdgeInsets.all(10),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(s.name, style: theme.textTheme.titleSmall),
                const SizedBox(height: 4),
                StatusChip(label: s.health, color: s.isUp ? statusGood : statusCritical),
                const SizedBox(height: 4),
                Text(s.fault?.describe() ?? (s.name == 'api-gateway' ? '' : 'No fault'),
                    style: theme.textTheme.bodySmall?.copyWith(color: s.fault != null ? statusCritical : null)),
                if (s.fault != null && _running == null)
                  TextButton(
                    style: TextButton.styleFrom(padding: EdgeInsets.zero, visualDensity: VisualDensity.compact),
                    onPressed: () => _clearFault(s.name),
                    child: const Text('Clear fault'),
                  ),
              ]),
            ),
          ),
        ),
    ]);
  }

  String _windowText() {
    final d = _detection;
    if (d?.windowStart == null) return '';
    return '${formatTime(d!.windowStart)} – ${formatTime(d.windowEnd)}';
  }

  Widget _latestWindow(ThemeData theme) {
    final d = _detection;
    if (d == null || d.methods.isEmpty) return const Text('No window scored yet.');
    double f(String k) => d.features[k] ?? 0;
    final rows = <(String, String)>[
      ('Gateway requests', f('api-gateway__http_count').toStringAsFixed(0)),
      ('Gateway 5xx share', f('api-gateway__http_5xx_ratio').toStringAsFixed(3)),
      ('Gateway p95 latency', '${f('api-gateway__latency_p95').toStringAsFixed(0)} ms'),
      ('Errors order / inventory / payment',
          ['order-service', 'inventory-service', 'payment-service'].map((s) => f('${s}__error_count').toStringAsFixed(0)).join(' / ')),
      ('Saga success ratio', f('system__saga_success_ratio').toStringAsFixed(2)),
      ('Saga timeouts', f('system__saga_timeout').toStringAsFixed(0)),
      ('New (unseen) log messages', f('system__unseen_templates').toStringAsFixed(0)),
    ];
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(children: [
          for (final m in orderedMethods(d.methods.keys))
            Row(children: [
              Container(width: 10, height: 10, color: methodColor(m)),
              const SizedBox(width: 8),
              Expanded(child: Text(methodLabel(m))),
              Text('${d.methods[m]!.score.toStringAsFixed(3)} / ${d.methods[m]!.threshold.toStringAsFixed(3)}  ',
                  style: theme.textTheme.bodySmall),
              d.methods[m]!.alert
                  ? const StatusChip(label: 'alert', color: statusCritical)
                  : const StatusChip(label: 'ok', color: statusGood),
            ]),
          const Divider(),
          for (final (k, v) in rows)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: Row(children: [Expanded(child: Text(k, style: theme.textTheme.bodySmall)), Text(v)]),
            ),
        ]),
      ),
    );
  }

  List<Widget> _experimentCards(ThemeData theme) {
    final list = _experiments?.experiments ?? const [];
    if (list.isEmpty) return [const Text('No experiments in the results folder yet.')];
    return [
      for (final e in list)
        Card(
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(e.name, style: theme.textTheme.titleSmall),
              Text([
                e.status,
                if (e.faults != null) '${e.faults} faults',
                if (e.durationMin != null) '${e.durationMin!.toStringAsFixed(0)} min',
                if (e.seed != null) 'seed ${e.seed}',
              ].join(' · '), style: theme.textTheme.bodySmall),
              const SizedBox(height: 6),
              if (!e.evaluated) const Text('Not evaluated yet (Evaluate on the web monitor or the CLI).'),
              if (e.evaluated)
                Wrap(spacing: 6, runSpacing: 6, children: [
                  for (final m in orderedMethods(e.metrics.keys))
                    Chip(
                      visualDensity: VisualDensity.compact,
                      avatar: CircleAvatar(backgroundColor: methodColor(m), radius: 5),
                      label: Text('${methodLabel(m)}  F1 ${(e.metrics[m]!['f1'] ?? 0).toStringAsFixed(2)}'),
                    ),
                ]),
            ]),
          ),
        ),
    ];
  }

  Widget _section(ThemeData theme, String title, [String? subtitle]) => Padding(
        padding: const EdgeInsets.fromLTRB(0, 16, 0, 4),
        child: Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Text(title, style: theme.textTheme.titleMedium),
          if (subtitle != null && subtitle.isNotEmpty) ...[
            const SizedBox(width: 8),
            Flexible(child: Text(subtitle, style: theme.textTheme.bodySmall, overflow: TextOverflow.ellipsis)),
          ],
        ]),
      );

  Future<void> _clearFault(String service) async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await widget.api.clearFault(service);
      messenger.showSnackBar(SnackBar(content: Text('Fault on $service cleared')));
    } on ApiException catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.message)));
    }
    await refresh();
  }

  Future<void> _openFaultSheet() async {
    final injected = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _FaultSheet(api: widget.api),
    );
    if (injected != null && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(injected)));
      await refresh();
    }
  }
}

class _AlertTile extends StatelessWidget {
  const _AlertTile({required this.alert});

  final Alert alert;

  @override
  Widget build(BuildContext context) {
    final e = alert.explanation;
    final theme = Theme.of(context);
    return Card(
      child: ExpansionTile(
        leading: CircleAvatar(backgroundColor: methodColor(alert.method), radius: 6),
        title: Text('${methodLabel(alert.method)} · ${formatTime(alert.windowEnd ?? alert.raisedAt)}'),
        subtitle: Text(e == null
            ? 'score ${alert.score.toStringAsFixed(2)} (threshold ${alert.threshold.toStringAsFixed(2)})'
            : '${e.suspectedService ?? 'unclear service'}: ${e.suspectedProblem}'),
        childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
        expandedCrossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Score ${alert.score.toStringAsFixed(3)} · threshold ${alert.threshold.toStringAsFixed(3)}',
              style: theme.textTheme.bodySmall),
          if (alert.firedRules.isNotEmpty) Text('Rules fired: ${alert.firedRules.join(', ')}'),
          if (e != null && e.signals.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text('Strongest signals', style: theme.textTheme.labelLarge),
            for (final s in e.signals) Text('• $s'),
          ],
          if (e != null) for (final n in e.notes) Text('ℹ $n'),
          if (e != null && e.exampleErrors.isNotEmpty) ...[
            const SizedBox(height: 6),
            Text('Example log lines', style: theme.textTheme.labelLarge),
            for (final line in e.exampleErrors.take(3))
              Text(line, maxLines: 3, overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.bodySmall?.copyWith(fontFamily: 'monospace')),
          ],
        ],
      ),
    );
  }
}

class _FaultSheet extends StatefulWidget {
  const _FaultSheet({required this.api});

  final Api api;

  @override
  State<_FaultSheet> createState() => _FaultSheetState();
}

class _FaultSheetState extends State<_FaultSheet> {
  String _service = 'inventory-service';
  String _type = 'DB_TIMEOUT';
  String _severity = 'medium';
  double _duration = 90;
  String? _error;
  bool _sending = false;

  Future<void> _inject() async {
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      await widget.api.injectFault(service: _service, type: _type, severity: _severity, durationSec: _duration.round());
      if (mounted) Navigator.pop(context, '$_type ($_severity) injected into $_service for ${_duration.round()} s');
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.viewInsetsOf(context).bottom),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('Inject a fault', style: Theme.of(context).textTheme.titleLarge),
        const Text('Same presets as the experiment runner; it switches itself off after the duration. '
            'Faults only show in the logs while there is traffic.'),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(
          initialValue: _service,
          decoration: const InputDecoration(labelText: 'Service'),
          items: [for (final s in _faultTargets) DropdownMenuItem(value: s, child: Text(s))],
          onChanged: (v) => setState(() => _service = v!),
        ),
        DropdownButtonFormField<String>(
          initialValue: _type,
          decoration: const InputDecoration(labelText: 'Type'),
          items: [for (final e in _faultTypes.entries) DropdownMenuItem(value: e.key, child: Text(e.value))],
          onChanged: (v) => setState(() => _type = v!),
        ),
        const SizedBox(height: 12),
        SegmentedButton<String>(
          segments: const [
            ButtonSegment(value: 'low', label: Text('low')),
            ButtonSegment(value: 'medium', label: Text('medium')),
            ButtonSegment(value: 'high', label: Text('high')),
          ],
          selected: {_severity},
          onSelectionChanged: (s) => setState(() => _severity = s.first),
        ),
        const SizedBox(height: 8),
        Text('Duration: ${_duration.round()} s'),
        Slider(value: _duration, min: 30, max: 300, divisions: 27, onChanged: (v) => setState(() => _duration = v)),
        if (_error != null) Text(_error!, style: const TextStyle(color: statusCritical)),
        const SizedBox(height: 8),
        SizedBox(
          width: double.infinity,
          child: FilledButton(
            key: const Key('inject-confirm'),
            onPressed: _sending ? null : _inject,
            child: const Text('Inject fault'),
          ),
        ),
      ]),
    );
  }
}
