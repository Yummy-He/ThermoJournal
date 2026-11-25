import asyncio
import csv
from datetime import datetime, timedelta, timezone
import struct

from bleak import BleakClient, BleakScanner
from app.storage import FIELDS, RAW, devices, folder, merge, register


def characteristic(short):
    return f"ebe0{short}-7a0a-4b0c-8a1a-6ff2997da3a6"


async def export(address, name, report=print):
    device = await BleakScanner.find_device_by_address(address, timeout=25)
    if device is None:
        raise RuntimeError("找不到设备，请靠近电脑并退出米家设备页后重试。")
    queue = asyncio.Queue()
    async with BleakClient(device, timeout=30) as client:
        report("已连接，正在读取历史记录")
        clock = await client.read_gatt_char(characteristic("ccb7"), use_cached=False)
        now = datetime.now(timezone(timedelta(hours=8)))
        clock_origin = now - timedelta(seconds=struct.unpack_from("<I", clock)[0])
        counts = await client.read_gatt_char(characteristic("ccb9"), use_cached=False)
        total, retained = struct.unpack_from("<II", counts)
        report(f"设备保留了 {retained} 条记录")
        if retained == 0:
            return merge()
        await client.start_notify(characteristic("ccbc"), lambda _, data: queue.put_nowait(bytes(data)))
        seen = set()
        archive = folder(address) / RAW
        archive.mkdir(exist_ok=True)
        path = archive / f"{now:%Y%m%d_%H%M%S_%f}_{address.replace(':', '')}.csv"
        partial = path.with_suffix(".partial")
        stream = None
        try:
            while True:
                try:
                    packet = await asyncio.wait_for(queue.get(), timeout=30)
                except asyncio.TimeoutError:
                    break
                idx, tick, high, wet, low, dry = struct.unpack("<IIhBhB", packet)
                if idx in seen:
                    continue
                if stream is None:
                    stream = partial.open("x", newline="", encoding="utf-8-sig")
                    writer = csv.writer(stream)
                    writer.writerow(FIELDS)
                end_time = clock_origin + timedelta(seconds=tick)
                writer.writerow([name, address, idx, end_time.isoformat(timespec="seconds"), low / 10, high / 10,
                                 dry, wet, tick])
                stream.flush()
                seen.add(idx)
                if len(seen) % 200 == 0 or len(seen) == 1:
                    report(f"已读取 {len(seen):,} / {retained:,} 条")
                if retained and len(seen) == retained:
                    break
        finally:
            if stream is not None:
                stream.close()
        print("Records received:", len(seen), "device retained:", retained)
        if len(seen) != retained or not seen:
            raise RuntimeError("记录为空或传输中断，请靠近设备后重试。")
        partial.rename(path)
        print("原始导出：", path)
    report("正在合并记录")
    return merge()


async def discover():
    print("正在扫描附近的 LYWSD03MMC，约需 15 秒……", flush=True)
    advertisements = await BleakScanner.discover(timeout=15, return_adv=True)
    found = []
    for device, adv in advertisements.values():
        named = "LYWSD03" in (adv.local_name or "").upper()
        identified = any(k.startswith("0000fe95") and v[2:4] == bytes.fromhex("5b05")
                         for k, v in adv.service_data.items())
        if named or identified:
            found.append(device.address.upper())
    return sorted(found)


def choose(addresses, known):
    for i, address in enumerate(addresses, 1):
        print(f"{i}. {known.get(address, '未登记设备')}  {address}")
    selection = input("输入设备编号（回车取消）：").strip()
    if not selection:
        return None
    if not selection.isdecimal() or not 1 <= int(selection) <= len(addresses):
        raise ValueError("设备编号超出范围")
    return addresses[int(selection) - 1]


def menu():
    known = devices()
    print("1. 导出已知设备并合并\n2. 扫描附近设备并导出\n3. 仅重新合并已有文件")
    action = input("请选择 [1]：").strip() or "1"
    if action == "3":
        print("新增条数、总条数：", merge())
        return
    if action == "1":
        address = choose(list(known), known) if len(known) > 1 else next(iter(known), None)
        if not known:
            print("暂无设备，请选择 2 扫描并登记。")
    elif action == "2":
        addresses = asyncio.run(discover())
        if not addresses:
            raise ValueError("没有找到该型号，请靠近温湿度计并退出米家设备页面后重试。")
        address = choose(addresses, known)
    else:
        raise ValueError("请选择 1、2 或 3")
    if address:
        name = known.get(address) or input("给这台温湿度计起个名字（例如卧室）：").strip() or address
        print(f"准备导出 {name}（{address}）")
        register(address, name)
        print("新增条数、总条数：", asyncio.run(export(address, name)))


