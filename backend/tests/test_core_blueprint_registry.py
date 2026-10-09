"""Structural guards for the curated core blueprint registry."""

import ast
import hashlib
from pathlib import Path

from app.core_blueprints import CORE_BLUEPRINTS


EXPECTED_CORE_BLUEPRINT_COUNT = 116
EXPECTED_MANIFEST_SHA256 = (
    '25d28d92ccddddc246d5b2081d84b11f1df10cb662f33c256ebcbe390d2813d5'
)


def _manifest_payload() -> bytes:
    entries = tuple(spec.manifest_entry for spec in CORE_BLUEPRINTS)
    return repr(entries).encode()


def test_core_blueprint_manifest_matches_pre_extraction_snapshot():
    """Guard every module, attribute, prefix, alias, and ordering decision."""
    assert len(CORE_BLUEPRINTS) == EXPECTED_CORE_BLUEPRINT_COUNT
    assert hashlib.sha256(_manifest_payload()).hexdigest() == (
        EXPECTED_MANIFEST_SHA256
    )


def test_create_app_delegates_blueprint_registration_to_registry():
    """Keep the factory compositional instead of rebuilding the import wall."""
    app_init = Path(__file__).parents[1] / 'app' / '__init__.py'
    module = ast.parse(app_init.read_text(encoding='utf-8'))
    create_app = next(
        node
        for node in module.body
        if isinstance(node, ast.FunctionDef) and node.name == 'create_app'
    )

    direct_registrations = [
        node
        for node in ast.walk(create_app)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == 'register_blueprint'
    ]

    assert direct_registrations == []


def test_app_mounts_every_core_blueprint_at_its_curated_prefix(app):
    """Verify the real app's blueprint objects and URL rules match the registry."""
    rules = tuple(app.url_map.iter_rules())

    for spec in CORE_BLUEPRINTS:
        blueprint = spec.load()
        registration_name = spec.name or blueprint.name
        assert app.blueprints.get(registration_name) is blueprint, (
            f'{registration_name} was not registered from {spec.module}'
        )

        blueprint_rules = tuple(
            rule
            for rule in rules
            if rule.endpoint == registration_name
            or rule.endpoint.startswith(f'{registration_name}.')
        )
        assert blueprint_rules, f'{registration_name} registered no URL rules'

        prefix = spec.url_prefix.rstrip('/')
        assert all(
            rule.rule == prefix or rule.rule.startswith(f'{prefix}/')
            for rule in blueprint_rules
        ), f'{registration_name} has a rule outside {spec.url_prefix}'
