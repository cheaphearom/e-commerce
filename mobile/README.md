# Thesis Shop & Monitor (Flutter)

A mobile (Android) and web app for the saga microservices, with three tabs:

| Tab | What it does | Talks to |
|---|---|---|
| **Monitor** (opens first) | overall status, service health and active faults, live anomaly score per detector, the latest window, recent alerts with their explanation, experiment runs with F1 per method, fault injection | ml-detector (port 8000) |
| **Shop** | choose a customer, order products, follow each order through the saga (completed / cancelled with the reason) | api-gateway (port 8080) |
| **Settings** | the address of the PC that runs the system, connection test | ml-detector |

**Keeping experiments clean.** Shop requests are real traffic and end up in the analysed logs.
The Shop tab therefore asks the monitor first and makes **no** shop request while an experiment
runs (it shows "Experiment running – the shop is paused" instead), and only the visible tab
polls. The Monitor tab only talks to the ml-detector, which adds nothing to the analysed logs, so
it can stay open during experiments; its fault button is disabled while one runs. The connection
test also uses only the monitor.

## Run it

The system must be running on the PC first (`docker compose up -d` in the repository root).

### On an Android phone

1. Install the APK (`build/app/outputs/flutter-apk/app-release.apk`, or build it as below):
   copy it to the phone and open it (allow "install unknown apps" for your file manager).
2. Phone and PC on the **same Wi-Fi**. Find the PC's address: on Windows run `ipconfig` and take
   the *IPv4 Address* of the Wi-Fi adapter (e.g. `192.168.1.20`).
3. In the app: **Settings** → PC address → `192.168.1.20` → **Save**, then **Test connection**.
4. If the phone cannot connect, allow ports 8080 and 8000 in the Windows firewall (Windows usually
   asks the first time Docker opens them; otherwise add inbound rules).

The Android emulator reaches the PC as `10.0.2.2`, which is the default address.

### In a browser (web build)

```bash
flutter build web --release --no-web-resources-cdn
```

```bash
python -m http.server 5000 --directory build/web
```

Open <http://localhost:5000>. It uses the page's host as the server address, so from another
device open `http://<PC address>:5000`. The gateway and the ml-detector allow cross-origin
requests for this (CORS); restrict them with `CORS_ALLOWED_ORIGINS` (gateway) and
`CORS_ALLOW_ORIGINS` (ml-detector), e.g. `http://localhost:5000`.

## Build and test

Flutter 3.47 (stable) with the Android SDK (platform 36). From this folder:

```bash
flutter pub get
```

```bash
flutter analyze
```

```bash
flutter test
```

```bash
flutter build apk --release
```

```bash
flutter run
```

The release APK is signed with Flutter's debug key: fine for installing on your own phone, not
for the Play Store.

The tests run against an in-memory fake of the gateway and the ml-detector
(`test/fake_backend.dart`) and check, among other things, that no request reaches the gateway
while an experiment runs and that the monitor never calls the gateway.

## Code

```
lib/
├── main.dart              app, tabs (only the visible tab is built and polls)
└── src/
    ├── config.dart        server address and ports, saved on the device
    ├── api.dart           HTTP client for the gateway and the ml-detector, readable errors
    ├── models.dart        products, orders, services, detections, alerts, experiments
    ├── shop_screen.dart   the shop (paused during experiments)
    ├── monitor_screen.dart  the monitor and the fault sheet
    ├── settings_screen.dart server address and connection test
    ├── score_chart.dart   score ÷ threshold per method over time (custom painter)
    ├── polling.dart       refresh every 5 s while a screen is shown
    └── theme.dart         method labels and colours (same as the web monitor and the figures)
```
