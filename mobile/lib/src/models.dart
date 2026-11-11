/// Data returned by the api-gateway (shop) and the ml-detector (monitor).
library;

double _d(Object? v) => v is num ? v.toDouble() : double.tryParse('$v') ?? 0;
double? _dn(Object? v) => v == null ? null : _d(v);
int _i(Object? v) => v is num ? v.toInt() : int.tryParse('$v') ?? 0;
DateTime? _t(Object? v) => v is String ? DateTime.tryParse(v)?.toLocal() : null;
List<String> _strings(Object? v) => v is List ? v.map((e) => '$e').toList() : const [];
Map<String, dynamic> _map(Object? v) => v is Map ? v.cast<String, dynamic>() : const {};

// ---------------------------------------------------------------------------------------
// Shop
// ---------------------------------------------------------------------------------------
class Product {
  const Product({required this.id, required this.name, required this.price,
      required this.availableStock, required this.reservedStock});

  factory Product.fromJson(Map<String, dynamic> j) => Product(
        id: '${j['id']}',
        name: '${j['name'] ?? j['id']}',
        price: _d(j['price']),
        availableStock: _i(j['availableStock']),
        reservedStock: _i(j['reservedStock']),
      );

  final String id;
  final String name;
  final double price;
  final int availableStock;
  final int reservedStock;
}

class Account {
  const Account({required this.customerId, required this.balance});

  factory Account.fromJson(Map<String, dynamic> j) =>
      Account(customerId: '${j['customerId']}', balance: _d(j['balance']));

  final String customerId;
  final double balance;
}

class Order {
  const Order({required this.id, required this.customerId, required this.productId,
      required this.quantity, required this.amount, required this.status, this.failureReason,
      this.createdAt});

  factory Order.fromJson(Map<String, dynamic> j) => Order(
        id: '${j['id']}',
        customerId: '${j['customerId']}',
        productId: '${j['productId']}',
        quantity: _i(j['quantity']),
        amount: _d(j['amount']),
        status: '${j['status']}',
        failureReason: j['failureReason'] as String?,
        createdAt: _t(j['createdAt']),
      );

  final String id;
  final String customerId;
  final String productId;
  final int quantity;
  final double amount;
  final String status;          // PENDING, INVENTORY_RESERVED, COMPLETED, CANCELLED
  final String? failureReason;  // e.g. INSUFFICIENT_FUNDS, OUT_OF_STOCK, SAGA_TIMEOUT
  final DateTime? createdAt;

  bool get isFinished => status == 'COMPLETED' || status == 'CANCELLED';
}

// ---------------------------------------------------------------------------------------
// Monitor
// ---------------------------------------------------------------------------------------
class Fault {
  const Fault({required this.type, required this.latencyMs, required this.errorRate, this.expiresAt});

  /// Null when no fault is active.
  static Fault? fromJson(Object? v) {
    final j = _map(v);
    if (j['active'] != true) return null;
    return Fault(type: '${j['type']}', latencyMs: _i(j['latencyMs']), errorRate: _d(j['errorRate']),
        expiresAt: _t(j['expiresAt']));
  }

  final String type;
  final int latencyMs;
  final double errorRate;
  final DateTime? expiresAt;

  String describe() {
    final parts = <String>[type];
    if (latencyMs > 0) parts.add('$latencyMs ms');
    if (errorRate > 0) parts.add('${(errorRate * 100).round()} % errors');
    return parts.join(' · ');
  }
}

class ServiceInfo {
  const ServiceInfo({required this.name, required this.health, this.fault});

  factory ServiceInfo.fromJson(Map<String, dynamic> j) =>
      ServiceInfo(name: '${j['name']}', health: '${j['health'] ?? 'UNKNOWN'}', fault: Fault.fromJson(j['fault']));

  final String name;
  final String health;
  final Fault? fault;

  bool get isUp => health == 'UP';
}

/// Services plus whether an experiment holds the lock (then faults and orders are paused).
class SystemStatus {
  const SystemStatus({required this.services, this.experimentRunning, this.telegram = false});

  factory SystemStatus.fromJson(Map<String, dynamic> j) => SystemStatus(
        services: (j['services'] as List? ?? const []).map((e) => ServiceInfo.fromJson(_map(e))).toList(),
        experimentRunning: experimentName(j['experiment_running']),
        telegram: j['telegram'] == true,
      );

  /// The output folder of the running experiment, or null if none is running.
  static String? experimentName(Object? lock) {
    if (lock == null) return null;
    final out = '${_map(lock)['out'] ?? 'unknown'}';
    return out.split('/').where((p) => p.isNotEmpty).lastOrNull ?? out;
  }

  final List<ServiceInfo> services;
  final String? experimentRunning;
  final bool telegram;
}

class MethodScore {
  const MethodScore({required this.score, required this.threshold, required this.alert,
      this.firedRules = const []});

