import csv
import json
import msvcrt
import os
import re
import sys
from collections import defaultdict
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from tempfile import NamedTemporaryFile

HOME = Path(sys.executable).parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parents[1]
DATA = HOME / "data"
MASTER = "all_devices.csv"
HISTORY = "history.csv"
RAW = "raw_exports"
META = "device.json"
COLUMNS = ["设备记录序号", "时段结束时间（北京时间，估算）", "最低温度（℃）", "最高温度（℃）",
           "最低相对湿度（%）", "最高相对湿度（%）", "设备计时（秒）"]
FIELDS = ["设备名称", "蓝牙地址", *COLUMNS]


def mac(value):
    value = value.strip().replace("-", ":").upper()
    if not re.fullmatch(r"(?:[0-9A-F]{2}:){5}[0-9A-F]{2}", value):
        raise ValueError("请输入有效的蓝牙 MAC 地址")
    return value


def folder(address):
    return DATA / mac(address).replace(":", "")


def migrate_legacy():
    legacy = HOME / "数据"
    if not legacy.is_dir():
        return
    if DATA.exists():
        raise ValueError("同时发现 data 和旧版「数据」目录。请分别备份后处理，避免覆盖记录。")

    def rename_if_present(source, target):
        if source.exists():
            source.rename(target)  # Windows refuses to replace an existing target.

    for device in legacy.iterdir():
        if device.is_dir() and re.fullmatch(r"[0-9a-fA-F]{12}", device.name):
            rename_if_present(device / "设备.json", device / META)
            rename_if_present(device / "历史.csv", device / HISTORY)
            rename_if_present(device / "原始导出", device / RAW)
            for source in (device / RAW).glob("温湿度历史_*.csv"):
                rename_if_present(source, source.with_name("history_" + source.name.removeprefix("温湿度历史_")))
    rename_if_present(legacy / "温湿度总表.csv", legacy / MASTER)
    legacy.rename(DATA)


@contextmanager
def locked():
    DATA.mkdir(parents=True, exist_ok=True)
    with (DATA / ".merge.lock").open("a+b") as lock:
        lock.seek(0)
        msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
        try:
            yield
        finally:
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)


@contextmanager
def atomic(path, encoding):
    temp = NamedTemporaryFile(mode="w", dir=path.parent, newline="", delete=False, encoding=encoding)
    try:
        with temp:
            yield temp
        os.replace(temp.name, path)
    finally:
        Path(temp.name).unlink(missing_ok=True)


def devices():
    result = {}
    for file in sorted(DATA.glob("*/" + META)):
        item = json.loads(file.read_text(encoding="utf-8"))
        address = mac(item["address"])
        if file.parent != folder(address):
            raise ValueError(f"设备目录与地址不符：{file.parent.name}")
        result[address] = item["name"]
    return result


def validate_name(name):
    name = name.strip()
    if not name or len(name) > 60 or any(ord(c) < 32 for c in name) or name[0] in "=+-@":
        raise ValueError("请输入 1–60 字的设备名称，首字符请使用文字或数字")
    return name


def register(address, name):
    address = mac(address)
    name = validate_name(name.strip() or address)
    with locked():
        device = folder(address)
        device.mkdir(exist_ok=True)
        if (device / META).exists():
            return
        with atomic(device / META, "utf-8") as stream:
            json.dump({"name": name, "address": address}, stream, ensure_ascii=False, indent=2)


def rename_device(address, name):
    address = mac(address)
    name = validate_name(name)
    with locked():
        meta = folder(address) / META
        if not meta.is_file():
            raise ValueError("找不到这个设备")
        item = json.loads(meta.read_text(encoding="utf-8"))
        if item["name"] != name:
            item["name"] = name
            item["alias_pending"] = True
            with atomic(meta, "utf-8") as stream:
                json.dump(item, stream, ensure_ascii=False, indent=2)
        if item.get("alias_pending"):
            try:
                merge_locked()
            except PermissionError as exc:
                raise ValueError("设备别名已保存。请关闭占用 CSV 的程序，再点击「重新合并」更新表格。") from exc


def read_rows(path, address, name):
    with path.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.reader(stream)
        header = next(reader, [])
        if header not in (COLUMNS, FIELDS):
            raise ValueError(f"无法识别列名：{path.name}")
        for row in reader:
            if len(row) != len(header):
                raise ValueError(f"{path.name} 第 {reader.line_num} 行列数异常")
            if header == FIELDS and mac(row[1]) != address:
                raise ValueError(f"{path.name} 含有其他设备的记录")
            yield [name, address, *row[-len(COLUMNS):]]


def save_rows(path, rows):
    with atomic(path, "utf-8-sig") as stream:
        writer = csv.writer(stream)
        writer.writerow(FIELDS)
        writer.writerows(rows)


def merge():
    with locked():
        return merge_locked()


def merge_locked():
    pending = []
    all_rows = []
    added = 0
    for address, name in devices().items():
        place = folder(address)
        item = json.loads((place / META).read_text(encoding="utf-8"))
        if item.get("alias_pending"):
            pending.append((place / META, item))
        history = place / HISTORY
        records = defaultdict(list)
        rows = []
        existing = 0
        sources = ([history] if history.exists() else []) + sorted((place / RAW).glob("*.csv"))
        for file in sources:
            for row in read_rows(file, address, name):
                key = int(row[2]), int(row[-1])
                end = datetime.fromisoformat(row[3])
                match = next((old for when, old in records[key]
                              if abs((end - when).total_seconds()) < 1800), None)
                if match is not None:
                    if match[4:8] != row[4:8]:
                        raise ValueError(f"{file.name} 的第 {row[2]} 号记录存在冲突")
                    continue
                records[key].append((end, row))
                rows.append(row)
            if file == history:
                existing = len(rows)
        if len(rows) != existing or not history.exists() or item.get("alias_pending"):
            rows.sort(key=lambda r: r[3])
            save_rows(history, rows)
        added += len(rows) - existing
        all_rows.extend(rows)
    all_rows.sort(key=lambda r: (r[3], r[1]))
    save_rows(DATA / MASTER, all_rows)
    for meta, item in pending:
        del item["alias_pending"]
        with atomic(meta, "utf-8") as stream:
            json.dump(item, stream, ensure_ascii=False, indent=2)
    return added, len(all_rows)
