#!/usr/bin/env python3
"""
Generate locale JSONs for every language in frontend/src/i18n/languages.ts
by translating frontend/src/i18n/locales/en.json via the free MyMemory API.

Usage:
    python scripts/i18n-translate.py [--force]

Without --force, languages whose JSON already exists are skipped (idempotent).
Pass --force to re-translate everything.

MyMemory free tier: 5 000 chars / day per IP without an email, 50 000 with one.
The de= query param attributes calls to the email so the higher limit applies.
"""
import argparse
import concurrent.futures
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EN_PATH = ROOT / 'frontend' / 'src' / 'i18n' / 'locales' / 'en.json'
LOCALES_DIR = EN_PATH.parent
EMAIL = 'souravroy7864@gmail.com'  # higher daily char limit

# Order matters: same as LANGUAGES in languages.ts for predictable runs.
TARGETS = [
    'es', 'zh-CN', 'zh-TW', 'hi', 'ar', 'pt-BR', 'bn', 'ru', 'ja', 'pa',
    'de', 'ko', 'fr', 'vi', 'te', 'mr', 'tr', 'ta', 'ur', 'fa', 'pl',
    'it', 'uk', 'id', 'th', 'nl', 'he', 'sv', 'el', 'cs', 'hu', 'ro',
    'tl', 'ms',
]

# MyMemory mostly accepts ISO-639-1 codes; a couple need normalisation.
MM_CODE = {
    'zh-CN': 'zh-CN',
    'zh-TW': 'zh-TW',
    'pt-BR': 'pt-BR',
    'tl': 'tl',  # Tagalog
    # Rest pass through unchanged
}

# MyMemory error markers to detect and treat as "leave English untouched"
BAD_PREFIXES = (
    'INVALID', 'NO QUERY', 'PLEASE', 'YOU USED',
    'TRANSLATION SERVICE TEMPORARILY UNAVAILABLE',
    'MYMEMORY WARNING',
)


def translate_one(text: str, target: str, retries: int = 3) -> str:
    """One HTTP call. Returns the translated string, or the original on failure."""
    if not text or text.strip() == '':
        return text
    tgt = MM_CODE.get(target, target)
    encoded = urllib.parse.quote(text)
    url = (
        f'https://api.mymemory.translated.net/get'
        f'?q={encoded}&langpair=en|{tgt}&de={EMAIL}'
    )
    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'quilt-i18n/1.0'})
            with urllib.request.urlopen(req, timeout=20) as resp:
                payload = json.loads(resp.read().decode('utf-8'))
            t = payload.get('responseData', {}).get('translatedText', '')
            if not t or any(t.upper().startswith(p) for p in BAD_PREFIXES):
                return text
            return t
        except Exception as e:
            last_err = e
            time.sleep(0.8 * (attempt + 1))
    print(f'  ! {target}: failed after {retries} tries: {last_err}', file=sys.stderr)
    return text


def flatten(d: dict, prefix: str = '') -> dict[str, str]:
    """Flatten nested dict so each leaf gets its dotted key."""
    out = {}
    for k, v in d.items():
        key = f'{prefix}.{k}' if prefix else k
        if isinstance(v, dict):
            out.update(flatten(v, key))
        else:
            out[key] = v
    return out


def unflatten(flat: dict[str, str]) -> dict:
    """Inverse of flatten."""
    out: dict = {}
    for key, val in flat.items():
        parts = key.split('.')
        cur = out
        for p in parts[:-1]:
            cur = cur.setdefault(p, {})
        cur[parts[-1]] = val
    return out


def translate_lang(target: str, en_flat: dict[str, str], pause: float) -> dict[str, str]:
    """Translate every value in en_flat to target language, sequentially within the lang."""
    out = {}
    for k, v in en_flat.items():
        out[k] = translate_one(v, target)
        time.sleep(pause)  # be polite per-string
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--force', action='store_true', help='Re-translate even if file exists')
    parser.add_argument('--workers', type=int, default=4, help='Parallel languages (default 4)')
    parser.add_argument('--pause', type=float, default=0.4,
                        help='Seconds between API calls within one language (default 0.4)')
    args = parser.parse_args()

    if not EN_PATH.exists():
        print(f'Missing {EN_PATH}', file=sys.stderr)
        sys.exit(1)

    with EN_PATH.open(encoding='utf-8') as f:
        en = json.load(f)
    en_flat = flatten(en)
    print(f'Base en.json: {len(en_flat)} strings')

    todo = []
    for lang in TARGETS:
        out_path = LOCALES_DIR / f'{lang}.json'
        if out_path.exists() and not args.force:
            print(f'  skip {lang} (exists)')
            continue
        todo.append((lang, out_path))

    if not todo:
        print('Nothing to do. Use --force to retranslate.')
        return

    print(f'Translating {len(todo)} language(s) with {args.workers} workers...')

    def work(item):
        lang, out_path = item
        t0 = time.time()
        flat = translate_lang(lang, en_flat, args.pause)
        nested = unflatten(flat)
        with out_path.open('w', encoding='utf-8') as f:
            json.dump(nested, f, ensure_ascii=False, indent=2)
            f.write('\n')
        return lang, time.time() - t0

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as ex:
        for lang, elapsed in ex.map(work, todo):
            print(f'  done {lang} in {elapsed:.1f}s -> {LOCALES_DIR / f"{lang}.json"}')

    print('All done.')


if __name__ == '__main__':
    main()