  factory MethodScore.fromJson(Map<String, dynamic> j) => MethodScore(
        score: _d(j['score']),
        threshold: _d(j['threshold']),
        alert: j['alert'] == true,
        firedRules: _strings(j['fired_rules']),
      );

  final double score;
  final double threshold;
  final bool alert;
  final List<String> firedRules;

  /// Score relative to the alert threshold (above 1 = alert), as the web monitor plots it.
  double get ratio => threshold > 0 && threshold.isFinite ? score / threshold : (alert ? 1.5 : 0);
}

Map<String, MethodScore> _methods(Object? v) =>
    _map(v).map((k, e) => MapEntry(k, MethodScore.fromJson(_map(e))));

class Explanation {
  const Explanation({this.suspectedService, required this.suspectedProblem, this.signals = const [],
      this.notes = const [], this.exampleErrors = const []});

  static Explanation? fromJson(Object? v) {
    if (v is! Map) return null;
    final j = _map(v);
    return Explanation(
      suspectedService: j['suspected_service'] as String?,
      suspectedProblem: '${j['suspected_problem'] ?? 'unknown'}',
      signals: (j['top_signals'] as List? ?? const []).map((s) => '${_map(s)['text'] ?? s}').toList(),
      notes: _strings(j['notes']),
      exampleErrors: _strings(j['example_errors']),
    );
  }

  final String? suspectedService;
  final String suspectedProblem;
  final List<String> signals;
  final List<String> notes;
  final List<String> exampleErrors;
}

class Detection {
  const Detection({required this.status, this.detail, this.windowStart, this.windowEnd,
      this.methods = const {}, this.features = const {}, this.explanation});

  factory Detection.fromJson(Map<String, dynamic> j) => Detection(
        status: '${j['status'] ?? 'unknown'}',
        detail: j['detail'] as String?,
        windowStart: _t(j['window_start']),
        windowEnd: _t(j['window_end']),
        methods: _methods(j['methods']),
        features: _map(j['features']).map((k, v) => MapEntry(k, _d(v))),
        explanation: Explanation.fromJson(j['explanation']),
      );

  /// normal, anomaly or insufficient_data
  final String status;
  final String? detail;
  final DateTime? windowStart;
  final DateTime? windowEnd;
  final Map<String, MethodScore> methods;
  final Map<String, double> features;
  final Explanation? explanation;
}

class HistoryPoint {
  const HistoryPoint({required this.time, required this.methods});

  factory HistoryPoint.fromJson(Map<String, dynamic> j) => HistoryPoint(
        time: DateTime.fromMillisecondsSinceEpoch((_d(j['t']) * 1000).round()),
        methods: _methods(j['methods']),
      );

  final DateTime time;
  final Map<String, MethodScore> methods;
}

class Alert {
  const Alert({required this.method, required this.score, required this.threshold, this.raisedAt,
      this.windowEnd, this.firedRules = const [], this.explanation});

  factory Alert.fromJson(Map<String, dynamic> j) => Alert(
        method: '${j['method']}',
        score: _d(j['score']),
        threshold: _d(j['threshold']),
        raisedAt: _t(j['raised_at']),
        windowEnd: _t(j['window_end']),
        firedRules: _strings(j['fired_rules']),
        explanation: Explanation.fromJson(j['explanation']),
      );

  final String method;
  final double score;
  final double threshold;
  final DateTime? raisedAt;
  final DateTime? windowEnd;
  final List<String> firedRules;
  final Explanation? explanation;
}

class Experiment {
  const Experiment({required this.name, required this.status, this.faults, this.seed, this.durationMin,
      this.metrics = const {}});

  factory Experiment.fromJson(Map<String, dynamic> j) {
    final evaluation = _map(j['evaluation']);
    return Experiment(
      name: '${j['name']}',
      status: '${j['status'] ?? 'unknown'}',
      faults: j['faults'] == null ? null : _i(j['faults']),
      seed: j['seed'] == null ? null : _i(j['seed']),
      durationMin: _dn(j['duration_min']),
      metrics: _map(evaluation['metrics'])
          .map((m, v) => MapEntry(m, _map(v).map((k, x) => MapEntry(k, _dn(x))))),
    );
  }

  final String name;
  final String status;
  final int? faults;
  final int? seed;
  final double? durationMin;

  /// method -> metric (precision, recall, f1, roc_auc, ...) -> value; empty if not evaluated.
  final Map<String, Map<String, double?>> metrics;

  bool get evaluated => metrics.isNotEmpty;
}

class ExperimentList {
  const ExperimentList({required this.experiments, this.running});

  factory ExperimentList.fromJson(Map<String, dynamic> j) => ExperimentList(
        experiments: (j['experiments'] as List? ?? const []).map((e) => Experiment.fromJson(_map(e))).toList(),
        running: SystemStatus.experimentName(j['experiment_running']),
      );

  final List<Experiment> experiments;
  final String? running;
}
