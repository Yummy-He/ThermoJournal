"""Command-line compatibility entry point for the sensor archive."""
import argparse
import asyncio
from app.sensor import export, menu
from app.storage import devices, mac, merge, register, migrate_legacy


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("address", nargs="?")
    parser.add_argument("--merge", action="store_true")
    args = parser.parse_args()
    migrate_legacy()
    if args.merge:
        print("新增条数、总条数：", merge())
    elif args.address:
        address = mac(args.address)
        name = devices().get(address, address)
        register(address, name)
        print("新增条数、总条数：", asyncio.run(export(address, name)))
    else:
        menu()


if __name__ == "__main__":
    main()
