"""pricing.py - library: T3 model rates and token pricing, shared by retro.py and corpus/. An unpriced model is None, never 0."""
import json, os

HOME = os.path.expanduser("~")
T3 = (os.environ.get("T3_USERDATA") or f"{HOME}/.t3/userdata").replace(os.sep, "/")


def load_rates(t3=T3):
    return json.load(open(f"{t3}/usage-model-rates.json"))["document"]


def rate(rates, model):
    for k in (model, "anthropic." + model, "openai/" + model):
        if k in rates: return rates[k]
    return None


def usd(rates, model, inp, cache_create, cache_read, out):
    """Dollars for one model's token counts at that model's own rate; None when the model has no rate."""
    r = rate(rates, model)
    if not r: return None
    return (inp * (r.get("input_cost_per_token") or 0)
            + cache_create * (r.get("cache_creation_input_token_cost") or r.get("input_cost_per_token") or 0)
            + cache_read * (r.get("cache_read_input_token_cost") or 0)
            + out * (r.get("output_cost_per_token") or 0))
