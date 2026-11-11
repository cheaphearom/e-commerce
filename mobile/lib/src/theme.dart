import 'package:flutter/material.dart';

/// Method labels and colours: the same as the web monitor and the evaluation figures, so a
/// method has one colour everywhere in the thesis.
const methodOrder = [
  'rules', 'rules_tuned', 'rules_tuned_k1', 'isolation_forest', 'random_forest', 'pca', 'logistic_regression',
];

const methodLabels = {
  'rules': 'Rule-based',
  'rules_tuned': 'Rules (tuned)',
  'rules_tuned_k1': 'Rules (tuned, k=1)',
  'isolation_forest': 'Isolation Forest',
  'random_forest': 'Random Forest',
  'pca': 'PCA',
  'logistic_regression': 'Logistic Regression',
};

const methodColors = {
  'rules': Color(0xFF2A78D6),
  'rules_tuned': Color(0xFFEDA100),
  'rules_tuned_k1': Color(0xFF6250D6),
  'isolation_forest': Color(0xFFEB6834),
  'random_forest': Color(0xFF1BAF7A),
  'pca': Color(0xFF008300),
  'logistic_regression': Color(0xFFE87BA4),
};

String methodLabel(String m) => methodLabels[m] ?? m;
Color methodColor(String m) => methodColors[m] ?? Colors.grey;

/// Methods in their fixed order (unknown ones last), so colours and rows never shuffle.
List<String> orderedMethods(Iterable<String> methods) {
  final list = methods.toList();
  int rank(String m) {
    final i = methodOrder.indexOf(m);
    return i < 0 ? methodOrder.length : i;
  }

  list.sort((a, b) => rank(a).compareTo(rank(b)));
  return list;
}

/// Status colours (always shown together with a text label, never alone).
const statusGood = Color(0xFF0B8A3E);
const statusWarning = Color(0xFFB26B00);
const statusCritical = Color(0xFFC62828);

ThemeData buildTheme(Brightness brightness) {
  final scheme = ColorScheme.fromSeed(seedColor: const Color(0xFF2A78D6), brightness: brightness);
  return ThemeData(
    colorScheme: scheme,
    useMaterial3: true,
    cardTheme: const CardThemeData(margin: EdgeInsets.symmetric(vertical: 6)),
    visualDensity: VisualDensity.standard,
  );
}

String formatTime(DateTime? t) {
  if (t == null) return '–';
  String two(int v) => v.toString().padLeft(2, '0');
  return '${two(t.hour)}:${two(t.minute)}:${two(t.second)}';
}

String formatMoney(double v) {
  final whole = v.truncate().toString().replaceAllMapped(RegExp(r'\B(?=(\d{3})+(?!\d))'), (_) => ',');
  final cents = ((v - v.truncate()).abs() * 100).round().toString().padLeft(2, '0');
  return '\$$whole.$cents';
}
