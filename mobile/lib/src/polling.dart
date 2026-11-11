import 'dart:async';

import 'package:flutter/widgets.dart';

/// Calls [refresh] now and then every [refreshInterval] while the widget is shown.
/// A null interval (used by tests) refreshes only once and on demand.
mixin Polling<T extends StatefulWidget> on State<T> {
  Timer? _timer;
  bool _busy = false;

  Duration? get refreshInterval;
  Future<void> refresh();

  void startPolling() {
    _tick();
    final every = refreshInterval;
    if (every != null) _timer = Timer.periodic(every, (_) => _tick());
  }

  Future<void> _tick() async {
    if (_busy || !mounted) return;
    _busy = true;
    try {
      await refresh();
    } finally {
      _busy = false;
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }
}
