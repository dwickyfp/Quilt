#!/usr/bin/env python3
"""
Incremental translation filler. For each locale, finds keys present in
en.json but missing from the locale and translates only those. Uses
Google Translate via deep-translator (different API than MyMemory, way
faster + no rate limit at our volume).

Idempotent: existing translations are preserved. Run repeatedly until
all locales are complete.

Usage:
    python scripts/i18n-fill.py [--workers N]
"""
import argparse
import concurrent.futures
import json
import sys
import time
from pathlib import Path

from deep_translator import GoogleTranslator

ROOT = Path(__file__).resolve().parent.parent
LOCALES_DIR = ROOT / 'frontend' / 'src' / 'i18n' / 'locales'
EN_PATH = LOCALES_DIR / 'en.json'

# Google Translate language codes (mostly match our codes; a few need mapping)
GOOG = {
    'zh-CN': 'zh-CN',
    'zh-TW': 'zh-TW',
    'pt-BR': 'pt',  # Google uses generic 'pt' for both, close enough
    'tl': 'tl',
    'he': 'iw',  # Google uses old code 'iw' for Hebrew
}


def flatten(d, prefix=''):
    out = {}
    for k, v in d.items():
        key = f'{prefix}.{k}' if prefix else k
        if isinstance(v, dict):
            out.update(flatten(v, key))
        else:
            out[key] = v
    return out


def unflatten(flat):
    out = {}
    for key, val in flat.items():
        parts = key.split('.')
        cur = out
        for p in parts[:-1]:
            cur = cur.setdefault(p, {})
        cur[parts[-1]] = val
    return out


def translate_lang(lang, en_flat):
    out_path = LOCALES_DIR / f'{lang}.json'
    if out_path.exists():
        with out_path.open(encoding='utf-8') as f:
            existing = flatten(json.load(f))
    else:
        existing = {}

    missing = {k: v for k, v in en_flat.items() if k not in existing or existing[k] == en_flat[k]}
    if not missing:
        return lang, 0, 0

    tgt = GOOG.get(lang, lang)
    translator = GoogleTranslator(source='en', target=tgt)

    n_translated = 0
    n_failed = 0
    for k, v in missing.items():
        try:
            t = translator.translate(v)
            if t and t.strip():
                existing[k] = t
                n_translated += 1
            else:
                existing[k] = v
                n_failed += 1
        except Exception as e:
            print(f'  ! {lang}: {k}: {e}', file=sys.stderr)
            existing[k] = v
            n_failed += 1

    nested = unflatten(existing)
    with out_path.open('w', encoding='utf-8') as f:
        json.dump(nested, f, ensure_ascii=False, indent=2)
        f.write('\n')

    return lang, n_translated, n_failed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--workers', type=int, default=8)
    parser.add_argument('--only', nargs='+', help='Only these language codes')
    args = parser.parse_args()

    with EN_PATH.open(encoding='utf-8') as f:
        en_flat = flatten(json.load(f))

    all_langs = [
        'es', 'zh-CN', 'zh-TW', 'hi', 'ar', 'pt-BR', 'bn', 'ru', 'ja', 'pa',
        'de', 'ko', 'fr', 'vi', 'te', 'mr', 'tr', 'ta', 'ur', 'fa', 'pl',
        'it', 'uk', 'id', 'th', 'nl', 'he', 'sv', 'el', 'cs', 'hu', 'ro',
        'tl', 'ms',
        # Pass 3 additions (25 languages, 35 -> 60 total)
        'no', 'da', 'fi', 'ca', 'bg', 'sk', 'hr', 'sr', 'sl', 'lt',
        'lv', 'et', 'km', 'my', 'si', 'ne', 'sw', 'af', 'cy', 'ga',
        'is', 'sq', 'az', 'mn', 'kk',
    ]
    langs = args.only if args.only else all_langs

    print(f'Filling {len(langs)} language(s) with {args.workers} workers...')
    t0 = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {ex.submit(translate_lang, lang, en_flat): lang for lang in langs}
        for fut in concurrent.futures.as_completed(futures):
            lang, n_ok, n_fail = fut.result()
            if n_ok + n_fail == 0:
                print(f'  {lang}: already complete')
            else:
                print(f'  {lang}: +{n_ok} translated, {n_fail} failed')
    elapsed = time.time() - t0
    print(f'Done in {elapsed:.1f}s')


if __name__ == '__main__':
    main()
