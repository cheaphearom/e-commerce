"""Download and unzip the Loghub HDFS_v1 and BGL datasets from Zenodo.

Usage: ``python -m src.download``. Skips files that already exist.
"""
from __future__ import annotations

import argparse
import shutil
import urllib.request
import zipfile

from tqdm import tqdm

from src.utils import get_logger, load_config, p

log = get_logger("download")


def download(url: str, dest) -> None:
    """Stream ``url`` to ``dest`` with a progress bar."""
    tmp = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(url, timeout=60) as r, open(tmp, "wb") as fh:
        total = int(r.headers.get("Content-Length", 0)) or None
        with tqdm(total=total, unit="B", unit_scale=True, desc=dest.name) as bar:
            while chunk := r.read(1 << 20):
                fh.write(chunk)
                bar.update(len(chunk))
    tmp.rename(dest)


def main() -> None:
    argparse.ArgumentParser(description=__doc__).parse_args()
    cfg = load_config()
    raw = p(cfg["paths"]["raw"])
    raw.mkdir(parents=True, exist_ok=True)
    for name in cfg["download"]["files"]:
        zpath = raw / name
        out_dir = raw / zpath.stem
        if out_dir.exists() and any(out_dir.iterdir()):
            log.info("%s already extracted -> %s", name, out_dir)
            continue
        if not zpath.exists():
            url = f"{cfg['download']['base_url']}/{name}?download=1"
            log.info("Downloading %s", url)
            try:
                download(url, zpath)
            except Exception as exc:  # noqa: BLE001 - report and stop, never fail silently
                raise SystemExit(
                    f"Download of {url} failed ({exc}). Download it by hand and put {name} in {raw}/"
                ) from exc
        log.info("Extracting %s", zpath)
        try:
            with zipfile.ZipFile(zpath) as z:
                z.extractall(out_dir)
        except zipfile.BadZipFile as exc:
            shutil.rmtree(out_dir, ignore_errors=True)
            raise SystemExit(f"{zpath} is corrupt; delete it and rerun") from exc
    log.info("Done")


if __name__ == "__main__":
    main()
