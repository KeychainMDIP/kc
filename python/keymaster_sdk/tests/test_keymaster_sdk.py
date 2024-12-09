import keymaster_sdk as keymaster
from datetime import datetime, timedelta, timezone
import random
import string

# Test vars
expires = datetime.now(timezone.utc) + timedelta(minutes=1)
schema = None
wallet = None
current_id = None
credential = None
vc_dids = []


# Tests
def test_isready():
    keymaster.is_ready()


def test_create_id():
    random_name = ''.join(random.choice(string.ascii_letters + string.digits) for _ in range(11))
    keymaster.create_id(random_name)


def test_get_current_id():
    global current_id
    current_id = keymaster.get_current_id()


def test_create_schema():
    global schema
    test_options = {"registry": "local", "validUntil": expires.isoformat()}
    schema = keymaster.create_schema(None, test_options)


def test_create_template():
    global credential
    credential = keymaster.create_template(schema)


def test_issue_credential():
    test_options = {"registry": "local", "validUntil": expires.isoformat(), "subject": current_id, "schema": schema}

    for i in range(100):
        vc_did = keymaster.issue_credential(credential, test_options)
        vc_dids.append(vc_did)


def test_decrypt_json():
    for vc_did in vc_dids:
        keymaster.decrypt_json(vc_did)


def test_load_wallet():
    global wallet
    wallet = keymaster.load_wallet()


def test_save_wallet():
    keymaster.save_wallet(wallet)


