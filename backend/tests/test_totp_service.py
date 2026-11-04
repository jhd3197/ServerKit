"""TOTPService / TwoFactorSetup behaviour (RFC 6238 via pyotp)."""
import time
from urllib.parse import parse_qs, urlparse

import pyotp
import pytest
from werkzeug.security import generate_password_hash

from app import db
from app.models import User
from app.services.totp_service import TOTPService, TwoFactorSetup


@pytest.fixture
def secret():
    return TOTPService.generate_secret()


@pytest.fixture
def user(app):
    u = User(email='t@example.com', username='totp-user',
             password_hash=generate_password_hash('x'), role='developer', is_active=True)
    db.session.add(u)
    db.session.commit()
    return u


def test_generate_secret_is_random_valid_base32():
    a, b = TOTPService.generate_secret(), TOTPService.generate_secret()
    assert a != b
    assert len(a) == 32
    pyotp.TOTP(a).now()  # decodes as base32


def test_current_code_verifies(secret):
    code = TOTPService.get_current_code(secret)
    assert len(code) == 6 and code.isdigit()
    assert TOTPService.verify_code(secret, code)


def test_code_with_spaces_and_dashes_is_normalised(secret):
    code = TOTPService.get_current_code(secret)
    assert TOTPService.verify_code(secret, f'{code[:3]} {code[3:]}')
    assert TOTPService.verify_code(secret, f'{code[:3]}-{code[3:]}')


@pytest.mark.parametrize('bad', ['', None, 'abcdef', '12345', '1234567', '000000x'])
def test_malformed_or_missing_code_is_rejected(secret, bad):
    # A wrong 6-digit code could collide with the real one 1-in-a-million; use a shape check only.
    assert not TOTPService.verify_code(secret, bad)


def test_missing_secret_is_rejected():
    assert not TOTPService.verify_code(None, '123456')
    assert not TOTPService.verify_code('', '123456')


def test_wrong_code_is_rejected(secret):
    real = TOTPService.get_current_code(secret)
    wrong = f'{(int(real) + 1) % 1000000:06d}'
    # Neighbouring-window codes are also valid, so make sure we truly picked a stranger.
    totp = TOTPService.get_totp(secret)
    now = time.time()
    valid = {totp.at(now + d * 30) for d in (-1, 0, 1)}
    if wrong in valid:
        pytest.skip('collided with a neighbouring window')
    assert not TOTPService.verify_code(secret, wrong)


def test_window_drift(secret):
    totp = TOTPService.get_totp(secret)
    prev = totp.at(time.time() - 30)
    far = totp.at(time.time() - 120)
    assert TOTPService.verify_code(secret, prev, valid_window=1)
    assert not TOTPService.verify_code(secret, far, valid_window=1)
    assert not TOTPService.verify_code(secret, far, valid_window=0)


def test_provisioning_uri(secret):
    uri = TOTPService.get_provisioning_uri(secret, 'me@example.com')
    parsed = urlparse(uri)
    assert parsed.scheme == 'otpauth' and parsed.netloc == 'totp'
    qs = parse_qs(parsed.query)
    assert qs['secret'] == [secret]
    assert qs['issuer'] == ['ServerKit']
    assert 'me%40example.com' in parsed.path or 'me@example.com' in parsed.path


def test_qr_code_is_png_data_uri(secret):
    qr = TOTPService.generate_qr_code_base64(secret, 'me@example.com')
    if qr is None:
        pytest.skip('qrcode not installed')
    assert qr.startswith('data:image/png;base64,')


def test_backup_codes_roundtrip():
    plain, hashed = TOTPService.generate_backup_codes()
    assert len(plain) == len(hashed) == TOTPService.BACKUP_CODE_COUNT
    assert len(set(plain)) == len(plain)
    assert all(len(c) == TOTPService.BACKUP_CODE_LENGTH for c in plain)
    assert TOTPService.verify_backup_code(plain[0], hashed) == hashed[0]
    assert TOTPService.verify_backup_code(plain[0].upper(), hashed) == hashed[0]
    formatted = TOTPService.format_backup_codes([plain[0]])[0]
    assert formatted == f'{plain[0][:4]}-{plain[0][4:]}'
    assert TOTPService.verify_backup_code(formatted, hashed) == hashed[0]


def test_backup_code_rejects_unknown_and_empty():
    _, hashed = TOTPService.generate_backup_codes()
    assert TOTPService.verify_backup_code('deadbeef', hashed) is None
    assert TOTPService.verify_backup_code('', hashed) is None
    assert TOTPService.verify_backup_code('abcd1234', []) is None


def test_setup_flow_enables_2fa_and_returns_backup_codes(user):
    setup = TwoFactorSetup(user)
    assert setup.confirm_setup('123456') == (False, '2FA setup not initiated')

    data = setup.initiate_setup()
    assert data['issuer'] == 'ServerKit' and data['secret'] == user.totp_secret
    assert not user.totp_enabled

    ok, codes = setup.confirm_setup(TOTPService.get_current_code(user.totp_secret))
    assert ok and len(codes) == 10
    assert user.totp_enabled and user.totp_confirmed_at
    assert setup.get_remaining_backup_codes_count() == 10


def test_confirm_with_wrong_code_does_not_enable(user):
    setup = TwoFactorSetup(user)
    setup.initiate_setup()
    totp = TOTPService.get_totp(user.totp_secret)
    now = time.time()
    wrong = next(f'{n:06d}' for n in range(1000000)
                 if f'{n:06d}' not in {totp.at(now + d * 30) for d in (-1, 0, 1)})
    assert setup.confirm_setup(wrong) == (False, 'Invalid verification code')
    assert not user.totp_enabled


def _enabled(user):
    setup = TwoFactorSetup(user)
    setup.initiate_setup()
    _, codes = setup.confirm_setup(TOTPService.get_current_code(user.totp_secret))
    return setup, codes


def test_disable_with_totp_code(user):
    setup, _ = _enabled(user)
    ok, err = setup.disable(TOTPService.get_current_code(user.totp_secret))
    assert ok and err is None
    assert not user.totp_enabled and user.totp_secret is None and user.backup_codes is None


def test_disable_with_backup_code(user):
    setup, codes = _enabled(user)
    ok, err = setup.disable(codes[0])
    assert ok and err is None and not user.totp_enabled


def test_disable_rejects_garbage_and_when_not_enabled(user):
    setup = TwoFactorSetup(user)
    assert setup.disable('123456') == (False, '2FA is not enabled')
    setup, _ = _enabled(user)
    assert setup.disable('zzzz-zzzz') == (False, 'Invalid verification code')
    assert user.totp_enabled


def test_regenerate_backup_codes_replaces_old_set(user):
    setup, old = _enabled(user)
    old_hashes = set(user.get_backup_codes())
    ok, new = setup.regenerate_backup_codes(TOTPService.get_current_code(user.totp_secret))
    assert ok and len(new) == 10
    assert not old_hashes & set(user.get_backup_codes())
    assert setup.regenerate_backup_codes('abc') == (False, 'Invalid verification code')
