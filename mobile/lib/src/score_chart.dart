import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'models.dart';
import 'theme.dart';

/// Anomaly score ÷ threshold per method over time; the dashed line at 1 is the alert threshold.
class ScoreChart extends StatelessWidget {
  const ScoreChart({super.key, required this.points, this.height = 180});

  final List<HistoryPoint> points;
  final double height;

  @override
  Widget build(BuildContext context) {
    final methods = orderedMethods({for (final p in points) ...p.methods.keys});
    final theme = Theme.of(context);
    if (points.length < 2) {
      return SizedBox(
        height: height,
        child: Center(child: Text('Collecting scores… the chart fills in as windows are scored.',
            style: theme.textTheme.bodySmall, textAlign: TextAlign.center)),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(spacing: 12, runSpacing: 4, children: [
          for (final m in methods)
            Row(mainAxisSize: MainAxisSize.min, children: [
              Container(width: 14, height: 3, color: methodColor(m)),
              const SizedBox(width: 4),
              Text(methodLabel(m), style: theme.textTheme.bodySmall),
            ]),
        ]),
        const SizedBox(height: 8),
        SizedBox(
          height: height,
          width: double.infinity,
          child: Semantics(
            label: 'Anomaly score chart for ${methods.map(methodLabel).join(', ')}',
            child: CustomPaint(
              painter: ScoreChartPainter(
                points: points,
                methods: methods,
                grid: theme.colorScheme.outlineVariant,
                text: theme.colorScheme.onSurfaceVariant,
                surface: theme.colorScheme.surface,
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class ScoreChartPainter extends CustomPainter {
  ScoreChartPainter({required this.points, required this.methods, required this.grid,
      required this.text, required this.surface});

  final List<HistoryPoint> points;
  final List<String> methods;
  final Color grid;
  final Color text;
  final Color surface;

  static const _left = 30.0;
  static const _bottom = 18.0;

  /// Upper end of the y axis: at least 1.5 so the threshold is always visible.
  double get yMax {
    var m = 1.5;
    for (final p in points) {
      for (final s in p.methods.values) {
        if (s.ratio.isFinite) m = math.max(m, s.ratio);
      }
    }
    return math.min(m * 1.1, 10);
  }

  @override
  void paint(Canvas canvas, Size size) {
    final plot = Rect.fromLTRB(_left, 4, size.width - 4, size.height - _bottom);
    final t0 = points.first.time.millisecondsSinceEpoch.toDouble();
    final t1 = math.max(points.last.time.millisecondsSinceEpoch.toDouble(), t0 + 1);
    final top = yMax;
    double x(DateTime t) => plot.left + (t.millisecondsSinceEpoch - t0) / (t1 - t0) * plot.width;
    double y(double v) => plot.bottom - (v.clamp(0, top) / top) * plot.height;

    final gridPaint = Paint()..color = grid..strokeWidth = 1;
    for (final v in [0.0, 0.5, 1.0, 1.5]) {
      if (v > top) continue;
      canvas.drawLine(Offset(plot.left, y(v)), Offset(plot.right, y(v)), gridPaint);
      _label(canvas, v.toStringAsFixed(1), Offset(0, y(v) - 6));
    }
    // dashed alert threshold at 1
    final dash = Paint()..color = text..strokeWidth = 1;
    for (var dx = plot.left; dx < plot.right; dx += 8) {
      canvas.drawLine(Offset(dx, y(1)), Offset(math.min(dx + 4, plot.right), y(1)), dash);
    }
    _label(canvas, formatTime(points.first.time), Offset(plot.left, plot.bottom + 3));
    _label(canvas, formatTime(points.last.time), Offset(plot.right - 52, plot.bottom + 3));

    for (final m in methods) {
      final path = Path();
      var started = false;
      for (final p in points) {
        final s = p.methods[m];
        if (s == null || !s.ratio.isFinite) {
          started = false;
          continue;
        }
        final o = Offset(x(p.time), y(s.ratio));
        started ? path.lineTo(o.dx, o.dy) : path.moveTo(o.dx, o.dy);
        started = true;
      }
      canvas.drawPath(path, Paint()
        ..color = methodColor(m)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2
        ..strokeJoin = StrokeJoin.round);
    }
  }

  void _label(Canvas canvas, String s, Offset at) {
    final tp = TextPainter(text: TextSpan(text: s, style: TextStyle(color: text, fontSize: 10)),
        textDirection: TextDirection.ltr)
      ..layout();
    tp.paint(canvas, at);
  }

  @override
  bool shouldRepaint(ScoreChartPainter old) => old.points != points || old.methods != methods;
}
