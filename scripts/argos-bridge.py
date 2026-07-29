from __future__ import annotations

import argparse
import importlib.metadata
import json
import sys
from typing import Any

RESULT_PREFIX = "READER_ARGOS_RESULT:"


def emit(payload: dict[str, Any]) -> None:
    print(f"{RESULT_PREFIX}{json.dumps(payload, ensure_ascii=False)}", flush=True)


def installed_pair(from_code: str, to_code: str):
    import argostranslate.package

    return next(
        (
            package
            for package in argostranslate.package.get_installed_packages()
            if package.from_code == from_code and package.to_code == to_code
        ),
        None,
    )


def status(from_code: str, to_code: str) -> dict[str, Any]:
    package = installed_pair(from_code, to_code)
    readme = package.get_readme() if package else ""
    normalized_readme = (readme or "").upper().replace(" ", "-")
    model_license = "CC-BY-4.0" if "CC-BY-4.0" in normalized_readme else None
    return {
        "available": package is not None,
        "from": from_code,
        "to": to_code,
        "packageCode": package.code if package else None,
        "packageVersion": package.package_version if package else None,
        "modelLicense": model_license,
        "argosVersion": importlib.metadata.version("argostranslate"),
        "localOnly": True,
    }


def install(from_code: str, to_code: str) -> dict[str, Any]:
    import argostranslate.package

    existing = installed_pair(from_code, to_code)
    if existing is None:
        argostranslate.package.update_package_index()
        available = argostranslate.package.get_available_packages()
        candidate = next(
            (
                package
                for package in available
                if package.from_code == from_code and package.to_code == to_code
            ),
            None,
        )
        if candidate is None:
            raise RuntimeError(f"官方模型索引中没有 {from_code} → {to_code} 语言包。")
        model_path = candidate.download()
        argostranslate.package.install_from_path(model_path)
    return status(from_code, to_code)


def translate_text(from_code: str, to_code: str) -> dict[str, Any]:
    import argostranslate.translate

    request = json.loads(sys.stdin.read() or "{}")
    text = request.get("text")
    if not isinstance(text, str) or not text.strip():
        raise ValueError("没有收到需要翻译的文本。")
    if installed_pair(from_code, to_code) is None:
        raise RuntimeError(f"尚未安装 {from_code} → {to_code} 本地语言包。")
    translated = argostranslate.translate.translate(text, from_code, to_code)
    return {
        "text": translated,
        "from": from_code,
        "to": to_code,
        "provider": "argos",
        "localOnly": True,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("status", "install", "translate"))
    parser.add_argument("--from-code", default="en")
    parser.add_argument("--to-code", default="zh")
    args = parser.parse_args()

    try:
        if args.command == "status":
            result = status(args.from_code, args.to_code)
        elif args.command == "install":
            result = install(args.from_code, args.to_code)
        else:
            result = translate_text(args.from_code, args.to_code)
        emit({"ok": True, "result": result})
        return 0
    except Exception as error:
        emit({"ok": False, "error": str(error)})
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
