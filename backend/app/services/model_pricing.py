"""Current public-price reference only, never a supplier billing ledger."""
from decimal import Decimal

from app.core.config import get_settings

CHECKED_AT = '2026-10-31'
SOURCE_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/'
FLASH_MODELS = {'deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'}
RATES = {'input_hit': [0.02, 0.04], 'input_miss': [1, 2], 'output': [4, 8]}


def record_reference_cost(row, *, source='server'):
    if source != 'server' or row.model not in FLASH_MODELS:
        return None
    if not all(type(value) is int and value >= 0 for value in (row.input_tokens, row.output_tokens)):
        return None
    input_count, output_count = Decimal(row.input_tokens), Decimal(row.output_tokens)
    return (
        float((input_count * Decimal('0.02') + output_count * 4) / 1_000_000),
        float((input_count * 2 + output_count * 8) / 1_000_000),
    )


def pricing_summary(rows, *, source='server'):
    models = [row for row in rows if row.model is not None or row.input_tokens is not None
              or row.output_tokens is not None] if source == 'server' else []
    priced = [cost for row in models if (cost := record_reference_cost(row)) is not None]
    unpriced = sum(row.model not in FLASH_MODELS for row in models)
    return {'configured_model': get_settings().deepseek_model,
        'official_version': 'DeepSeek-V4.1-Flash-1017', 'checked_at': CHECKED_AT,
        'source_url': SOURCE_URL, 'currency': 'CNY', 'per_tokens': 1_000_000, 'rates': RATES,
        'basis': 'current_public_rates', 'model_records': len(models), 'priced_records': len(priced),
        'unknown_usage_records': len(models) - len(priced) - unpriced, 'unpriced_records': unpriced,
        'min_cny': sum(cost[0] for cost in priced) if priced else None,
        'max_cny': sum(cost[1] for cost in priced) if priced else None}
